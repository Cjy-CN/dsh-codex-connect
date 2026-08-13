# Design: OpenAI Codex subscription bundle

Status: implemented

English | [中文](design.zh.md)

Compatibility: requires the modified `Yan-Zero/deepseek-harness` fork at commit `b1d42fc99f` or a descendant; the unmodified upstream/public release does not expose the extension points this bundle consumes.

## Problem

The generic `llm-pi-ai` plugin can already preserve pi-ai's installed `openai-codex` protocol and model catalog, but its settings surface intentionally owns API-key references and constructs no OAuth credential store. Manually declaring the route therefore cannot refresh a ChatGPT credential, while treating an OAuth access token as `apiKeyEnv` expires without recovery. OpenCode's third-party Codex plugin demonstrates that ChatGPT subscription access requires a provider-native OAuth flow plus the ChatGPT Codex Responses backend, not use of the OAuth token as a general `api.openai.com/v1` key. The integration also has model-runtime obligations beyond login: stateless history, encrypted reasoning replay, tool-pair preservation, usage and overflow classification, compaction through the ordinary LLM seam, and citeable search whose model-visible inputs and outputs remain reconstructable.

## Decision

**Subscription access is an optional composition bundle.** `@dsh-external/dsh-openai-codex` contributes one composite `llm-openai-codex` row, changes the composition default for new Agents to `openai-codex` / `gpt-5.6-sol`, and selects the same id for `ctx.web.search`; a saved model selection still wins. The generic Models settings directory continues to exclude OAuth-only providers, so it never renders Codex as an API-key card. A manually configured `llm-pi-ai.providers.openai-codex` route conflicts loudly with the dedicated bundle instead of creating ambiguous ownership.

**The plugin owns explicit terminal login.** Its `dsh-openai-codex` executable runs without booting a profile and supports login, logout, and status. Browser PKCE is the default and device code is explicit for headless hosts. It delegates OAuth endpoints, account-id extraction, token refresh, and Codex request authentication to the pinned pi-ai provider rather than copying OpenCode or Codex CLI constants. The credential is a strict versioned JSON document at `$DSH_HOME/.openai-codex-auth.json`, created and atomically replaced owner-only; cross-process writer locking covers login, refresh, and logout. It is separate from `~/.codex/auth.json` so two independently written stores never race a rotating refresh token. Diagnostics and status expose no token values.

**The provider remains on the shared LLM path.** `createPiAiCatalogAuthAdapter()` is the narrow `llm-pi-ai` extension point that accepts a provider-native credential store while retaining the installed provider's catalog, protocol implementation, request conversion, replay projection, and stream translation. The configurable plugin still passes API keys per request and injects no store. The Codex bundle registers the resulting adapter on `ctx.llm`, so normal turns and `dsh-compaction-basic` auxiliary calls use the same logged messages, tool schemas, session identity, cancellation, usage, finish, and overflow behavior.

**Codex stateless replay is durable.** The provider sends `store: false` and requests `reasoning.encrypted_content`. `llm-pi-ai` persists the encrypted item inside its versioned replay state and restores it only under the same adapter/provider/model identity. Tool calls and results are reconstructed as complete matched history rather than server-stored item references, including compaction inputs. The ChatGPT backend does not accept the ordinary Responses output-token cap; compaction still uses catalog context capacity, full-prefix summarization, checkpoint validation, and replacement, but its configured summary `maxTokens` is not enforced by the server on this route and is documented as a limitation.

**Client capabilities remain owned by dsh.** The bundle does not embed Codex CLI configuration or tool implementations. Shell, filesystem, skills, MCP, subagents, permissions, compaction, and the `web_search` function tool come from the selected dsh profile. The bundle registers a provider for that existing search seam using the official client's separate `alpha/search` protocol and the same refreshable OAuth credential. Its endpoint is fixed so configuration cannot redirect the bearer token. The provider logs the exact secret-free request before dispatch and maps structured `text_result` records to normalized citations; ordinary tool events record the query and returned surface. This preserves later-turn and compaction reconstruction without asking the pi-ai transport to represent hosted `web_search_call` items. The bundle patch selects this provider while leaving the base DeepSeek provider registered.

**Search policy is explicit configuration.** The provider supports the official cached, indexed, and live external-web modes, with cached as the default, plus configurable model, search-context size, and output budget. Unknown result DTOs are ignored for forward compatibility, only HTTP(S) sources are citeable, duplicate URLs are removed, and the shared web seam owns final `maxResults` truncation. Credential absence and 401/403 responses name the login action; cancellation and malformed network responses use the shared web error vocabulary.

## Alternatives considered

**Port the OpenCode plugin request transformer and OAuth constants.** Rejected because dsh already pins a maintained pi-ai implementation of the Codex OAuth and Responses protocols. A second implementation would duplicate security-sensitive endpoints, refresh behavior, model compatibility, stateless reasoning replay, and tool-history fixes.

**Teach the generic Models settings card to hold OAuth.** Rejected because that surface and the Harness credential seam own named API-key values, while OAuth owns an interactive lifecycle and structured refresh state. Showing an API-key editor for `openai-codex` would misrepresent both the input and its renewal behavior.

**Reuse the host Codex CLI through `subagent-codex`.** Rejected because that package launches a complete external coding subagent. It does not implement the Harness LLM adapter seam and therefore cannot serve ordinary model selection, the agent loop's request log, or `dsh-compaction-basic` calls.

**Make subscription login part of every base profile.** Rejected because ChatGPT authentication is personal, optional, and governed by provider plan policy. The base remains usable with DeepSeek or API-key providers and performs no OpenAI login or credential-file creation unless the user invokes the dedicated command.

**Inject the hosted Codex web-search tool into model requests.** Rejected because request acceptance alone is incomplete: the pinned LLM transport does not project `web_search_call` items, results, and citation annotations into durable Harness messages. The implemented standalone provider instead sends one explicitly logged auxiliary request and returns normalized data through the existing logged tool seam.

## Consequences

A user can sign in once per Harness home, install the bundle into selected profiles, and use both the installed Codex GPT catalog and dsh `web_search` without an OpenAI Platform or DeepSeek API key. OAuth refresh is safe across concurrent local dsh processes, removing the bundle does not silently delete the machine credential, and logout names the removed file. ChatGPT plan eligibility, model availability, usage ceilings, OAuth behavior, and the private standalone-search protocol remain external policy; this bundle is a local personal integration rather than general OpenAI API or multi-user production authorization. Tests pin strict secret storage, launcher grammar and redaction, real Loader registration/disposal, catalog exposure, stateless compaction replay, search modes and headers, citation normalization, cancellation, and failure mapping.
