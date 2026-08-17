import { randomUUID } from "node:crypto";
import z from "@deepseek-ai/schemastery";
import { deepEqualJson, installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings";
import { createModels } from "@earendil-works/pi-ai";
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";
import { createUserMessage, resolveRetryPolicy } from "@deepseek-ai/dsh-llm";
import { PiAiAdapter } from "@deepseek-ai/dsh-llm-pi-ai";
import { lstat, mkdir, open, readFile, rm, stat } from "node:fs/promises";
import { basename, dirname, join, parse, resolve } from "node:path";
import { withFileLock, writeFileAtomic } from "@deepseek-ai/dsh-atomic-write";
import { resolveDshHome } from "@deepseek-ai/dsh-home-paths";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { request } from "node:http";
import { request as request$1 } from "node:https";
import { connect } from "node:tls";
import { PassThrough, Readable } from "node:stream";
import { AttachmentId } from "@deepseek-ai/dsh-attachment";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { KNOWN_SESSION_EVENT_TYPES } from "@deepseek-ai/dsh-session";
import { WebError } from "@deepseek-ai/dsh-web";
//#region src/store.ts
/**
* Owner-only persistent OAuth credential storage for the OpenAI Codex bundle.
* @module dsh-codex-connect/store
*/
/** Provider route and pi-ai provider id owned by this bundle. */
const OPENAI_CODEX_PROVIDER = "openai-codex";
/** Basename of the OAuth document inside the Harness home. */
const OPENAI_CODEX_AUTH_FILENAME = ".openai-codex-auth.json";
/** Current on-disk format; pre-release readers reject every other version. */
const AUTH_FORMAT_VERSION = 1;
/** Whether a filesystem error reports an absent path. */
function isENOENT$1(error) {
	return error?.code === "ENOENT";
}
/** Reject a credential document readable by another POSIX user. */
async function assertOwnerOnly$1(filename) {
	let mode;
	try {
		mode = (await stat(filename)).mode;
	} catch (error) {
		if (isENOENT$1(error)) return;
		throw error;
	}
	/* v8 ignore next -- native Windows coverage takes the mode-less branch */
	if (process.platform === "win32") return;
	/* v8 ignore start -- POSIX tests cover this branch; Windows cannot express it */
	if ((mode & 63) !== 0) throw new Error(`openai-codex: ${filename} is readable beyond its owner (mode ${(mode & 511).toString(8)}); run "chmod 600 ${filename}" before starting again`);
	/* v8 ignore stop */
}
/** Validate the strict JSON document without quoting token-bearing input. */
function parseDocument$1(text, filename) {
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
		await assertOwnerOnly$1(this.filename);
		let text;
		try {
			text = await readFile(this.filename, "utf8");
		} catch (error) {
			if (isENOENT$1(error)) return void 0;
			throw error;
		}
		return cloneCredential(parseDocument$1(text, this.filename).credential);
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
			const document = parseDocument$1(JSON.stringify({
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
//#region src/adapter.ts
/** OpenAI Codex adapter assembled from public dsh-llm-pi-ai extension points. */
/** Provider idle ceiling used by the composite route. */
const OPENAI_CODEX_STREAM_IDLE_TIMEOUT_MS = 3e5;
/**
* Give the generic dsh adapter a request-scoped bearer-token entry without
* changing the provider's user-facing OAuth flow. The resolver accepts only
* the explicit override supplied by this plugin; it never discovers an API
* key from the environment or persistent api-key credentials.
*/
function requestProvider(provider, contextWindow) {
	const wrapped = {
		...provider,
		auth: {
			...provider.auth,
			apiKey: {
				name: "OpenAI Codex OAuth bearer token",
				async resolve({ credential }) {
					const apiKey = credential?.key;
					return apiKey === void 0 || apiKey.length === 0 ? void 0 : {
						auth: { apiKey },
						source: "OAuth"
					};
				}
			}
		}
	};
	if (contextWindow === void 0) return wrapped;
	return {
		...wrapped,
		getModels: () => wrapped.getModels().map((model) => ({
			...model,
			contextWindow
		}))
	};
}
/**
* Create the Codex subscription adapter without requiring a dsh fork. The
* public pi-ai adapter owns Harness message conversion, image attachment
* resolution, streaming, reasoning metadata, and compaction behavior; this
* plugin supplies its provider-native OAuth token for each request.
*
* When a proxy is configured the profile forces the SSE transport: the
* Codex WebSocket path in Node cannot traverse an HTTP proxy, so proxying
* would silently bypass the tunnel unless the SSE path is used.
* @param credentials - persistent provider-owned OAuth store.
* @param resolveAttachments - resolve the optional durable attachment service.
* @param resolveProxyEnabled - read the live proxy setting before each request.
* @param resolveContextWindow - read the optional global model-context override.
*   A fresh profile map is published per call so either setting reaches the next
*   request without a restart while in-flight requests keep their snapshot.
*/
function createOpenAICodexAdapter(credentials, resolveAttachments, resolveProxyEnabled, resolveContextWindow) {
	const provider = openaiCodexProvider();
	const baseProfile = {
		provider: OPENAI_CODEX_PROVIDER,
		displayName: "OpenAI Codex",
		streamIdleTimeoutMs: OPENAI_CODEX_STREAM_IDLE_TIMEOUT_MS,
		retryPolicy: resolveRetryPolicy(void 0, "dsh-codex-connect retryPolicy"),
		configuredMaxTokens: /* @__PURE__ */ new Map(),
		piProvider: requestProvider(provider)
	};
	const models = createModels({ credentials });
	models.setProvider(provider);
	return new PiAiAdapter({
		profiles: () => {
			const contextWindow = resolveContextWindow();
			const proxyEnabled = resolveProxyEnabled();
			const profile = contextWindow === void 0 && !proxyEnabled ? baseProfile : {
				...baseProfile,
				...contextWindow === void 0 ? {} : { piProvider: requestProvider(provider, contextWindow) },
				...proxyEnabled ? { transport: "sse" } : {}
			};
			return /* @__PURE__ */ new Map([[OPENAI_CODEX_PROVIDER, profile]]);
		},
		resolveApiKey: async () => (await models.getAuth(OPENAI_CODEX_PROVIDER))?.auth.apiKey,
		resolveAttachments
	});
}
//#endregion
//#region src/auth.ts
/**
* OpenAI Codex OAuth orchestration shared by the plugin and standalone launcher.
* @module dsh-codex-connect/auth
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
//#region src/codex-auth-import.ts
/** Secure one-time import of OpenAI Codex CLI OAuth credentials. */
/** Maximum accepted Codex auth document size. Tokens need only a few KiB. */
const MAX_CODEX_AUTH_IMPORT_BYTES = 262144;
/** One expected import failure with a redacted public code. */
var CodexAuthImportError = class extends Error {
	code;
	constructor(code) {
		super(code);
		this.code = code;
		this.name = "CodexAuthImportError";
	}
};
function nodeErrorCode(error) {
	return error?.code;
}
function invalid() {
	throw new CodexAuthImportError("codex-auth-invalid");
}
function record(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value : void 0;
}
function nonEmptyString(value) {
	return typeof value === "string" && value.trim().length > 0 ? value : void 0;
}
/** Resolve the Codex CLI file-backed credential path without touching it. */
function codexAuthJsonPath(codexHome = process.env["CODEX_HOME"]) {
	const configured = codexHome?.trim();
	const root = configured === void 0 || configured.length === 0 ? join(homedir(), ".codex") : configured;
	return resolve(root, "auth.json");
}
/** Decode one JWT payload without logging token-bearing input. */
function jwtPayload(token) {
	const parts = token.split(".");
	const encoded = parts.length === 3 ? parts[1] : void 0;
	if (encoded === void 0 || encoded.length === 0 || !/^[A-Za-z0-9_-]+$/u.test(encoded)) return invalid();
	try {
		return record(JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"))) ?? invalid();
	} catch {
		return invalid();
	}
}
function accountIdFromPayload(payload) {
	return nonEmptyString(record(payload["https://api.openai.com/auth"])?.["chatgpt_account_id"]);
}
/** Parse only the OAuth leaves needed by this plugin and build its canonical credential. */
function parseCodexAuthJson(text) {
	let value;
	try {
		value = JSON.parse(text);
	} catch {
		return invalid();
	}
	const tokenContainer = record((record(value) ?? invalid())["tokens"]) ?? invalid();
	const tokens = record(tokenContainer["chatgpt"]) ?? tokenContainer;
	const access = nonEmptyString(tokens["access_token"]) ?? invalid();
	const refresh = nonEmptyString(tokens["refresh_token"]) ?? invalid();
	const accessPayload = jwtPayload(access);
	const exp = accessPayload["exp"];
	if (typeof exp !== "number" || !Number.isSafeInteger(exp) || exp <= 0) return invalid();
	const expires = exp * 1e3;
	if (!Number.isSafeInteger(expires) || expires <= 0) return invalid();
	const declaredAccount = tokens["account_id"];
	if (declaredAccount !== void 0 && declaredAccount !== null && nonEmptyString(declaredAccount) === void 0) return invalid();
	const idToken = tokens["id_token"];
	if (idToken !== void 0 && idToken !== null && nonEmptyString(idToken) === void 0) return invalid();
	return {
		type: "oauth",
		access,
		refresh,
		expires,
		accountId: nonEmptyString(declaredAccount) ?? accountIdFromPayload(accessPayload) ?? (typeof idToken === "string" ? accountIdFromPayload(jwtPayload(idToken)) : void 0) ?? invalid()
	};
}
/** Read one bounded, owner-only regular file and convert its Codex OAuth data. */
async function readCodexAuthCredential(sourcePath = codexAuthJsonPath()) {
	const filename = resolve(sourcePath);
	let before;
	try {
		before = await lstat(filename);
	} catch (error) {
		if (nodeErrorCode(error) === "ENOENT") throw new CodexAuthImportError("codex-auth-not-found");
		throw new CodexAuthImportError("codex-auth-unreadable");
	}
	if (!before.isFile() || before.isSymbolicLink() || before.size > 262144) throw new CodexAuthImportError("codex-auth-unsafe-file");
	if (process.platform !== "win32" && (before.mode & 63) !== 0) throw new CodexAuthImportError("codex-auth-unsafe-file");
	let handle;
	try {
		const flags = constants.O_RDONLY | (process.platform === "win32" ? 0 : constants.O_NOFOLLOW);
		handle = await open(filename, flags);
		const opened = await handle.stat();
		if (!opened.isFile() || opened.size > 262144) throw new CodexAuthImportError("codex-auth-unsafe-file");
		return parseCodexAuthJson(await handle.readFile("utf8"));
	} catch (error) {
		if (error instanceof CodexAuthImportError) throw error;
		if (nodeErrorCode(error) === "ENOENT") throw new CodexAuthImportError("codex-auth-not-found");
		throw new CodexAuthImportError("codex-auth-unreadable");
	} finally {
		await handle?.close().catch(() => void 0);
	}
}
/**
* Import a Codex CLI credential without mutating the source document.
*
* The first call stops before reading the source when the plugin already owns
* a credential. A confirmed retry performs a serialized read-modify-write, so
* a concurrent login cannot be overwritten without the same explicit flag.
*/
async function importCodexAuthCredential(store = new OpenAICodexCredentialStore(), options = {}) {
	const overwrite = options.overwrite === true;
	if (!overwrite && await store.read("openai-codex") !== void 0) return { status: "confirmation-required" };
	const imported = await readCodexAuthCredential(options.sourcePath);
	let replaced = false;
	let confirmationRequired = false;
	await store.modify(OPENAI_CODEX_PROVIDER, async (current) => {
		if (current !== void 0 && !overwrite) {
			confirmationRequired = true;
			return;
		}
		replaced = current !== void 0;
		return imported;
	});
	return confirmationRequired ? { status: "confirmation-required" } : {
		status: "imported",
		replaced
	};
}
//#endregion
//#region src/usage.ts
/** Live ChatGPT Codex rate-limit usage for the browser account page. */
/** Fixed endpoint used by the official Codex client for ChatGPT rate limits. */
const OPENAI_CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const USAGE_REQUEST_TIMEOUT_MS = 15e3;
/** Stable public discriminant for an expired or revoked Codex OAuth session. */
const OPENAI_CODEX_REAUTH_REQUIRED_CODE = "OPENAI_CODEX_REAUTH_REQUIRED";
/** Fixed, secret-free message for a browser-facing reauthorization prompt. */
const OPENAI_CODEX_REAUTH_REQUIRED_MESSAGE = "OpenAI Codex authorization must be renewed";
/**
* Raised when the usage endpoint rejects the current OAuth session.
*
* The error intentionally carries no response, credential, or account data so
* callers can safely pass its fixed message across the Web boundary.
*/
var OpenAICodexReauthRequiredError = class extends Error {
	code = OPENAI_CODEX_REAUTH_REQUIRED_CODE;
	constructor() {
		super(OPENAI_CODEX_REAUTH_REQUIRED_MESSAGE);
		this.name = "OpenAICodexReauthRequiredError";
	}
};
/** Identify the dedicated reauthorization failure without comparing messages. */
function isOpenAICodexReauthRequiredError(error) {
	return error instanceof OpenAICodexReauthRequiredError;
}
function isRecord$2(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function parseWindow(value) {
	if (value === void 0 || value === null) return void 0;
	if (!isRecord$2(value)) throw new Error("OpenAI Codex returned a malformed rate-limit window");
	const usedPercent = value["used_percent"];
	const windowSeconds = value["limit_window_seconds"];
	if (typeof usedPercent !== "number" || !Number.isFinite(usedPercent) || usedPercent < 0 || usedPercent > 100) throw new Error("OpenAI Codex returned an invalid used percentage");
	if (typeof windowSeconds !== "number" || !Number.isInteger(windowSeconds) || windowSeconds <= 0) throw new Error("OpenAI Codex returned an invalid rate-limit window duration");
	return {
		remainingPercent: 100 - usedPercent,
		windowSeconds
	};
}
function parseLimit(id, name, value) {
	if (value === void 0 || value === null) return void 0;
	if (!isRecord$2(value)) throw new Error("OpenAI Codex returned malformed rate-limit details");
	const windows = [parseWindow(value["primary_window"]), parseWindow(value["secondary_window"])].filter((window) => window !== void 0);
	return windows.length === 0 ? void 0 : {
		id,
		...name === void 0 ? {} : { name },
		windows
	};
}
function exactAmount(record, key) {
	const value = record[key];
	if (typeof value !== "string" || value.length === 0 || value.length > 64 || !/^-?\d+(?:\.\d+)?$/u.test(value)) throw new Error(`OpenAI Codex returned an invalid ${key} amount`);
	return value;
}
function parseCredits(value) {
	if (value === void 0 || value === null) return void 0;
	if (!isRecord$2(value) || typeof value["has_credits"] !== "boolean" || typeof value["unlimited"] !== "boolean") throw new Error("OpenAI Codex returned malformed credit details");
	if (!value["has_credits"]) return void 0;
	const balance = value["balance"];
	if (balance !== void 0 && balance !== null && (typeof balance !== "string" || balance.length === 0 || balance.length > 64 || !/^-?\d+(?:\.\d+)?$/u.test(balance))) throw new Error("OpenAI Codex returned an invalid credit balance");
	return {
		unlimited: value["unlimited"],
		...typeof balance === "string" ? { balance } : {}
	};
}
function parseIndividualLimit(value) {
	if (value === void 0 || value === null) return void 0;
	if (!isRecord$2(value)) throw new Error("OpenAI Codex returned malformed spend-control details");
	const individual = value["individual_limit"];
	if (individual === void 0 || individual === null) return void 0;
	if (!isRecord$2(individual)) throw new Error("OpenAI Codex returned a malformed individual limit");
	const remainingPercent = individual["remaining_percent"];
	if (typeof remainingPercent !== "number" || !Number.isFinite(remainingPercent) || remainingPercent < 0 || remainingPercent > 100) throw new Error("OpenAI Codex returned an invalid individual-limit percentage");
	return {
		limit: exactAmount(individual, "limit"),
		used: exactAmount(individual, "used"),
		remaining: exactAmount(individual, "remaining"),
		remainingPercent
	};
}
/**
* Convert the provider response into the small secret-free object sent to the browser.
* @param value - opaque JSON returned by the ChatGPT usage endpoint.
* @returns core and additionally metered quota buckets with remaining percentages.
*/
function parseOpenAICodexUsage(value) {
	if (!isRecord$2(value)) throw new Error("OpenAI Codex returned a malformed usage response");
	const limits = [];
	const primary = parseLimit("codex", "Codex", value["rate_limit"]);
	if (primary !== void 0) limits.push(primary);
	const additional = value["additional_rate_limits"];
	if (additional !== void 0 && additional !== null && !Array.isArray(additional)) throw new Error("OpenAI Codex returned malformed additional rate limits");
	for (const item of additional ?? []) {
		if (!isRecord$2(item)) throw new Error("OpenAI Codex returned a malformed additional rate limit");
		const id = item["metered_feature"];
		const name = item["limit_name"];
		if (typeof id !== "string" || id.length === 0) throw new Error("OpenAI Codex returned an additional rate limit without an id");
		if (name !== void 0 && name !== null && typeof name !== "string") throw new Error("OpenAI Codex returned an invalid additional rate-limit name");
		const limit = parseLimit(id, typeof name === "string" && name.length > 0 ? name : void 0, item["rate_limit"]);
		if (limit !== void 0) limits.push(limit);
	}
	const credits = parseCredits(value["credits"]);
	const individualLimit = parseIndividualLimit(value["spend_control"]);
	return {
		rateLimits: limits,
		...credits === void 0 ? {} : { credits },
		...individualLimit === void 0 ? {} : { individualLimit }
	};
}
/**
* Read current quota without issuing a model request. OAuth is refreshed through
* the same provider-native credential lifecycle used by normal Codex turns.
* @param store - plugin-owned OAuth credential store.
* @returns current rate-limit buckets safe to expose to the local browser page.
*/
async function readOpenAICodexRateLimits(store) {
	const models = createModels({ credentials: store });
	models.setProvider(openaiCodexProvider());
	const auth = await models.getAuth(OPENAI_CODEX_PROVIDER);
	const credential = await store.read(OPENAI_CODEX_PROVIDER);
	const access = auth?.auth.apiKey;
	const accountId = credential?.type === "oauth" ? credential.accountId : void 0;
	if (access === void 0 || access.length === 0 || typeof accountId !== "string" || accountId.length === 0) throw new Error("OpenAI Codex is signed out");
	const response = await fetch(OPENAI_CODEX_USAGE_URL, {
		method: "GET",
		redirect: "error",
		headers: {
			authorization: `Bearer ${access}`,
			"chatgpt-account-id": accountId,
			accept: "application/json",
			"cache-control": "no-store",
			"user-agent": "dsh-codex-connect"
		},
		signal: AbortSignal.timeout(USAGE_REQUEST_TIMEOUT_MS)
	});
	if (!response.ok) {
		if (response.status === 401 || response.status === 403) throw new OpenAICodexReauthRequiredError();
		throw new Error(`OpenAI Codex usage request failed with HTTP ${response.status}`);
	}
	let value;
	try {
		value = await response.json();
	} catch (error) {
		throw new Error("OpenAI Codex returned an unreadable usage response", { cause: error });
	}
	return parseOpenAICodexUsage(value);
}
//#endregion
//#region src/auth-paths.ts
/** Node-free route constants shared by the Host and browser plugin halves. */
/** Plugin-owned status endpoint consumed by its browser half. */
const OPENAI_CODEX_AUTH_STATUS_PATH = "/plugins/dsh-openai-codex/auth/status";
/** Plugin-owned browser-login endpoint consumed by its browser half. */
const OPENAI_CODEX_AUTH_LOGIN_PATH = "/plugins/dsh-openai-codex/auth/login";
/** Plugin-owned logout endpoint consumed by its browser half. */
const OPENAI_CODEX_AUTH_LOGOUT_PATH = "/plugins/dsh-openai-codex/auth/logout";
/** Host-only Codex CLI credential import endpoint; no secret crosses this route. */
const OPENAI_CODEX_AUTH_IMPORT_PATH = "/plugins/dsh-openai-codex/auth/import";
/** Explicit value sent only after the user accepts the overwrite prompt. */
const OPENAI_CODEX_IMPORT_OVERWRITE_HEADER = "x-dsh-codex-overwrite";
//#endregion
//#region src/trusted-origins.ts
/** Owner-only allowlist for browser origins that may reach the Web OAuth routes. */
/** Basename of the DSH-home-scoped browser-origin allowlist. */
const OPENAI_CODEX_TRUSTED_ORIGINS_FILENAME = ".openai-codex-trusted-origins.json";
/** Only supported policy mode; a future mode must not be silently accepted. */
const TRUSTED_ORIGINS_MODE = "allowlist";
/** Whether a filesystem error reports an absent path. */
function isENOENT(error) {
	return error?.code === "ENOENT";
}
/** Reject a sidecar readable by another POSIX user. */
async function assertOwnerOnly(filename) {
	let metadata;
	try {
		metadata = await lstat(filename);
	} catch (error) {
		if (isENOENT(error)) return;
		throw error;
	}
	if (!metadata.isFile()) throw new Error(`openai-codex: ${filename} is not a regular file`);
	/* v8 ignore next -- native Windows coverage takes the mode-less branch */
	if (process.platform === "win32") return;
	/* v8 ignore start -- POSIX tests cover this branch; Windows cannot express it */
	if ((metadata.mode & 63) !== 0) throw new Error(`openai-codex: ${filename} is readable beyond its owner (mode ${(metadata.mode & 511).toString(8)}); run "chmod 600 ${filename}" before starting again`);
	/* v8 ignore stop */
}
/** Reject malformed input without echoing its contents into an error. */
function parseDocument(text, filename) {
	let value;
	try {
		value = JSON.parse(text);
	} catch {
		throw new Error(`openai-codex: ${filename} is not valid JSON`);
	}
	if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`openai-codex: ${filename} must contain an object`);
	const document = value;
	if (Object.keys(document).some((key) => ![
		"version",
		"mode",
		"origins"
	].includes(key))) throw new Error(`openai-codex: ${filename} contains an unknown top-level field`);
	if (document["version"] !== 1) throw new Error(`openai-codex: ${filename} has unsupported trusted-origins format version ${String(document["version"])}`);
	if (document["mode"] !== "allowlist") throw new Error(`openai-codex: ${filename} has unsupported trusted-origins mode`);
	const rawOrigins = document["origins"];
	if (!Array.isArray(rawOrigins)) throw new Error(`openai-codex: ${filename} origins must be an array`);
	const origins = /* @__PURE__ */ new Set();
	for (const rawOrigin of rawOrigins) {
		if (typeof rawOrigin !== "string") throw new Error(`openai-codex: ${filename} origins must contain strings`);
		try {
			origins.add(normalizeTrustedOrigin(rawOrigin));
		} catch {
			throw new Error(`openai-codex: ${filename} contains an invalid trusted origin`);
		}
	}
	return {
		version: 1,
		mode: TRUSTED_ORIGINS_MODE,
		origins: [...origins].sort()
	};
}
/**
* Normalize one exact browser origin.
*
* Only HTTP(S) origins are accepted. Credentials, non-root paths, queries,
* fragments, wildcards, and CIDR-looking host paths are rejected. WHATWG URL
* normalization lowercases the scheme/host and removes default ports.
*/
function normalizeTrustedOrigin(rawOrigin) {
	if (typeof rawOrigin !== "string" || rawOrigin.length === 0 || rawOrigin.trim() !== rawOrigin) throw new Error("trusted origin must be a non-empty URL without surrounding whitespace");
	let origin;
	try {
		origin = new URL(rawOrigin);
	} catch {
		throw new Error("trusted origin must be a valid URL");
	}
	if (origin.protocol !== "http:" && origin.protocol !== "https:") throw new Error("trusted origin protocol must be http or https");
	if (origin.username !== "" || origin.password !== "") throw new Error("trusted origin must not contain credentials");
	if (origin.pathname !== "/" || origin.search !== "" || origin.hash !== "") throw new Error("trusted origin must not contain a path, query, or fragment");
	if (origin.hostname === "" || origin.hostname.includes("*")) throw new Error("trusted origin host must be exact");
	if (origin.pathname !== "/" || /(?:^|\/)\d+\/\d+$/u.test(rawOrigin)) throw new Error("trusted origin must not be a CIDR or path");
	if (origin.origin === "null") throw new Error("trusted origin must have an HTTP(S) host");
	return origin.origin;
}
/** Resolve the sidecar path under one DSH home. */
function openAICodexTrustedOriginsPath(dshHome) {
	return resolve(join(resolveDshHome(dshHome), OPENAI_CODEX_TRUSTED_ORIGINS_FILENAME));
}
/** File-backed exact-origin allowlist. */
var OpenAICodexTrustedOriginsStore = class {
	/** Absolute sidecar path. */
	filename;
	constructor(filename = openAICodexTrustedOriginsPath()) {
		this.filename = resolve(filename);
	}
	async readCurrent() {
		await assertOwnerOnly(this.filename);
		let text;
		try {
			text = await readFile(this.filename, "utf8");
		} catch (error) {
			if (isENOENT(error)) return {
				version: 1,
				mode: TRUSTED_ORIGINS_MODE,
				origins: []
			};
			throw error;
		}
		return parseDocument(text, this.filename);
	}
	/** Read the current canonical list without acquiring the writer lock. */
	async list() {
		return [...(await this.readCurrent()).origins];
	}
	/** Whether an exact normalized origin is currently trusted. */
	async has(origin) {
		const normalized = normalizeTrustedOrigin(origin);
		return (await this.readCurrent()).origins.includes(normalized);
	}
	/** Add one origin idempotently and return the resulting sorted list. */
	async trust(origin) {
		const normalized = normalizeTrustedOrigin(origin);
		await mkdir(dirname(this.filename), {
			recursive: true,
			mode: 448
		});
		return withFileLock(this.filename, async () => {
			const current = await this.readCurrent();
			if (current.origins.includes(normalized)) return [...current.origins];
			const next = {
				version: 1,
				mode: TRUSTED_ORIGINS_MODE,
				origins: [...current.origins, normalized].sort()
			};
			await writeFileAtomic(this.filename, `${JSON.stringify(next, null, 2)}\n`, {
				mode: 384,
				dirMode: 448
			});
			return [...next.origins];
		});
	}
	/** Remove one origin idempotently and return the resulting sorted list. */
	async untrust(origin) {
		const normalized = normalizeTrustedOrigin(origin);
		await mkdir(dirname(this.filename), {
			recursive: true,
			mode: 448
		});
		return withFileLock(this.filename, async () => {
			const current = await this.readCurrent();
			if (!current.origins.includes(normalized)) return [...current.origins];
			const next = {
				version: 1,
				mode: TRUSTED_ORIGINS_MODE,
				origins: current.origins.filter((candidate) => candidate !== normalized)
			};
			await writeFileAtomic(this.filename, `${JSON.stringify(next, null, 2)}\n`, {
				mode: 384,
				dirMode: 448
			});
			return [...next.origins];
		});
	}
};
/** Stable, non-sensitive error returned when a browser origin needs CLI trust. */
const REMOTE_WEB_ORIGIN_NOT_TRUSTED = "remote-web-origin-not-trusted";
/** Redact provider diagnostics before they cross to the browser. */
function safeMessage(error) {
	return (error instanceof Error ? error.message : String(error)).replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/gu, "[redacted token]").replace(/(\b(?:code|token|refresh_token|access_token)=)[^&\s]+/giu, "$1[redacted]").slice(0, 1e3);
}
/** Reject with the prompt's abort reason while browser callback owns completion. */
function waitForPromptAbort(prompt) {
	const signal = prompt.signal;
	if (signal === void 0) return new Promise(() => {});
	if (signal.aborted) return Promise.reject(signal.reason);
	return new Promise((_resolve, reject) => {
		signal.addEventListener("abort", () => {
			reject(signal.reason);
		}, { once: true });
	});
}
/** One lifecycle owner for the callback server, challenge, and public status. */
var OpenAICodexWebAuth = class {
	store;
	state = { status: "signed-out" };
	operation;
	cancellation;
	challenge;
	challengeWaiters = [];
	challengeTimer;
	challengeTimeoutMs;
	constructor(store, options = {}) {
		this.store = store;
		this.challengeTimeoutMs = options.challengeTimeoutMs ?? 3e4;
		if (!Number.isFinite(this.challengeTimeoutMs) || this.challengeTimeoutMs <= 0) throw new TypeError("OpenAI Codex auth URL timeout must be a positive finite number");
	}
	/** Read current public state, consulting durable storage while idle. */
	async status() {
		if (this.operation !== void 0) return this.state;
		if (this.state.status === "error") return this.state;
		return this.readStoredStatus();
	}
	/** Start or join the current browser-login operation. */
	async signIn() {
		if (this.operation === void 0) this.start();
		if (this.challenge !== void 0) return this.challenge;
		return new Promise((resolve, reject) => {
			this.challengeWaiters.push({
				resolve,
				reject
			});
		});
	}
	/** Cancel any callback listener, wait for quiescence, then delete the credential. */
	async signOut() {
		this.cancelSignIn(/* @__PURE__ */ new Error("OpenAI Codex sign-in cancelled"));
		await this.operation?.catch(() => void 0);
		await logoutOpenAICodex(this.store);
		this.challenge = void 0;
		this.state = { status: "signed-out" };
	}
	/** Import the host-local Codex CLI credential, cancelling any pending login. */
	async importCodexCredential(overwrite) {
		this.cancelSignIn(/* @__PURE__ */ new Error("OpenAI Codex sign-in cancelled by credential import"));
		await this.operation?.catch(() => void 0);
		const result = await importCodexAuthCredential(this.store, { overwrite });
		if (result.status === "imported") {
			this.challenge = void 0;
			this.state = { status: "signed-out" };
		}
		return result;
	}
	/** Stop the owned callback listener during plugin disposal. */
	async dispose() {
		this.cancelSignIn(/* @__PURE__ */ new Error("OpenAI Codex plugin disposed"));
		await this.operation?.catch(() => void 0);
	}
	start() {
		const cancellation = new AbortController();
		this.cancellation = cancellation;
		this.challenge = void 0;
		this.state = { status: "signing-in" };
		this.challengeTimer = setTimeout(() => {
			this.cancelSignIn(/* @__PURE__ */ new Error(`OpenAI Codex did not provide an authorization URL within ${String(this.challengeTimeoutMs)}ms`));
		}, this.challengeTimeoutMs);
		this.challengeTimer.unref();
		this.operation = loginOpenAICodex({
			signal: cancellation.signal,
			prompt: (prompt) => prompt.type === "select" ? Promise.resolve("browser") : waitForPromptAbort(prompt),
			notify: (event) => {
				this.onEvent(event);
			}
		}, this.store).then(async () => {
			if (this.challenge === void 0) {
				const error = /* @__PURE__ */ new Error("OpenAI Codex sign-in finished without an authorization URL");
				this.rejectChallenge(error);
				this.state = {
					status: "error",
					message: safeMessage(error)
				};
				return;
			}
			this.state = await this.readStoredStatus();
		}, (error) => {
			this.rejectChallenge(error);
			this.state = {
				status: "error",
				message: safeMessage(error)
			};
		}).finally(() => {
			this.clearChallengeTimer();
			this.operation = void 0;
			this.cancellation = void 0;
		});
	}
	onEvent(event) {
		if (event.type !== "auth_url") return;
		let url;
		try {
			url = new URL(event.url);
		} catch {
			const error = /* @__PURE__ */ new Error("OpenAI returned an invalid authorization URL");
			this.cancelSignIn(error);
			return;
		}
		if (url.protocol !== "https:" || url.username !== "" || url.password !== "") {
			const error = /* @__PURE__ */ new Error("OpenAI returned an unsafe authorization URL");
			this.cancelSignIn(error);
			return;
		}
		const challenge = { url: event.url };
		this.challenge = challenge;
		this.clearChallengeTimer();
		for (const waiter of this.challengeWaiters.splice(0)) waiter.resolve(challenge);
	}
	async readStoredStatus() {
		if (!(await openAICodexAuthStatus(this.store)).authenticated) return { status: "signed-out" };
		try {
			return {
				status: "signed-in",
				usage: await readOpenAICodexRateLimits(this.store)
			};
		} catch (error) {
			if (isOpenAICodexReauthRequiredError(error)) return {
				status: "reauth-required",
				message: OPENAI_CODEX_REAUTH_REQUIRED_MESSAGE
			};
			return {
				status: "signed-in",
				usage: { rateLimits: [] },
				quotaError: safeMessage(error)
			};
		}
	}
	rejectChallenge(error) {
		this.clearChallengeTimer();
		for (const waiter of this.challengeWaiters.splice(0)) waiter.reject(error);
	}
	clearChallengeTimer() {
		if (this.challengeTimer === void 0) return;
		clearTimeout(this.challengeTimer);
		this.challengeTimer = void 0;
	}
	cancelSignIn(error) {
		this.rejectChallenge(error);
		this.cancellation?.abort(error);
	}
};
function loopbackHost(rawHost) {
	if (/[\\/@?#]/u.test(rawHost)) return false;
	try {
		const parsed = new URL(`http://${rawHost}`);
		if (parsed.username !== "" || parsed.password !== "" || parsed.pathname !== "/" || parsed.search !== "" || parsed.hash !== "") return false;
		const hostname = (parsed.hostname.startsWith("[") && parsed.hostname.endsWith("]") ? parsed.hostname.slice(1, -1) : parsed.hostname).toLowerCase().replace(/\.$/u, "");
		return hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "127.0.0.1" || hostname === "::1" || hostname === "::ffff:127.0.0.1";
	} catch {
		return false;
	}
}
function exactOrigin(req, rawHost, rawOrigin) {
	try {
		const effective = normalizeTrustedOrigin(`${req.socket.encrypted === true ? "https" : "http"}://${rawHost}`);
		return normalizeTrustedOrigin(rawOrigin) === effective;
	} catch {
		return false;
	}
}
function effectiveOrigin(req, rawHost) {
	try {
		return normalizeTrustedOrigin(`${req.socket.encrypted === true ? "https" : "http"}://${rawHost}`);
	} catch {
		return;
	}
}
function sameOriginMetadata(req, host) {
	const origin = req.headers.origin;
	if (origin === void 0) return true;
	return typeof origin === "string" && exactOrigin(req, host, origin);
}
/** Evaluate one request against loopback defaults and the current sidecar. */
async function trustedRequestDecision(req, trustedOrigins = new OpenAICodexTrustedOriginsStore()) {
	const remote = req.socket.remoteAddress;
	const localPeer = remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1";
	const fetchSite = req.headers["sec-fetch-site"];
	if (typeof fetchSite === "string" ? fetchSite.trim().toLowerCase() === "cross-site" : Array.isArray(fetchSite) && fetchSite.some((value) => value.trim().toLowerCase() === "cross-site")) return {
		trusted: false,
		error: "forbidden"
	};
	const host = req.headers.host;
	if (typeof host !== "string") return {
		trusted: false,
		error: "forbidden"
	};
	const origin = effectiveOrigin(req, host);
	if (origin === void 0) return {
		trusted: false,
		error: "forbidden"
	};
	if (!sameOriginMetadata(req, host)) return {
		trusted: false,
		error: "forbidden"
	};
	if (localPeer && loopbackHost(host)) return { trusted: true };
	try {
		if (await trustedOrigins.has(origin)) return { trusted: true };
	} catch {
		return {
			trusted: false,
			error: "forbidden"
		};
	}
	return {
		trusted: false,
		error: REMOTE_WEB_ORIGIN_NOT_TRUSTED
	};
}
function json(res, status, value) {
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store",
		"x-content-type-options": "nosniff"
	});
	res.end(JSON.stringify(value));
}
/** Register the plugin-owned OAuth routes when the Web server is composed. */
function registerOpenAICodexAuthRoutes(ctx, store, trustedOriginsOverride) {
	const auth = new OpenAICodexWebAuth(store);
	const storedFilename = store.filename;
	const trustedOrigins = trustedOriginsOverride ?? (typeof storedFilename === "string" ? new OpenAICodexTrustedOriginsStore(join(dirname(storedFilename), ".openai-codex-trusted-origins.json")) : new OpenAICodexTrustedOriginsStore());
	ctx.effect(() => {
		const authorize = async (req, res) => {
			const decision = await trustedRequestDecision(req, trustedOrigins);
			if (decision.trusted) return true;
			json(res, 403, { error: decision.error });
			return false;
		};
		const routes = [
			ctx.webServer.register({
				kind: "exact",
				path: OPENAI_CODEX_AUTH_STATUS_PATH,
				handler: async (req, res) => {
					if (req.method !== "GET") return json(res, 405, { error: "method not allowed" });
					if (!await authorize(req, res)) return;
					json(res, 200, await auth.status());
				}
			}),
			ctx.webServer.register({
				kind: "exact",
				path: OPENAI_CODEX_AUTH_IMPORT_PATH,
				handler: async (req, res) => {
					if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
					if (!await authorize(req, res)) return;
					const confirmation = req.headers[OPENAI_CODEX_IMPORT_OVERWRITE_HEADER];
					if (confirmation !== void 0 && confirmation !== "confirm") return json(res, 400, { error: "invalid-overwrite-confirmation" });
					try {
						const result = await auth.importCodexCredential(confirmation === "confirm");
						if (result.status === "confirmation-required") return json(res, 409, { error: "existing-credential" });
						json(res, 200, result);
					} catch (error) {
						if (error instanceof CodexAuthImportError) return json(res, error.code === "codex-auth-not-found" ? 404 : error.code === "codex-auth-unreadable" ? 500 : 400, { error: error.code });
						json(res, 500, { error: safeMessage(error) });
					}
				}
			}),
			ctx.webServer.register({
				kind: "exact",
				path: OPENAI_CODEX_AUTH_LOGIN_PATH,
				handler: async (req, res) => {
					if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
					if (!await authorize(req, res)) return;
					try {
						json(res, 200, await auth.signIn());
					} catch (error) {
						json(res, 500, { error: safeMessage(error) });
					}
				}
			}),
			ctx.webServer.register({
				kind: "exact",
				path: OPENAI_CODEX_AUTH_LOGOUT_PATH,
				handler: async (req, res) => {
					if (req.method !== "POST") return json(res, 405, { error: "method not allowed" });
					if (!await authorize(req, res)) return;
					try {
						await auth.signOut();
						json(res, 200, { ok: true });
					} catch (error) {
						json(res, 500, { error: safeMessage(error) });
					}
				}
			})
		];
		return async () => {
			for (const dispose of routes) dispose();
			await auth.dispose();
		};
	}, "dsh-codex-connect: Web OAuth routes");
}
//#endregion
//#region src/compatibility.ts
const COMPATIBILITY_SCHEMA_VERSION = 1;
const SUPPORTED_NODE_RANGE = "^22.19.0 || >=24.0.0";
const SUPPORTED_DSH_PLUGIN_API_VERSION = "0.1.0-rc.6";
const SUPPORTED_PI_AI_VERSION = "0.82.1";
const PI_AI_PACKAGE = "@earendil-works/pi-ai";
const DSH_PLUGIN_API_PACKAGES = [
	"@deepseek-ai/dsh-agent",
	"@deepseek-ai/dsh-atomic-write",
	"@deepseek-ai/dsh-attachment",
	"@deepseek-ai/dsh-home-paths",
	"@deepseek-ai/dsh-host-webserver",
	"@deepseek-ai/dsh-invariants",
	"@deepseek-ai/dsh-llm",
	"@deepseek-ai/dsh-llm-pi-ai",
	"@deepseek-ai/dsh-fs",
	"@deepseek-ai/dsh-session",
	"@deepseek-ai/dsh-settings",
	"@deepseek-ai/dsh-tools",
	"@deepseek-ai/dsh-web"
];
const COMPATIBILITY_PACKAGES = [
	"@deepseek-ai/dsh-llm",
	"@deepseek-ai/dsh-llm-pi-ai",
	PI_AI_PACKAGE
];
/** Public contract data mirrored by compatibility.json without importing JSON at runtime. */
const COMPATIBILITY_CONTRACT = {
	schemaVersion: 1,
	engines: { node: SUPPORTED_NODE_RANGE },
	dshPluginApi: {
		version: SUPPORTED_DSH_PLUGIN_API_VERSION,
		packages: DSH_PLUGIN_API_PACKAGES
	},
	piAi: {
		package: PI_AI_PACKAGE,
		version: SUPPORTED_PI_AI_VERSION
	}
};
const PACKAGE_JSON_SEARCH_DEPTH = 8;
function compareVersion(left, right) {
	return left === right ? "compatible" : "incompatible";
}
function parseNodeVersion(value) {
	const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?$/u.exec(value.trim());
	if (match === null) return void 0;
	const major = Number(match[1]);
	const minor = Number(match[2]);
	const patch = Number(match[3]);
	if (![
		major,
		minor,
		patch
	].every(Number.isSafeInteger)) return void 0;
	return [
		major,
		minor,
		patch
	];
}
function nodeStatus(value) {
	if (value === void 0 || value === null || value.trim() === "") return "unknown";
	const parsed = parseNodeVersion(value);
	if (parsed === void 0) return "unknown";
	const [major, minor, patch] = parsed;
	if (major === 22) return minor > 19 || minor === 19 && patch >= 0 ? "compatible" : "incompatible";
	return major >= 24 ? "compatible" : "incompatible";
}
function packageEntry(supported, installed) {
	return {
		supported,
		installed: installed ?? null,
		status: installed === void 0 || installed === null || installed === "" ? "unknown" : compareVersion(installed, supported)
	};
}
function nodeEntry(installed) {
	return {
		supported: SUPPORTED_NODE_RANGE,
		installed: installed ?? null,
		status: nodeStatus(installed)
	};
}
function aggregateStatus(entries) {
	if (entries.some((entry) => entry.status === "incompatible")) return "incompatible";
	if (entries.some((entry) => entry.status === "unknown")) return "unknown";
	return "compatible";
}
/** Evaluate a captured set of versions without touching the filesystem. */
function evaluateCompatibility(input = {}) {
	const installedNode = input.nodeVersion ?? input.node ?? input.installed?.node;
	const suppliedPackages = input.packageVersions ?? input.packages ?? input.installed?.packages ?? {};
	const packages = {
		"@deepseek-ai/dsh-llm": packageEntry(SUPPORTED_DSH_PLUGIN_API_VERSION, suppliedPackages["@deepseek-ai/dsh-llm"]),
		"@deepseek-ai/dsh-llm-pi-ai": packageEntry(SUPPORTED_DSH_PLUGIN_API_VERSION, suppliedPackages["@deepseek-ai/dsh-llm-pi-ai"]),
		[PI_AI_PACKAGE]: packageEntry(SUPPORTED_PI_AI_VERSION, suppliedPackages[PI_AI_PACKAGE])
	};
	const node = nodeEntry(installedNode);
	return {
		schemaVersion: 1,
		status: aggregateStatus([node, ...Object.values(packages)]),
		node,
		packages
	};
}
/** Alias for callers that prefer assessment terminology. */
const assessCompatibility = evaluateCompatibility;
async function readPackageVersionFromEntry(name) {
	let entry;
	try {
		const resolved = import.meta.resolve(name);
		if (!resolved.startsWith("file:")) return void 0;
		entry = fileURLToPath(resolved);
	} catch {
		return;
	}
	let directory = dirname(entry);
	for (let depth = 0; depth < PACKAGE_JSON_SEARCH_DEPTH; depth += 1) {
		const candidate = join(directory, "package.json");
		try {
			const parsed = JSON.parse(await readFile(candidate, "utf8"));
			if (parsed.name === name && typeof parsed.version === "string") return parsed.version;
		} catch {}
		const parent = parse(directory).root === directory ? directory : dirname(directory);
		if (parent === directory) break;
		directory = parent;
	}
}
/** Read installed package metadata and return only versions and statuses. */
async function detectCompatibility(options = {}) {
	const readVersion = options.readPackageVersion ?? readPackageVersionFromEntry;
	const packageVersions = options.packageVersions ?? options.packages ?? options.installed?.packages;
	const resolvedPackages = packageVersions === void 0 ? Object.fromEntries(await Promise.all(COMPATIBILITY_PACKAGES.map(async (name) => [name, await readVersion(name)]))) : packageVersions;
	return evaluateCompatibility({
		nodeVersion: options.nodeVersion ?? options.node ?? options.installed?.node ?? process.version,
		packageVersions: resolvedPackages
	});
}
//#endregion
//#region src/version.ts
const CODEX_CONNECT_VERSION = "0.1.0-alpha.4.10";
//#endregion
//#region src/doctor.ts
/** Secret-free diagnostics and duplicate-provider guidance. */
/** Actionable message for legacy/manual `openai-codex` adapter collisions. */
function openAICodexConflictMessage() {
	return "Codex Connect cannot register provider \"openai-codex\" because another adapter already owns it. Remove or disable the legacy dsh-codex bundle or manual openai-codex provider row, then restart Harness.";
}
/** Fail before the generic registry error so the collision has a migration hint. */
function assertNoOpenAICodexProviderConflict(providerIds) {
	if (providerIds.includes("openai-codex")) throw new Error(openAICodexConflictMessage());
}
/**
* Inspect only process and filesystem metadata. This function never opens the
* OAuth document, refreshes a token, or starts an authorization flow.
*/
async function diagnoseOpenAICodex(options = {}) {
	const path = options.credentialPath ?? openAICodexAuthPath();
	let state = "missing";
	let mode;
	try {
		const info = await lstat(path);
		if (!info.isFile()) state = "not-a-regular-file";
		else if (process.platform === "win32") state = "owner-only";
		else {
			mode = (info.mode & 511).toString(8).padStart(3, "0");
			state = (info.mode & 63) === 0 ? "owner-only" : "permissions-too-broad";
		}
	} catch (error) {
		state = error?.code === "ENOENT" ? "missing" : "unreadable-metadata";
	}
	const providerConflict = options.providerIds?.includes("openai-codex") ?? false;
	const compatibility = await detectCompatibility(options.compatibilityOptions);
	const hints = [];
	if (state === "missing") hints.push("Sign in only when you are ready; installation does not start OAuth.");
	if (state === "permissions-too-broad") hints.push(`Restrict the OAuth file to its owner before use (current mode ${mode}).`);
	if (state === "not-a-regular-file") hints.push("Replace the OAuth path with an owner-only regular file created by Codex Connect login.");
	if (state === "unreadable-metadata") hints.push("Harness could not inspect the OAuth file metadata; check the parent directory and file ownership.");
	if (providerConflict) hints.push(openAICodexConflictMessage());
	if (!providerConflict) hints.push("If Harness reports a duplicate openai-codex adapter, remove the legacy bundle or manual provider row.");
	if (compatibility.status === "incompatible") hints.push("Compatibility mismatch: install the declared DSH plugin API versions and pin @earendil-works/pi-ai to 0.82.1, then run doctor again; no files are changed automatically.");
	else if (compatibility.status === "unknown") hints.push("Compatibility is unknown: verify the declared DSH plugin API and @earendil-works/pi-ai versions, then run doctor again.");
	return {
		package: "dsh-codex-connect",
		version: CODEX_CONNECT_VERSION,
		node: process.version,
		credentialFile: {
			path,
			state,
			...mode === void 0 ? {} : { mode }
		},
		capabilities: {
			modelProvider: true,
			search: options.enableSearch === true,
			imageTool: options.enableImageTool === true,
			changesHarnessDefaultModel: false,
			changesHarnessSearchRoute: false
		},
		providerConflict,
		compatibility,
		hints
	};
}
//#endregion
//#region src/proxy.ts
/**
* HTTP(S) CONNECT proxy transport for OpenAI/ChatGPT requests.
*
* The Codex provider in pi-ai streams over the runtime `fetch`, and Node's
* built-in fetch does not honor proxy environment variables, so a configured
* proxy is applied by replacing `globalThis.fetch` with a wrapper that is
* scoped to the plugin's first-party OpenAI endpoints. Requests to those hosts
* are tunneled with HTTP CONNECT and rebuilt as a fetch-compatible `Response`,
* which means the pi-ai SSE stream, the standalone search and usage fetches,
* and the OAuth token exchange all traverse the proxy without any per-call
* plumbing. Every other URL keeps flowing through the original `fetch`, and
* disposing the patch restores the original implementation exactly.
*
* Only http:// and https:// proxy URLs are supported; SOCKS and PAC are
* rejected at configuration time. The target may be http or https — a plain
* target is written straight into the tunnel while an https target is
* additionally wrapped in TLS, matching the CONNECT semantics of every
* mainstream HTTP proxy.
*/
/** Redirect ceiling applied by the tunneled fetch, matching the native fetch default. */
const MAX_REDIRECTS = 5;
/** First-party OpenAI/ChatGPT hosts owned by this plugin's provider. */
function isCodexHost(hostname) {
	const host = hostname.toLowerCase().replace(/\.$/u, "");
	return host === "chatgpt.com" || host.endsWith(".chatgpt.com") || host === "openai.com" || host.endsWith(".openai.com");
}
/** Whether one URL targets the OpenAI/ChatGPT endpoints the plugin proxies. */
function isCodexTargetUrl(url) {
	return isCodexHost(url.hostname);
}
function validPort(port) {
	return Number.isInteger(port) && port >= 1 && port <= 65535;
}
function bracketHost(hostname) {
	return hostname.includes(":") ? `[${hostname}]` : hostname;
}
/**
* Build the effective proxy endpoint from the user-facing settings.
*
* `proxyAddress` accepts a bare hostname/IP, `host:port`, or an explicit
* `http(s)://` URL. A port written into the address wins over `proxyPort`;
* otherwise `proxyPort` is required. An empty address, an unsupported scheme
* (for example SOCKS), or a missing port all resolve to `undefined`, which
* means "no proxy" — the caller must treat that as a direct connection.
*/
function buildCodexProxyConfig(input) {
	const raw = input.proxyAddress?.trim();
	if (raw === void 0 || raw.length === 0) return void 0;
	let url;
	try {
		url = new URL(raw.includes("://") ? raw : `http://${raw}`);
	} catch {
		return;
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") return void 0;
	if (url.hostname.length === 0) return void 0;
	let port = url.port === "" ? NaN : Number(url.port);
	if (!validPort(port)) port = input.proxyPort === void 0 ? NaN : input.proxyPort;
	if (!validPort(port)) return void 0;
	url.port = String(port);
	return url;
}
function abortReason(signal) {
	if (signal === void 0) return /* @__PURE__ */ new Error("fetch aborted");
	if (signal.reason instanceof Error) return signal.reason;
	return new DOMException("The operation was aborted.", "AbortError");
}
/** Headers hop-by-hop headers must never travel through the tunnel unmodified. */
const HOP_BY_HOP = /* @__PURE__ */ new Set([
	"connection",
	"keep-alive",
	"proxy-authenticate",
	"proxy-authorization",
	"te",
	"trailer",
	"transfer-encoding",
	"upgrade",
	"host"
]);
function headersRecord(headers) {
	for (const name of HOP_BY_HOP) headers.delete(name);
	const record = {};
	headers.forEach((value, key) => {
		record[key] = value;
	});
	return record;
}
/** Convert a fetch body into bytes; `null` marks an unsupported streaming body. */
function bodyBytes(body) {
	if (body === void 0 || body === null) return void 0;
	if (typeof body === "string") return Buffer.from(body, "utf8");
	if (body instanceof URLSearchParams) return Buffer.from(body.toString(), "utf8");
	if (body instanceof ArrayBuffer) return Buffer.from(body);
	if (ArrayBuffer.isView(body)) return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
	return null;
}
/**
* Open a CONNECT tunnel through `proxy` toward `target`. For an https target
* the tunnel socket is wrapped in TLS before it resolves; an http target keeps
* the raw tunneled socket. Aborts tear the tunnel down with the signal's reason.
*/
function openTunnel(target, proxy, signal) {
	return new Promise((resolve, reject) => {
		const connectAuthority = `${bracketHost(target.hostname)}:${target.port || (target.protocol === "https:" ? 443 : 80)}`;
		const connectHeaders = { host: connectAuthority };
		if (proxy.username !== "" || proxy.password !== "") {
			const credentials = `${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`;
			connectHeaders["proxy-authorization"] = `Basic ${Buffer.from(credentials, "utf8").toString("base64")}`;
		}
		let settled = false;
		let connectRequest;
		const fail = (error) => {
			if (settled) return;
			settled = true;
			signal?.removeEventListener("abort", onAbort);
			reject(error instanceof Error ? error : new Error(String(error)));
		};
		const onAbort = () => {
			fail(abortReason(signal));
			connectRequest?.destroy();
		};
		signal?.addEventListener("abort", onAbort, { once: true });
		const start = (proxySocket) => {
			const connectRequestStarted = request({
				host: bracketHost(proxy.hostname),
				port: Number(proxy.port),
				method: "CONNECT",
				path: connectAuthority,
				headers: connectHeaders,
				agent: false,
				...proxySocket === void 0 ? {} : { createConnection: () => proxySocket }
			});
			connectRequest = connectRequestStarted;
			connectRequestStarted.once("connect", (res, socket, head) => {
				if (res.statusCode !== 200) {
					socket.destroy();
					fail(/* @__PURE__ */ new Error(`proxy CONNECT to ${connectAuthority} failed with HTTP ${String(res.statusCode)}`));
					return;
				}
				if (head.length > 0) socket.unshift(head);
				if (target.protocol !== "https:") {
					if (settled) return;
					settled = true;
					signal?.removeEventListener("abort", onAbort);
					resolve({
						socket,
						destroy: () => {
							socket.destroy();
						}
					});
					return;
				}
				const tlsSocket = connect({
					socket,
					servername: target.hostname
				});
				const onTlsError = (error) => {
					fail(error);
				};
				tlsSocket.once("secureConnect", () => {
					if (settled) return;
					settled = true;
					signal?.removeEventListener("abort", onAbort);
					tlsSocket.off("error", onTlsError);
					tlsSocket.on("error", () => {});
					resolve({
						socket: tlsSocket,
						destroy: () => {
							try {
								socket.destroy();
							} catch {}
						}
					});
				});
				tlsSocket.on("error", onTlsError);
			});
			connectRequestStarted.once("error", (error) => {
				if (signal?.aborted === true) fail(abortReason(signal));
				else fail(error);
			});
			connectRequestStarted.end();
		};
		if (proxy.protocol === "https:") {
			const proxyTls = connect({
				host: proxy.hostname,
				port: Number(proxy.port),
				servername: proxy.hostname
			});
			proxyTls.once("secureConnect", () => start(proxyTls));
			proxyTls.once("error", fail);
		} else start();
	});
}
/** Perform one tunneled round trip and rebuild a fetch-compatible Response. */
async function roundTrip(target, init, proxy) {
	const signal = init.signal ?? void 0;
	if (signal?.aborted === true) throw abortReason(signal);
	const body = bodyBytes(init.body);
	if (body === null) throw new TypeError("request body type is not supported over the configured proxy");
	const tunnel = await openTunnel(target, proxy, signal);
	return await new Promise((resolve, reject) => {
		const pass = new PassThrough();
		let settled = false;
		const settle = (callback) => {
			if (settled) return;
			settled = true;
			callback();
		};
		const onAbort = () => {
			const error = abortReason(signal);
			tunnel.destroy();
			pass.destroy(error);
		};
		signal?.addEventListener("abort", onAbort, { once: true });
		const releaseAbort = () => {
			signal?.removeEventListener("abort", onAbort);
		};
		pass.once("end", releaseAbort);
		pass.once("error", releaseAbort);
		const onResponse = (response) => {
			response.pipe(pass);
			const headers = new Headers();
			for (const [name, value] of Object.entries(response.headers)) {
				if (value === void 0) continue;
				if (Array.isArray(value)) for (const item of value) headers.append(name, item);
				else headers.set(name, value);
			}
			const result = new Response(Readable.toWeb(pass), {
				status: response.statusCode ?? 0,
				statusText: response.statusMessage ?? "",
				headers
			});
			settle(() => resolve(result));
		};
		const requestOptions = {
			method: (init.method ?? "GET").toUpperCase(),
			hostname: target.hostname,
			port: target.port === "" ? target.protocol === "https:" ? 443 : 80 : Number(target.port),
			path: `${target.pathname}${target.search}`,
			headers: headersRecord(new Headers(init.headers)),
			agent: false,
			createConnection: () => tunnel.socket
		};
		const request$3 = target.protocol === "https:" ? request$1(requestOptions, onResponse) : request(requestOptions, onResponse);
		request$3.once("error", (error) => {
			if (signal?.aborted === true) settle(() => reject(abortReason(signal)));
			else settle(() => reject(error));
		});
		if (body !== void 0) request$3.end(body);
		else request$3.end();
	});
}
/**
* Fetch through `proxy`, following redirects like the native fetch. `redirect`
* is honored: `error` rejects on a redirect, `manual` returns it as-is.
*/
async function proxyFetch(input, init, proxy, redirects = 0) {
	const target = new URL(String(input));
	const options = init ?? {};
	const response = await roundTrip(target, options, proxy);
	const status = response.status;
	if (status < 300 || status >= 400) return response;
	const location = response.headers.get("location");
	if (location === null) return response;
	const mode = options.redirect ?? "follow";
	if (mode === "error") throw new TypeError("fetch failed", { cause: /* @__PURE__ */ new TypeError(`unexpected redirect to ${location}`) });
	if (mode === "manual") return response;
	if (redirects >= MAX_REDIRECTS) throw new TypeError("fetch failed", { cause: /* @__PURE__ */ new Error("too many redirects") });
	const next = new URL(location, target);
	const nextInit = { ...options };
	delete nextInit.body;
	if (status === 303) nextInit.method = "GET";
	return proxyFetch(next, nextInit, proxy, redirects + 1);
}
/**
* Replace the runtime fetch with a proxy-aware wrapper until the returned
* disposer is called. Requests whose URL targets the plugin's first-party
* OpenAI/ChatGPT hosts are tunneled through `proxy`; everything else —
* including the local Harness web server — is delegated to the original
* fetch untouched. Dispose restores the exact original implementation.
* @param proxy - validated proxy endpoint from {@link buildCodexProxyConfig}.
* @returns disposer removing the patch.
*/
function installCodexProxyFetch(proxy) {
	const original = globalThis.fetch;
	const patched = ((input, init) => {
		let url;
		try {
			url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
		} catch {
			url = void 0;
		}
		if (url !== void 0 && isCodexTargetUrl(url)) return proxyFetch(url, init, proxy);
		return original(input, init);
	});
	globalThis.fetch = patched;
	return () => {
		if (globalThis.fetch === patched) globalThis.fetch = original;
	};
}
//#endregion
//#region src/public-http.ts
/** Public-network-only HTTP(S) reader used by the optional remote image path. */
/** Maximum time one DNS-plus-HTTP hop may occupy. */
const PUBLIC_HTTP_HOP_TIMEOUT_MS = 3e4;
function blockedList(family, ranges) {
	const list = new BlockList();
	for (const [address, prefix] of ranges) list.addSubnet(address, prefix, family);
	return list;
}
const BLOCKED_IPV4 = blockedList("ipv4", [
	["0.0.0.0", 8],
	["10.0.0.0", 8],
	["100.64.0.0", 10],
	["127.0.0.0", 8],
	["169.254.0.0", 16],
	["172.16.0.0", 12],
	["192.0.0.0", 24],
	["192.0.2.0", 24],
	["192.88.99.0", 24],
	["192.168.0.0", 16],
	["198.18.0.0", 15],
	["198.51.100.0", 24],
	["203.0.113.0", 24],
	["224.0.0.0", 4],
	["240.0.0.0", 4]
]);
const GLOBAL_IPV6 = blockedList("ipv6", [["2000::", 3]]);
const BLOCKED_IPV6 = blockedList("ipv6", [
	["2001::", 32],
	["2001:2::", 48],
	["2001:10::", 28],
	["2001:20::", 28],
	["2001:db8::", 32],
	["2002::", 16]
]);
function unbracket(hostname) {
	return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}
/** Whether an address is ordinary public unicast rather than a local/special target. */
function isPublicNetworkAddress(rawAddress) {
	const address = unbracket(rawAddress);
	if (address.includes("%")) return false;
	const family = isIP(address);
	if (family === 4) return !BLOCKED_IPV4.check(address, "ipv4");
	if (family === 6) return GLOBAL_IPV6.check(address, "ipv6") && !BLOCKED_IPV6.check(address, "ipv6");
	return false;
}
function abortError(signal) {
	return signal.reason instanceof Error ? signal.reason : new Error(signal.reason === void 0 ? "remote image request aborted" : String(signal.reason));
}
function assertTargetUrl(url) {
	if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("view_image URL must use http or https");
	if (url.username !== "" || url.password !== "") throw new Error("view_image URL must not contain credentials");
}
function normalizeAddress(candidate) {
	if (candidate.family !== 4 && candidate.family !== 6) throw new Error("remote image hostname resolved to an unsupported address family");
	return {
		address: candidate.address,
		family: candidate.family
	};
}
async function resolveHost(hostname, signal) {
	if (signal.aborted) throw abortError(signal);
	const literal = unbracket(hostname);
	const family = isIP(literal);
	if (family === 4 || family === 6) return [{
		address: literal,
		family
	}];
	const results = await lookup(literal, {
		all: true,
		order: "verbatim"
	});
	if (signal.aborted) throw abortError(signal);
	return results.map(normalizeAddress);
}
/** Collect one response body while enforcing declared and streaming size limits. */
async function collectBoundedBytes(body, declaredLength, maxBytes, signal) {
	const declared = declaredLength === void 0 ? NaN : Number(declaredLength);
	if (Number.isFinite(declared) && declared > maxBytes) throw new Error(`remote image exceeds ${String(maxBytes)} bytes`);
	const chunks = [];
	let total = 0;
	for await (const chunk of body) {
		if (signal.aborted) throw abortError(signal);
		const bytes = typeof chunk === "string" ? Buffer.from(chunk) : new Uint8Array(chunk);
		total += bytes.byteLength;
		if (total > maxBytes) throw new Error(`remote image exceeds ${String(maxBytes)} bytes`);
		chunks.push(bytes);
	}
	const data = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		data.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return data;
}
function pinnedLookup(address) {
	return (_hostname, options, callback) => {
		const resolved = {
			address: address.address,
			family: address.family
		};
		if (options.all === true) callback(null, [resolved]);
		else callback(null, resolved.address, resolved.family);
	};
}
function headerValue(message, name) {
	const value = message.headers[name];
	return Array.isArray(value) ? value[0] : value;
}
async function requestPinned(url, address, maxBytes, signal) {
	if (signal.aborted) throw abortError(signal);
	return new Promise((resolve, reject) => {
		let settled = false;
		let response;
		const finish = (result) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			signal.removeEventListener("abort", onAbort);
			if (result.ok) resolve(result.value);
			else reject(result.error);
		};
		const request$2 = (url.protocol === "https:" ? request$1 : request)(url, {
			method: "GET",
			agent: false,
			lookup: pinnedLookup(address),
			headers: { accept: "image/png, image/jpeg, image/webp, image/gif" }
		}, (incoming) => {
			response = incoming;
			const status = incoming.statusCode ?? 0;
			const location = headerValue(incoming, "location");
			if (status >= 300 && status < 400 || status < 200 || status >= 300) {
				finish({
					ok: true,
					value: {
						status,
						...location === void 0 ? {} : { location }
					}
				});
				incoming.destroy();
				return;
			}
			collectBoundedBytes(incoming, headerValue(incoming, "content-length"), maxBytes, signal).then((data) => {
				finish({
					ok: true,
					value: {
						status,
						data
					}
				});
			}, (error) => {
				incoming.destroy(error instanceof Error ? error : void 0);
				finish({
					ok: false,
					error
				});
			});
		});
		const onAbort = () => {
			const error = abortError(signal);
			response?.destroy(error);
			request$2.destroy(error);
		};
		const timer = setTimeout(() => {
			const error = /* @__PURE__ */ new Error(`remote image request exceeded ${String(PUBLIC_HTTP_HOP_TIMEOUT_MS)}ms`);
			response?.destroy(error);
			request$2.destroy(error);
		}, PUBLIC_HTTP_HOP_TIMEOUT_MS);
		timer.unref();
		signal.addEventListener("abort", onAbort, { once: true });
		request$2.once("error", (error) => {
			finish({
				ok: false,
				error
			});
		});
		request$2.end();
	});
}
/** Production resolver and one-shot agent which pins the validated address. */
const NODE_PUBLIC_HTTP_RUNTIME = {
	resolve: resolveHost,
	get: requestPinned
};
/** Fetch bytes from a public HTTP(S) target, revalidating and repinning each redirect. */
async function fetchPublicHttpResource(source, maxBytes, signal, runtime = NODE_PUBLIC_HTTP_RUNTIME) {
	let url = new URL(source);
	assertTargetUrl(url);
	for (let redirects = 0;; redirects += 1) {
		if (signal.aborted) throw abortError(signal);
		const addresses = await runtime.resolve(url.hostname, signal);
		if (addresses.length === 0 || addresses.some((candidate) => !isPublicNetworkAddress(candidate.address))) throw new Error(`remote image host ${JSON.stringify(url.hostname)} must resolve only to public network addresses`);
		const hop = await runtime.get(url, addresses[0], maxBytes, signal);
		if (hop.status >= 300 && hop.status < 400) {
			if (redirects >= 5) throw new Error(`remote image exceeded ${String(5)} redirects`);
			if (hop.location === void 0) throw new Error(`remote image redirect ${String(hop.status)} has no location`);
			url = new URL(hop.location, url);
			assertTargetUrl(url);
			continue;
		}
		if (hop.status < 200 || hop.status >= 300) throw new Error(`remote image request failed with HTTP ${String(hop.status)}`);
		if (hop.data === void 0) throw new Error("remote image response did not contain a body");
		const name = basename(url.pathname) || void 0;
		return {
			data: hop.data,
			display: url.href,
			...name === void 0 ? {} : { name }
		};
	}
}
//#endregion
//#region src/view-image.ts
/** Codex-compatible `view_image` tool for local paths and HTTP(S) URLs. */
/** Stable Codex tool name. */
const VIEW_IMAGE_TOOL_NAME = "view_image";
function refOf(image) {
	return {
		attachmentId: AttachmentId(image.attachmentId),
		mediaType: image.mediaType,
		bytes: image.bytes,
		width: image.width,
		height: image.height,
		...image.name === void 0 ? {} : { name: image.name }
	};
}
function contentOf(value) {
	return [{
		type: "text",
		text: `<source>${value.source}</source>\n<image>${value.image.mediaType}, ${value.image.width}x${value.image.height} px, ${value.image.bytes} bytes</image>`
	}, {
		type: "image",
		attachment: refOf(value.image)
	}];
}
function mediaTypeOf(data) {
	if (data.length >= 8 && data[0] === 137 && data[1] === 80 && data[2] === 78 && data[3] === 71 && data[4] === 13 && data[5] === 10 && data[6] === 26 && data[7] === 10) return "image/png";
	if (data.length >= 3 && data[0] === 255 && data[1] === 216 && data[2] === 255) return "image/jpeg";
	if (data.length >= 6) {
		const signature = String.fromCharCode(...data.subarray(0, 6));
		if (signature === "GIF87a" || signature === "GIF89a") return "image/gif";
	}
	if (data.length >= 12 && String.fromCharCode(...data.subarray(0, 4)) === "RIFF" && String.fromCharCode(...data.subarray(8, 12)) === "WEBP") return "image/webp";
}
async function assertImageCapable(ctx, exec, source) {
	const configured = exec.agent?.session.requestHeader()?.config;
	const provider = configured?.provider ?? exec.agent?.options.provider;
	const model = configured?.model ?? exec.agent?.options.model;
	if (provider === void 0 || model === void 0) throw new Error(`cannot view ${JSON.stringify(source)}: the current model route is unavailable`);
	const info = await ctx.llm.resolveModelInfo(provider, model, exec.signal);
	if (info.inputModalities === void 0 || !info.inputModalities.includes("image")) throw new Error(`cannot view ${JSON.stringify(source)}: model "${model}" does not declare image input`);
}
/** Build the plugin-owned image viewing tool. */
function viewImageTool(ctx) {
	return defineTool({
		name: VIEW_IMAGE_TOOL_NAME,
		description: "View an image from a local file path or an http(s) URL. Returns the actual PNG, JPEG, WebP, or GIF image to vision-capable models.",
		parameters: { source: {
			type: "string",
			required: true,
			description: "Local absolute/relative image path, or an http(s) image URL."
		} },
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					source: {
						type: "string",
						required: true
					},
					image: {
						type: "object",
						required: true,
						additionalProperties: false,
						properties: {
							attachmentId: {
								type: "string",
								required: true
							},
							mediaType: {
								type: "string",
								required: true,
								enum: [
									"image/png",
									"image/jpeg",
									"image/webp",
									"image/gif"
								]
							},
							bytes: {
								type: "integer",
								required: true
							},
							width: {
								type: "integer",
								required: true
							},
							height: {
								type: "integer",
								required: true
							},
							name: { type: "string" }
						}
					}
				}
			},
			render: (_args, value) => contentOf(value)
		},
		isConcurrencySafe: () => true,
		async execute(args, exec) {
			const source = args.source.trim();
			if (source.length === 0) throw new Error("view_image source must not be empty");
			await assertImageCapable(ctx, exec, source);
			const attachments = ctx.attachments;
			const maxBytes = Math.min(attachments.imageLimits.maxImageBytes, attachments.imageLimits.maxMessageImageBytes);
			let loaded;
			if (/^https?:\/\//iu.test(source)) loaded = await fetchPublicHttpResource(source, maxBytes, exec.signal);
			else {
				const cwd = exec.agent?.session.header.cwd;
				const target = await ctx.fs.resolve(source, {
					...cwd === void 0 ? {} : { cwd },
					signal: exec.signal
				});
				const info = await ctx.fs.stat(target, exec.signal);
				if (info === void 0) throw new Error(`image path does not exist: ${source}`);
				if (info.type !== "file") throw new Error(`image path is not a regular file: ${source}`);
				loaded = {
					data: await ctx.fs.readBytes(target, exec.signal, maxBytes),
					display: target.displayPath,
					name: basename(target.displayPath)
				};
				ctx.emit("fs/observed", target, {
					kind: "present",
					version: info.version
				}, exec);
			}
			const mediaType = mediaTypeOf(loaded.data);
			if (mediaType === void 0) throw new Error("view_image supports PNG, JPEG, WebP, and GIF image bytes");
			if (!attachments.imageLimits.mediaTypes.includes(mediaType)) throw new Error(`${mediaType} images are disabled by this deployment`);
			const ref = await attachments.saveImage({
				data: loaded.data,
				mediaType,
				...loaded.name === void 0 ? {} : { name: loaded.name }
			});
			const value = {
				source: loaded.display,
				image: {
					attachmentId: ref.attachmentId,
					mediaType: ref.mediaType,
					bytes: ref.bytes,
					width: ref.width,
					height: ref.height,
					...ref.name === void 0 ? {} : { name: ref.name }
				}
			};
			if (exec.parent !== void 0) exec.deferContext(createUserMessage({
				content: contentOf(value),
				source: {
					kind: "plugin",
					plugin: "dsh-codex-connect"
				}
			}));
			return value;
		},
		presentCall: (args) => ({
			card: "generic",
			title: `View image ${args.source}`,
			kind: /^https?:\/\//iu.test(args.source) ? "fetch" : "read",
			.../^https?:\/\//iu.test(args.source) ? { rawInput: args.source } : { locations: [{ path: args.source }] }
		})
	});
}
//#endregion
//#region src/search-event.ts
/** Dedicated log event written before an OpenAI Codex search dispatch. */
const OPENAI_CODEX_SEARCH_MODEL_REQUEST_EVENT = "web/openai-codex-search-llm-request";
/**
* Register the plugin-owned event in the running Harness vocabulary. The
* public DSH build exports its known-event collection as read-only because
* core code must not mutate it accidentally; the runtime value is the Set
* deliberately consulted on every persistence read. Registration remains for
* the process lifetime so sessions written before an HMR cycle stay readable.
*/
function installOpenAICodexSearchEvent() {
	if (!(KNOWN_SESSION_EVENT_TYPES instanceof Set)) throw new Error("dsh-codex-connect: this Harness build does not expose an extensible session event vocabulary");
	KNOWN_SESSION_EVENT_TYPES.add(OPENAI_CODEX_SEARCH_MODEL_REQUEST_EVENT);
}
/**
* Append one resolved request to the initiating agent's session. Searches
* outside an agent turn have no owning session and therefore produce no log.
* @param ctx - plugin context carrying the optional active-agent service.
* @param request - exact request after defaults, excluding credentials.
*/
function recordOpenAICodexSearchRequest(ctx, request) {
	ctx.get("agents")?.currentInitiator()?.session.append(OPENAI_CODEX_SEARCH_MODEL_REQUEST_EVENT, request);
}
//#endregion
//#region src/settings-contract.ts
/** Node-free settings contract shared by the Host plugin and browser card. */
/** Stable Harness settings namespace owned by this plugin. */
const OPENAI_CODEX_SETTINGS_NAMESPACE = "llm-openai-codex";
/** Default model used by the standalone search endpoint. */
const DEFAULT_OPENAI_CODEX_SEARCH_MODEL = "gpt-5.6-sol";
/** Default search mode, matching the official local Codex client. */
const DEFAULT_OPENAI_CODEX_SEARCH_MODE = "cached";
/** Default provider search-context size. */
const DEFAULT_OPENAI_CODEX_SEARCH_CONTEXT_SIZE = "medium";
/** Default output budget for the standalone search response. */
const DEFAULT_OPENAI_CODEX_SEARCH_MAX_OUTPUT_TOKENS = 1e4;
const DEFAULT_OPENAI_CODEX_SETTINGS = Object.freeze({
	enableSearch: false,
	enableImageTool: false,
	searchModel: DEFAULT_OPENAI_CODEX_SEARCH_MODEL,
	searchMode: DEFAULT_OPENAI_CODEX_SEARCH_MODE,
	searchContextSize: DEFAULT_OPENAI_CODEX_SEARCH_CONTEXT_SIZE,
	searchMaxOutputTokens: DEFAULT_OPENAI_CODEX_SEARCH_MAX_OUTPUT_TOKENS,
	proxyAddress: ""
});
/** Fill the schema defaults even when called without Cordis validation. */
function resolveOpenAICodexSettings(value) {
	return {
		...DEFAULT_OPENAI_CODEX_SETTINGS,
		...value
	};
}
function isRecord$1(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** Narrow the redacted settings wire payload before it enters React state. */
function decodeOpenAICodexSettings(value) {
	if (!isRecord$1(value)) return void 0;
	const enableSearch = value["enableSearch"];
	const enableImageTool = value["enableImageTool"];
	const searchModel = value["searchModel"];
	const searchMode = value["searchMode"];
	const searchContextSize = value["searchContextSize"];
	const searchMaxOutputTokens = value["searchMaxOutputTokens"];
	const contextWindow = value["contextWindow"];
	const proxyAddress = value["proxyAddress"];
	const proxyPort = value["proxyPort"];
	if (typeof enableSearch !== "boolean" || typeof enableImageTool !== "boolean") return void 0;
	if (typeof searchModel !== "string" || searchModel.trim().length === 0) return void 0;
	if (searchMode !== "cached" && searchMode !== "indexed" && searchMode !== "live") return void 0;
	if (searchContextSize !== "low" && searchContextSize !== "medium" && searchContextSize !== "high") return void 0;
	if (typeof searchMaxOutputTokens !== "number" || !Number.isInteger(searchMaxOutputTokens) || searchMaxOutputTokens < 1) return void 0;
	const resolvedContextWindow = contextWindow === void 0 || contextWindow === null ? void 0 : typeof contextWindow === "number" && Number.isSafeInteger(contextWindow) && contextWindow >= 1 ? contextWindow : void 0;
	if (contextWindow !== void 0 && contextWindow !== null && resolvedContextWindow === void 0) return void 0;
	if (typeof proxyAddress !== "string") return void 0;
	const resolvedProxyPort = proxyPort === void 0 || proxyPort === null ? void 0 : typeof proxyPort === "number" && Number.isInteger(proxyPort) && proxyPort >= 1 && proxyPort <= 65535 ? proxyPort : void 0;
	if (proxyPort !== void 0 && proxyPort !== null && resolvedProxyPort === void 0) return void 0;
	return {
		enableSearch,
		enableImageTool,
		searchModel,
		searchMode,
		searchContextSize,
		searchMaxOutputTokens,
		...resolvedContextWindow === void 0 ? {} : { contextWindow: resolvedContextWindow },
		proxyAddress,
		...resolvedProxyPort === void 0 ? {} : { proxyPort: resolvedProxyPort }
	};
}
//#endregion
//#region src/search.ts
/**
* OpenAI Codex standalone web search over the dsh web provider seam.
* @module dsh-codex-connect/search
*/
/** Stable dsh web-provider id selected by the bundle patch. */
const OPENAI_CODEX_SEARCH_PROVIDER = OPENAI_CODEX_PROVIDER;
/** Trusted first-party Codex base; OAuth credentials never cross to a configured origin. */
const OPENAI_CODEX_BASE_URL = "https://chatgpt.com/backend-api/codex";
/** Standalone search endpoint used by the official Codex client. */
const OPENAI_CODEX_SEARCH_URL = `${OPENAI_CODEX_BASE_URL}/alpha/search`;
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
//#region src/index.ts
/** Stable Cordis plugin name. */
const name = "llm-openai-codex";
/** The model registry required before the provider can register. */
const inject = ["llm"];
/** Branded Host settings namespace used by the configurable-provider directory. */
const OPENAI_CODEX_SETTINGS_NS = settingsNamespace(OPENAI_CODEX_SETTINGS_NAMESPACE);
const Config = z.object({
	enableSearch: z.boolean().default(false),
	enableImageTool: z.boolean().default(false),
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
	searchMaxOutputTokens: z.number().step(1).min(1).default(DEFAULT_OPENAI_CODEX_SEARCH_MAX_OUTPUT_TOKENS),
	contextWindow: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER),
	proxyAddress: z.string().default(""),
	proxyPort: z.number().step(1).min(1).max(65535)
});
/**
* Register the `openai-codex` LLM route with one provider-native OAuth store.
* Search and image tooling are added only when their config flags are true.
* Selecting this route as the Harness default remains a separate profile choice.
* @param ctx - plugin context carrying the LLM registry plus optional services.
* @param config - capability gates and standalone-search tuning.
*/
function apply(ctx, config) {
	let current = () => config;
	const credentials = new OpenAICodexCredentialStore();
	assertNoOpenAICodexProviderConflict(ctx.llm.listProviders().map((provider) => provider.id));
	ctx.llm.registerAdapter([OPENAI_CODEX_PROVIDER], createOpenAICodexAdapter(credentials, () => ctx.get("attachments"), () => buildCodexProxyConfig(resolveOpenAICodexSettings(current())) !== void 0, () => resolveOpenAICodexSettings(current()).contextWindow));
	ctx.llm.registerConfigurableProviders([{
		provider: OPENAI_CODEX_PROVIDER,
		displayName: "OpenAI Codex",
		settingsNs: OPENAI_CODEX_SETTINGS_NS,
		settingsPath: [],
		declared: false
	}]);
	ctx.inject(["webServer"], (webCtx) => registerOpenAICodexAuthRoutes(webCtx, credentials));
	let stopped = false;
	let searchFiber;
	let searchRegistration;
	let searchTail = Promise.resolve();
	let imageFiber;
	let imageTail = Promise.resolve();
	let proxyPatch;
	let proxyKey = "";
	let proxyTail = Promise.resolve();
	const reconcileSearch = async () => {
		if (stopped) return;
		const resolved = resolveOpenAICodexSettings(current());
		const nextRegistration = resolved.enableSearch ? {
			model: resolved.searchModel,
			mode: resolved.searchMode,
			contextSize: resolved.searchContextSize,
			maxOutputTokens: resolved.searchMaxOutputTokens
		} : void 0;
		if (deepEqualJson(nextRegistration, searchRegistration)) return;
		const previous = searchFiber;
		searchFiber = void 0;
		searchRegistration = void 0;
		if (previous !== void 0) await previous.dispose();
		if (stopped || nextRegistration === void 0) return;
		installOpenAICodexSearchEvent();
		const fiber = ctx.inject(["web"], (webCtx) => webCtx.web.registerSearchProvider(new OpenAICodexSearchProvider({
			credentials,
			model: nextRegistration.model,
			mode: nextRegistration.mode,
			contextSize: nextRegistration.contextSize,
			maxOutputTokens: nextRegistration.maxOutputTokens,
			resolveRequestId: () => String(webCtx.get("agents")?.currentInitiator()?.session.id ?? randomUUID()),
			recordRequest: (request) => {
				recordOpenAICodexSearchRequest(webCtx, request);
			}
		})));
		searchFiber = fiber;
		searchRegistration = nextRegistration;
		Promise.resolve(fiber).catch((error) => {
			if (searchFiber === fiber) {
				searchFiber = void 0;
				searchRegistration = void 0;
			}
			ctx.logger.error("dsh-codex-connect: optional search provider failed to activate");
			ctx.logger.error(error);
		});
	};
	const reconcileImageTool = async () => {
		if (stopped) return;
		const enabled = resolveOpenAICodexSettings(current()).enableImageTool;
		if (enabled === (imageFiber !== void 0)) return;
		const previous = imageFiber;
		imageFiber = void 0;
		if (previous !== void 0) await previous.dispose();
		if (stopped || !enabled) return;
		const fiber = ctx.inject([
			"tools",
			"fs",
			"attachments"
		], (toolCtx) => toolCtx.tools.register(viewImageTool(toolCtx)));
		imageFiber = fiber;
		Promise.resolve(fiber).catch((error) => {
			if (imageFiber === fiber) imageFiber = void 0;
			ctx.logger.error("dsh-codex-connect: optional view_image tool failed to activate");
			ctx.logger.error(error);
		});
	};
	/**
	* Apply or remove the proxy fetch patch for the current settings. The patch
	* is scoped to the first-party OpenAI/ChatGPT hosts, so changing the proxy
	* setting reroutes the next request while every other URL keeps the original
	* fetch. A blank address removes the patch and restores direct connections.
	*/
	const reconcileProxy = async () => {
		if (stopped) return;
		const config = buildCodexProxyConfig(resolveOpenAICodexSettings(current()));
		const key = config === void 0 ? "" : config.href;
		if (key === proxyKey) return;
		if (proxyPatch !== void 0) {
			proxyPatch();
			proxyPatch = void 0;
		}
		proxyKey = key;
		if (config !== void 0) proxyPatch = installCodexProxyFetch(config);
	};
	const scheduleCapabilities = () => {
		searchTail = searchTail.then(reconcileSearch, reconcileSearch).catch((error) => {
			ctx.logger.error("dsh-codex-connect: could not apply the updated search configuration");
			ctx.logger.error(error);
		});
		imageTail = imageTail.then(reconcileImageTool, reconcileImageTool).catch((error) => {
			ctx.logger.error("dsh-codex-connect: could not apply the updated image-tool configuration");
			ctx.logger.error(error);
		});
		proxyTail = proxyTail.then(reconcileProxy, reconcileProxy).catch((error) => {
			ctx.logger.error("dsh-codex-connect: could not apply the updated proxy configuration");
			ctx.logger.error(error);
		});
	};
	ctx.effect(() => async () => {
		stopped = true;
		await Promise.all([
			searchTail,
			imageTail,
			proxyTail
		]);
		if (proxyPatch !== void 0) {
			proxyPatch();
			proxyPatch = void 0;
		}
		const search = searchFiber;
		const image = imageFiber;
		searchFiber = void 0;
		imageFiber = void 0;
		await Promise.allSettled([search?.dispose() ?? Promise.resolve(), image?.dispose() ?? Promise.resolve()]);
	}, "dsh-codex-connect: optional capability lifecycle");
	installSettingsSection(ctx, OPENAI_CODEX_SETTINGS_NS, Config, config, {
		setSource(source) {
			current = source;
		},
		onChange: scheduleCapabilities
	});
	scheduleCapabilities();
}
//#endregion
export { loginOpenAICodex as $, CODEX_CONNECT_VERSION as A, detectCompatibility as B, buildCodexProxyConfig as C, assertNoOpenAICodexProviderConflict as D, proxyFetch as E, PI_AI_PACKAGE as F, parseOpenAICodexUsage as G, OpenAICodexTrustedOriginsStore as H, SUPPORTED_DSH_PLUGIN_API_VERSION as I, MAX_CODEX_AUTH_IMPORT_BYTES as J, readOpenAICodexRateLimits as K, SUPPORTED_NODE_RANGE as L, COMPATIBILITY_PACKAGES as M, COMPATIBILITY_SCHEMA_VERSION as N, diagnoseOpenAICodex as O, DSH_PLUGIN_API_PACKAGES as P, readCodexAuthCredential as Q, SUPPORTED_PI_AI_VERSION as R, VIEW_IMAGE_TOOL_NAME as S, isCodexTargetUrl as T, normalizeTrustedOrigin as U, evaluateCompatibility as V, OPENAI_CODEX_USAGE_URL as W, importCodexAuthCredential as X, codexAuthJsonPath as Y, parseCodexAuthJson as Z, decodeOpenAICodexSettings as _, name as a, openAICodexAuthPath as at, installOpenAICodexSearchEvent as b, OPENAI_CODEX_SEARCH_URL as c, DEFAULT_OPENAI_CODEX_SEARCH_CONTEXT_SIZE as d, logoutOpenAICodex as et, DEFAULT_OPENAI_CODEX_SEARCH_MAX_OUTPUT_TOKENS as f, OPENAI_CODEX_SETTINGS_NAMESPACE as g, DEFAULT_OPENAI_CODEX_SETTINGS as h, inject as i, OpenAICodexCredentialStore as it, COMPATIBILITY_CONTRACT as j, openAICodexConflictMessage as k, OpenAICodexSearchProvider as l, DEFAULT_OPENAI_CODEX_SEARCH_MODEL as m, OPENAI_CODEX_SETTINGS_NS as n, OPENAI_CODEX_AUTH_FILENAME as nt, OPENAI_CODEX_BASE_URL as o, DEFAULT_OPENAI_CODEX_SEARCH_MODE as p, CodexAuthImportError as q, apply as r, OPENAI_CODEX_PROVIDER as rt, OPENAI_CODEX_SEARCH_PROVIDER as s, Config as t, openAICodexAuthStatus as tt, mapOpenAICodexSearchResponse as u, resolveOpenAICodexSettings as v, installCodexProxyFetch as w, recordOpenAICodexSearchRequest as x, OPENAI_CODEX_SEARCH_MODEL_REQUEST_EVENT as y, assessCompatibility as z };
