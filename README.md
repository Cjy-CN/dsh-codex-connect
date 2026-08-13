# dsh Codex

English | [中文](README.zh.md)

Use your ChatGPT subscription in [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) through OpenAI's Codex sign-in flow—no OpenAI Platform API key required.

This plugin adds a complete `openai-codex` route to dsh:

- ChatGPT OAuth login with automatic token refresh
- the Codex GPT model catalog, including `gpt-5.6-sol` when available to the account
- streaming responses, tool calls, images, reasoning replay, and prompt caching through dsh's existing LLM path
- dsh compaction over stateless Codex conversations
- the Codex standalone search backend, exposed through dsh's normal `web_search` tool
- `cached`, `indexed`, and `live` search modes

OpenAI distinguishes ChatGPT subscription sign-in from usage-based API-key access in the [Codex authentication guide](https://learn.chatgpt.com/docs/auth.md). This project uses the former only with the ChatGPT Codex backend; it does not turn a subscription into a general OpenAI API credential.

## Install

The plugin is an independent dsh bundle. Build artifacts are committed, so a local checkout can be installed directly:

```sh
dsh plugin --profile web add link:/absolute/path/to/dsh-codex
dsh plugin --profile web exec dsh-openai-codex login
dsh web
```

Replace the path with this repository's absolute directory. Login opens a browser and waits for the localhost callback. For a headless machine, use device-code login:

```sh
dsh plugin --profile web exec dsh-openai-codex login --device-code
```

Codex, Claude Code, and other automation agents should follow [INSTALL.md](INSTALL.md). It is a complete, idempotent installation runbook and does not require reading the source or design document.

Useful account commands:

```sh
dsh plugin --profile web exec dsh-openai-codex status
dsh plugin --profile web exec dsh-openai-codex logout
```

The bundle selects `openai-codex` / `gpt-5.6-sol` for new agents and selects the Codex search provider. A model already saved in dsh settings still takes precedence, and the model picker can select any other Codex model available to the signed-in account.

The plugin currently requires a dsh build that exports `createPiAiCatalogAuthAdapter()` from `@deepseek-ai/dsh-llm-pi-ai` and `snapshotWebSearchModelRequest()` from `@deepseek-ai/dsh-web`.

## Search

The provider connects dsh's existing `web_search` tool to the standalone search protocol used by the official Codex client. Search results become normal dsh text and HTTP(S) citations, so later turns and compaction retain the same tool history.

Configure the `llm-openai-codex` row in a profile patch:

```yaml
- id: llm-openai-codex
  config:
    searchMode: live
    searchContextSize: medium
```

Available fields:

| Field | Default | Values |
|---|---:|---|
| `searchModel` | `gpt-5.6-sol` | a Codex model id |
| `searchMode` | `cached` | `cached`, `indexed`, `live` |
| `searchContextSize` | `medium` | `low`, `medium`, `high` |
| `searchMaxOutputTokens` | `10000` | positive integer |

The modes follow the [official Codex search configuration](https://learn.chatgpt.com/docs/config-file/config-basic#web-search-mode); `live` corresponds to `codex --search`.

## Credentials and privacy

dsh keeps this login separate from Codex CLI/Desktop:

- credentials are stored at `$DSH_HOME/.openai-codex-auth.json` (`~/.dsh` by default)
- writes are atomic and token refresh is locked across local dsh processes
- status and diagnostics do not print token values
- `~/.codex/auth.json` is never copied or modified

Keeping the stores separate prevents two clients from racing the same rotating refresh token. Removing the bundle does not delete the credential; run `logout` when the local account should be removed.

## Compatibility notes

- ChatGPT plan eligibility, model access, quotas, and Codex backend behavior are controlled by OpenAI and may change.
- The Codex endpoint does not enforce the ordinary Responses `max_output_tokens` field. Compaction works, but its configured summary cap cannot be imposed server-side on this route.
- This bundle provides authentication, model transport, and search. Filesystem, shell, skills, MCP, subagents, permissions, and the `web_search` tool itself still come from the active dsh profile.
- The standalone search endpoint is not a public OpenAI Platform API. Its compatibility follows the pinned Codex/pi-ai implementation.

See [the design document](docs/design.md) for protocol, replay, persistence, and failure-handling details.

## Development

The dsh packages are peer dependencies. Provide them from a compatible dsh workspace when running source tests, then run:

```sh
pnpm install
pnpm run check
```

`pnpm run check` performs strict TypeScript checking, 16 focused tests, and the distributable build.

## License

Apache-2.0
