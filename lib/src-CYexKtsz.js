import { randomUUID } from "node:crypto";
import z from "@deepseek-ai/schemastery";
import { createPiAiCatalogAuthAdapter } from "@deepseek-ai/dsh-llm-pi-ai";
import { WebError, snapshotWebSearchModelRequest } from "@deepseek-ai/dsh-web";
import { createModels } from "@earendil-works/pi-ai";
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { withFileLock, writeFileAtomic } from "@deepseek-ai/dsh-atomic-write";
import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";
//#region src/store.ts
/**
* Owner-only persistent OAuth credential storage for the OpenAI Codex bundle.
* @module @dsh-external/dsh-openai-codex/store
*/
/** Provider route and pi-ai provider id owned by this bundle. */
const OPENAI_CODEX_PROVIDER = "openai-codex";
/** Basename of the OAuth document inside the Harness home. */
const OPENAI_CODEX_AUTH_FILENAME = ".openai-codex-auth.json";
/** Current on-disk format; pre-release readers reject every other version. */
const AUTH_FORMAT_VERSION = 1;
/** Whether a filesystem error reports an absent path. */
function isENOENT(error) {
	return error?.code === "ENOENT";
}
/** Reject a credential document readable by another POSIX user. */
async function assertOwnerOnly(filename) {
	let mode;
	try {
		mode = (await stat(filename)).mode;
	} catch (error) {
		if (isENOENT(error)) return;
		throw error;
	}
	/* v8 ignore next -- native Windows coverage takes the mode-less branch */
	if (process.platform === "win32") return;
	/* v8 ignore start -- POSIX tests cover this branch; Windows cannot express it */
	if ((mode & 63) !== 0) throw new Error(`openai-codex: ${filename} is readable beyond its owner (mode ${(mode & 511).toString(8)}); run "chmod 600 ${filename}" before starting again`);
	/* v8 ignore stop */
}
/** Validate the strict JSON document without quoting token-bearing input. */
function parseDocument(text, filename) {
	let value;
	try {
		value = JSON.parse(text);
	} catch {
		throw new Error(`openai-codex: ${filename} is not valid JSON`);
	}
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`openai-codex: ${filename} must contain an object`);
	const document = value;
	if (document["version"] !== AUTH_FORMAT_VERSION) throw new Error(`openai-codex: ${filename} has unsupported auth format version ${String(document["version"])}`);
	if (Object.keys(document).some((key) => key !== "version" && key !== "credential")) throw new Error(`openai-codex: ${filename} contains an unknown top-level field`);
	const raw = document["credential"];
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error(`openai-codex: ${filename} credential must be an object`);
	const credential = raw;
	if (Object.keys(credential).some((key) => ![
		"type",
		"access",
		"refresh",
		"expires",
		"accountId"
	].includes(key))) throw new Error(`openai-codex: ${filename} credential contains an unknown field`);
	if (credential["type"] !== "oauth") throw new Error(`openai-codex: ${filename} credential type must be oauth`);
	for (const key of [
		"access",
		"refresh",
		"accountId"
	]) if (typeof credential[key] !== "string" || credential[key].length === 0) throw new Error(`openai-codex: ${filename} credential ${key} must be a non-empty string`);
	if (typeof credential["expires"] !== "number" || !Number.isFinite(credential["expires"]) || credential["expires"] <= 0) throw new Error(`openai-codex: ${filename} credential expires must be a positive finite number`);
	return {
		version: AUTH_FORMAT_VERSION,
		credential
	};
}
/** Detach a credential from callers that may mutate provider-owned extras. */
function cloneCredential(credential) {
	return structuredClone(credential);
}
/**
* Resolve the default OAuth document path.
* @param dshHome - optional Harness-home override.
* @returns the absolute owner-only document path.
*/
function openAICodexAuthPath(dshHome) {
	return resolve(join(resolveDshHome(dshHome), OPENAI_CODEX_AUTH_FILENAME));
}
/** File-backed pi-ai store scoped to the single OpenAI Codex provider. */
var OpenAICodexCredentialStore = class {
	/** Absolute credential document path. */
	filename;
	/**
	* @param filename - explicit document path, defaulting under `$DSH_HOME`.
	*/
	constructor(filename = openAICodexAuthPath()) {
		this.filename = resolve(filename);
	}
	/** Read and validate the current document without acquiring the writer lock. */
	async readCurrent() {
		await assertOwnerOnly(this.filename);
		let text;
		try {
			text = await readFile(this.filename, "utf8");
		} catch (error) {
			if (isENOENT(error)) return void 0;
			throw error;
		}
		return cloneCredential(parseDocument(text, this.filename).credential);
	}
	/** @inheritdoc */
	async read(providerId) {
		return providerId === "openai-codex" ? this.readCurrent() : void 0;
	}
	/** @inheritdoc */
	async list() {
		return await this.readCurrent() === void 0 ? [] : [{
			providerId: OPENAI_CODEX_PROVIDER,
			type: "oauth"
		}];
	}
	/** @inheritdoc */
	async modify(providerId, fn) {
		if (providerId !== "openai-codex") throw new Error(`openai-codex: credential store does not own provider "${providerId}"`);
		await mkdir(dirname(this.filename), {
			recursive: true,
			mode: 448
		});
		return withFileLock(this.filename, async () => {
			const current = await this.readCurrent();
			const candidate = await fn(current);
			if (candidate === void 0) return current;
			const document = parseDocument(JSON.stringify({
				version: AUTH_FORMAT_VERSION,
				credential: candidate
			}), this.filename);
			await writeFileAtomic(this.filename, `${JSON.stringify(document, null, 2)}\n`, {
				mode: 384,
				dirMode: 448
			});
			return cloneCredential(document.credential);
		});
	}
	/** @inheritdoc */
	async delete(providerId) {
		if (providerId !== "openai-codex") return;
		await mkdir(dirname(this.filename), {
			recursive: true,
			mode: 448
		});
		await withFileLock(this.filename, () => rm(this.filename, { force: true }));
	}
};
//#endregion
//#region src/search.ts
/**
* OpenAI Codex standalone web search over the dsh web provider seam.
* @module @dsh-external/dsh-openai-codex/search
*/
/** Stable dsh web-provider id selected by the bundle patch. */
const OPENAI_CODEX_SEARCH_PROVIDER = OPENAI_CODEX_PROVIDER;
/** Trusted first-party Codex base; OAuth credentials never cross to a configured origin. */
const OPENAI_CODEX_BASE_URL = "https://chatgpt.com/backend-api/codex";
/** Standalone search endpoint used by the official Codex client. */
const OPENAI_CODEX_SEARCH_URL = `${OPENAI_CODEX_BASE_URL}/alpha/search`;
/** Default model used by the standalone search endpoint. */
const DEFAULT_OPENAI_CODEX_SEARCH_MODEL = "gpt-5.6-sol";
/** Default search mode, matching the official local Codex client. */
const DEFAULT_OPENAI_CODEX_SEARCH_MODE = "cached";
/** Default provider search-context size. */
const DEFAULT_OPENAI_CODEX_SEARCH_CONTEXT_SIZE = "medium";
/** Default output budget for the standalone search response. */
const DEFAULT_OPENAI_CODEX_SEARCH_MAX_OUTPUT_TOKENS = 1e4;
/** Convert the configured mode to the official endpoint field. */
function externalWebAccess(mode) {
	switch (mode) {
		case "cached": return false;
		case "indexed": return "indexed";
		case "live": return true;
	}
}
/** Extract the account id paired with one OAuth access token. */
function accountIdFromToken(access) {
	try {
		const parts = access.split(".");
		if (parts.length !== 3 || parts[1] === void 0) throw new Error("invalid JWT");
		const auth = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"))["https://api.openai.com/auth"];
		if (typeof auth !== "object" || auth === null || Array.isArray(auth)) throw new Error("missing auth claim");
		const accountId = auth["chatgpt_account_id"];
		if (typeof accountId !== "string" || accountId.length === 0) throw new Error("missing account id");
		return accountId;
	} catch (error) {
		throw new WebError("OpenAI Codex search credential has no usable account id; run \"dsh openai-codex login\" again", "WEB_PROVIDER_CREDENTIAL_MISSING", { cause: error });
	}
}
/** Whether an opaque value is a non-array record. */
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** Read an optional non-empty string field. */
function optionalString(record, key) {
	const value = record[key];
	return typeof value === "string" && value.length > 0 ? value : void 0;
}
/** Accept only citeable HTTP(S) URLs from opaque result DTOs. */
function citeableUrl(value) {
	if (typeof value !== "string") return void 0;
	try {
		const url = new URL(value);
		return url.protocol === "http:" || url.protocol === "https:" ? value : void 0;
	} catch {
		return;
	}
}
/**
* Map the standalone endpoint's forward-compatible result DTOs into the dsh
* web result. Unknown DTO types and fields are ignored; malformed envelope
* fields fail at the network boundary.
* @param value - parsed response JSON.
* @returns normalized answer and citeable sources.
*/
function mapOpenAICodexSearchResponse(value) {
	if (!isRecord(value) || typeof value["output"] !== "string") throw new WebError("OpenAI Codex returned a search response without string output", "WEB_PROVIDER_ERROR");
	const output = value["output"];
	const rawResults = value["results"];
	if (rawResults !== void 0 && !Array.isArray(rawResults)) throw new WebError("OpenAI Codex returned a search response with non-array results", "WEB_PROVIDER_ERROR");
	const sources = [];
	const seen = /* @__PURE__ */ new Set();
	for (const item of rawResults ?? []) {
		if (!isRecord(item) || item["type"] !== "text_result") continue;
		const url = citeableUrl(item["url"]);
		if (url === void 0 || seen.has(url)) continue;
		seen.add(url);
		const title = optionalString(item, "title");
		const snippet = optionalString(item, "snippet");
		sources.push({
			url,
			...title === void 0 ? {} : { title },
			...snippet === void 0 ? {} : { snippet }
		});
	}
	return {
		...output.length === 0 ? {} : { content: output },
		sources,
		truncated: false
	};
}
/** Stable cancellation error for every provider phase. */
function searchAborted(signal, fallback) {
	return new WebError("OpenAI Codex search aborted", "WEB_ABORTED", { cause: signal?.aborted === true ? signal.reason : fallback });
}
/** Throw the provider's stable cancellation error when the caller already aborted. */
function throwIfSearchAborted(signal) {
	if (signal?.aborted === true) throw searchAborted(signal);
}
/** True for native fetch cancellation. */
function isAbortError(error) {
	return error instanceof DOMException && error.name === "AbortError";
}
/** Race an asynchronous auth refresh against caller cancellation. */
function abortable(operation, signal) {
	if (signal === void 0) return operation;
	if (signal.aborted) return Promise.reject(searchAborted(signal));
	return new Promise((resolve, reject) => {
		const onAbort = () => {
			reject(searchAborted(signal));
		};
		signal.addEventListener("abort", onAbort, { once: true });
		operation.then((value) => {
			signal.removeEventListener("abort", onAbort);
			resolve(value);
		}, (error) => {
			signal.removeEventListener("abort", onAbort);
			reject(error);
		});
	});
}
/** Keep provider diagnostics bounded and remove JWT-like material. */
function providerMessage(value) {
	if (!isRecord(value)) return void 0;
	const error = value["error"];
	return (typeof error === "string" ? error : isRecord(error) && typeof error["message"] === "string" ? error["message"] : typeof value["message"] === "string" ? value["message"] : void 0)?.replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu, "[REDACTED]").slice(0, 1e3);
}
/** OpenAI Codex standalone-search provider using the same refreshable OAuth store as the LLM route. */
var OpenAICodexSearchProvider = class {
	options;
	id = OPENAI_CODEX_SEARCH_PROVIDER;
	models;
	/**
	* @param options - fixed trusted endpoint policy and deployment tunables.
	*/
	constructor(options) {
		this.options = options;
		const models = createModels({ credentials: options.credentials });
		models.setProvider(openaiCodexProvider());
		this.models = models;
	}
	/** The local configuration is usable; credential presence is resolved per request. */
	available() {
		return this.options.model.length > 0 && Number.isInteger(this.options.maxOutputTokens) && this.options.maxOutputTokens > 0;
	}
	/** @inheritdoc */
	async search(request, signal) {
		throwIfSearchAborted(signal);
		let auth;
		try {
			auth = await abortable(this.models.getAuth(OPENAI_CODEX_PROVIDER), signal);
		} catch (error) {
			throwIfSearchAborted(signal);
			if (isAbortError(error)) throw searchAborted(signal, error);
			throw new WebError("OpenAI Codex search credential resolution failed", "WEB_PROVIDER_ERROR", { cause: error });
		}
		const access = auth?.auth.apiKey;
		if (access === void 0 || access.length === 0) throw new WebError("OpenAI Codex search is signed out; run \"dsh openai-codex login\"", "WEB_PROVIDER_CREDENTIAL_MISSING");
		const accountId = accountIdFromToken(access);
		throwIfSearchAborted(signal);
		const body = {
			id: this.options.resolveRequestId(),
			model: this.options.model,
			input: [{
				type: "message",
				role: "user",
				content: [{
					type: "input_text",
					text: request.query
				}]
			}],
			commands: { search_query: [{ q: request.query }] },
			settings: {
				search_context_size: this.options.contextSize,
				allowed_callers: ["direct"],
				external_web_access: externalWebAccess(this.options.mode)
			},
			max_output_tokens: this.options.maxOutputTokens
		};
		this.options.recordRequest?.({
			endpoint: OPENAI_CODEX_SEARCH_URL,
			body
		});
		throwIfSearchAborted(signal);
		let response;
		try {
			response = await fetch(OPENAI_CODEX_SEARCH_URL, {
				method: "POST",
				redirect: "error",
				headers: {
					authorization: `Bearer ${access}`,
					"chatgpt-account-id": accountId,
					"content-type": "application/json",
					accept: "application/json",
					originator: "deepseek-harness"
				},
				body: JSON.stringify(body),
				...signal === void 0 ? {} : { signal }
			});
		} catch (error) {
			throwIfSearchAborted(signal);
			if (isAbortError(error)) throw searchAborted(signal, error);
			throw new WebError("OpenAI Codex search request failed", "WEB_PROVIDER_ERROR", { cause: error });
		}
		let payload;
		try {
			payload = await response.json();
		} catch (error) {
			throwIfSearchAborted(signal);
			if (isAbortError(error)) throw searchAborted(signal, error);
			throw new WebError(`OpenAI Codex returned an unprocessable search response (HTTP ${response.status})`, "WEB_PROVIDER_ERROR", { cause: error });
		}
		if (!response.ok) {
			const detail = providerMessage(payload);
			const message = detail === void 0 ? `OpenAI Codex search failed (HTTP ${response.status})` : `OpenAI Codex search failed (HTTP ${response.status}): ${detail}`;
			throw new WebError(response.status === 401 || response.status === 403 ? `${message}; run "dsh openai-codex login" again` : message, response.status === 401 || response.status === 403 ? "WEB_PROVIDER_CREDENTIAL_MISSING" : "WEB_PROVIDER_ERROR");
		}
		return mapOpenAICodexSearchResponse(payload);
	}
};
//#endregion
//#region src/auth.ts
/**
* OpenAI Codex OAuth orchestration shared by the plugin and standalone launcher.
* @module @dsh-external/dsh-openai-codex/auth
*/
/**
* Complete provider-native OAuth and persist the resulting credential.
* @param interaction - terminal or UI callbacks for the provider flow.
* @param store - credential store, defaulting under `$DSH_HOME`.
*/
async function loginOpenAICodex(interaction, store = new OpenAICodexCredentialStore()) {
	const models = createModels({ credentials: store });
	models.setProvider(openaiCodexProvider());
	await models.login(OPENAI_CODEX_PROVIDER, "oauth", interaction);
}
/**
* Remove the stored OpenAI Codex credential.
* @param store - credential store, defaulting under `$DSH_HOME`.
*/
async function logoutOpenAICodex(store = new OpenAICodexCredentialStore()) {
	await store.delete(OPENAI_CODEX_PROVIDER);
}
/**
* Read non-secret OpenAI Codex login state without refreshing the token.
* @param store - credential store, defaulting under `$DSH_HOME`.
* @returns stored login state and expiry.
*/
async function openAICodexAuthStatus(store = new OpenAICodexCredentialStore()) {
	const credential = await store.read(OPENAI_CODEX_PROVIDER);
	return credential?.type === "oauth" ? {
		authenticated: true,
		expiresAt: new Date(credential.expires)
	} : { authenticated: false };
}
//#endregion
//#region src/index.ts
/** Stable Cordis plugin name. */
const name = "llm-openai-codex";
/** LLM and web registries required before the composite provider can register. */
const inject = ["llm", "web"];
const Config = z.object({
	searchModel: z.string().default(DEFAULT_OPENAI_CODEX_SEARCH_MODEL),
	searchMode: z.union([
		"cached",
		"indexed",
		"live"
	]).default(DEFAULT_OPENAI_CODEX_SEARCH_MODE),
	searchContextSize: z.union([
		"low",
		"medium",
		"high"
	]).default(DEFAULT_OPENAI_CODEX_SEARCH_CONTEXT_SIZE),
	searchMaxOutputTokens: z.number().step(1).min(1).default(DEFAULT_OPENAI_CODEX_SEARCH_MAX_OUTPUT_TOKENS)
});
/**
* Register the `openai-codex` LLM route and standalone web-search provider
* with one provider-native OAuth credential store.
* @param ctx - plugin context carrying the LLM and web registries plus optional agent and attachment services.
* @param config - standalone-search model, access mode, context size, and output budget.
*/
function apply(ctx, config) {
	const credentials = new OpenAICodexCredentialStore();
	ctx.llm.registerAdapter([OPENAI_CODEX_PROVIDER], createPiAiCatalogAuthAdapter({
		provider: OPENAI_CODEX_PROVIDER,
		displayName: "OpenAI Codex",
		credentials,
		resolveAttachments: () => ctx.get("attachments")
	}));
	ctx.web.registerSearchProvider(new OpenAICodexSearchProvider({
		credentials,
		model: config.searchModel ?? "gpt-5.6-sol",
		mode: config.searchMode ?? "cached",
		contextSize: config.searchContextSize ?? "medium",
		maxOutputTokens: config.searchMaxOutputTokens ?? 1e4,
		resolveRequestId: () => String(ctx.get("agents")?.currentInitiator()?.session.id ?? randomUUID()),
		recordRequest: (request) => {
			ctx.get("agents")?.currentInitiator()?.session.append("web/search-model-request", snapshotWebSearchModelRequest(OPENAI_CODEX_PROVIDER, request));
		}
	}));
}
//#endregion
export { OPENAI_CODEX_AUTH_FILENAME as _, loginOpenAICodex as a, openAICodexAuthPath as b, DEFAULT_OPENAI_CODEX_SEARCH_CONTEXT_SIZE as c, DEFAULT_OPENAI_CODEX_SEARCH_MODEL as d, OPENAI_CODEX_BASE_URL as f, mapOpenAICodexSearchResponse as g, OpenAICodexSearchProvider as h, name as i, DEFAULT_OPENAI_CODEX_SEARCH_MAX_OUTPUT_TOKENS as l, OPENAI_CODEX_SEARCH_URL as m, apply as n, logoutOpenAICodex as o, OPENAI_CODEX_SEARCH_PROVIDER as p, inject as r, openAICodexAuthStatus as s, Config as t, DEFAULT_OPENAI_CODEX_SEARCH_MODE as u, OPENAI_CODEX_PROVIDER as v, OpenAICodexCredentialStore as y };
