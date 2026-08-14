# Migrating from `dsh-codex`

`dsh-codex-connect` uses the same provider id (`openai-codex`), OAuth filename (`.openai-codex-auth.json`), Cordis row id (`llm-openai-codex`), and browser auth routes for compatibility. The packages cannot be active together because Harness forbids duplicate provider adapters.

1. Record the effective default model, search route, and `llm-openai-codex` config without reading any OAuth file.
2. Remove `dsh-codex` from the selected profile and add `dsh-codex-connect`.
3. Keep exactly one `llm-openai-codex` row loading `dsh-codex-connect`.
4. Decide explicitly whether to set `enableSearch` and `enableImageTool`; both default to `false` after migration.
5. Preserve the prior `agent-default-model` and `web.searchProvider` only when the user wants those routes to remain selected.
6. Run `--dump-config`, then `dsh-codex-connect doctor`. Do not run OAuth again when `status` already reports signed in.

Rollback is the inverse package swap. Do not delete or copy the separate OAuth file during either direction. If Harness reports a duplicate `openai-codex` adapter, the old bundle or a manual provider row is still active; resolve that one row instead of changing credentials.
