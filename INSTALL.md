# Installation Runbook for Automation Agents

This file is the complete installation procedure for Codex, Claude Code, and other automation agents. Do not inspect this repository's source or design document to infer additional steps.

## Objective

Install this checkout as a local dsh bundle, enable the `openai-codex` model route and live Codex search in one dsh profile, complete ChatGPT OAuth, and verify the effective composition.

## Required inputs

- **Plugin directory:** the absolute path to this repository. If it is not already checked out, clone `git@github.com:Yan-Zero/dsh-codex.git` into a user-approved source directory.
- **Profile:** use the profile named by the user. If none is named, use `web`.
- **dsh launcher:** prefer an installed `dsh` executable. If unavailable and a DeepSeek Harness source checkout is present, run its package script with `pnpm --dir <DSH_REPOSITORY> dsh` in place of `dsh` in every command below.

The compatible Harness build must export `createPiAiCatalogAuthAdapter()` from `@deepseek-ai/dsh-llm-pi-ai` and `snapshotWebSearchModelRequest()` from `@deepseek-ai/dsh-web`. If either export is unavailable, stop and report that the Harness checkout must include the dsh Codex extension-point changes. Do not rewrite this plugin to bypass them.

## Safety rules

- Never read, print, copy, move, or modify `~/.codex/auth.json`.
- Never print the contents of `$DSH_HOME/.openai-codex-auth.json`.
- Do not add a credential, authorization code, redirect URL, or account identifier to Git.
- Preserve all unrelated rows in the profile's `cordis.patch.yml`.
- Use an absolute local `link:` specification. Do not write a relative path to another repository into this repository.
- OAuth requires the user to approve OpenAI's page. Opening the browser and waiting for the callback are automated; the agent must pause for the user's approval rather than attempting to handle account credentials.

## Procedure

### 1. Resolve the launcher and paths

Confirm all of the following before changing the profile:

1. The plugin directory contains `package.json`, `cordis.patch.yml`, and `lib/index.js`.
2. `package.json` names `@dsh-external/dsh-openai-codex`.
3. The dsh launcher can execute `--help` or `--version` without an installation error.
4. The absolute plugin path is normalized for a pnpm link specification. On Windows, use forward slashes, for example `E:/source/ai/dsh/dsh-codex`.

The committed `lib/` directory is the runtime artifact. Do not run `pnpm install` or rebuild the plugin merely to install it.

### 2. Install the bundle

Run exactly one of these forms, substituting the selected profile and absolute plugin path:

```sh
dsh plugin --profile web add link:E:/absolute/path/to/dsh-codex
```

```sh
pnpm --dir E:/absolute/path/to/deepseek-harness dsh plugin --profile web add link:E:/absolute/path/to/dsh-codex
```

This command is safe to repeat. A successful installation adds `@dsh-external/dsh-openai-codex` to the profile dependencies and bundle list.

### 3. Enable live Codex search

Resolve the profile directory from dsh's home. By default it is `~/.dsh/profiles/<profile>`; when `DSH_HOME` is set, use `$DSH_HOME/profiles/<profile>`.

Edit `cordis.patch.yml` in that profile. Preserve every unrelated entry. Ensure it contains exactly one override for `llm-openai-codex` with `searchMode: live`:

```yaml
- id: llm-openai-codex
  config:
    searchMode: live
```

If the file is the initial `[]`, replace only that token with the row above. If the id already exists, update its `config.searchMode` instead of appending a duplicate. Preserve other fields on that row.

Use `cached` or `indexed` only when the user explicitly requests that mode. `live` matches `codex --search` and is the default for this runbook.

### 4. Validate composition before login

Run:

```sh
dsh --profile web --dump-config
```

The effective output must contain all four facts:

- an `llm-openai-codex` row whose package is `@dsh-external/dsh-openai-codex`
- `agent-default-model` configured with provider `openai-codex` and model `gpt-5.6-sol`
- the `web` row configured with `searchProvider: openai-codex`
- the `llm-openai-codex` row configured with `searchMode: live`

If dump-config fails or any fact is absent, stop and report the exact diagnostic. Do not start OAuth against a profile whose composition is invalid.

### 5. Reuse or create the dsh login

Check the non-secret status:

```sh
dsh plugin --profile web exec dsh-openai-codex status
```

- If it reports `signed in`, skip login.
- If it reports `signed out`, run:

```sh
dsh plugin --profile web exec dsh-openai-codex login
```

The command opens OpenAI's authorization page and waits for a localhost callback. Tell the user to complete the page, then continue waiting. Do not ask the user to paste a token. If browser login is impossible because the host has no browser, rerun with `login --device-code` and give the displayed verification URL and user code to the user.

After the callback, require the command to report that credentials were saved under the dsh home. Then run `status` again and require `signed in`.

### 6. Final verification

Repeat `dsh --profile <profile> --dump-config` and the status command. Confirm that:

- the bundle remains installed after reconciliation;
- live search remains present in the user patch;
- status is signed in;
- `~/.codex/auth.json` was not modified by the procedure.

Do not display either auth file to prove the last item. Compare file metadata captured before and after only when the user explicitly requests such proof; otherwise rely on the plugin's separate credential path.

Report the installed profile, plugin path, selected search mode, and signed-in state. Do not include the OAuth URL, authorization code, token expiry claims, account id, or auth-file contents.

## Failure handling

- **`dsh-openai-codex` executable not found:** confirm the profile dependency resolves to this checkout and `lib/bin.js` exists, then repeat the `add link:<absolute-path>` command.
- **Missing Harness exports:** update or switch to a compatible DeepSeek Harness checkout. Do not add relative Harness paths to this plugin.
- **Duplicate provider error:** remove a manually configured `llm-pi-ai.providers.openai-codex` route from the profile; the dedicated bundle owns that route.
- **401 or 403 after a prior login:** run the dedicated login command again. Do not copy Codex CLI credentials.
- **OAuth callback cannot bind:** use `--device-code`.
- **Profile patch parse failure:** repair only the `llm-openai-codex` row while preserving unrelated entries, then rerun dump-config.
- **Install succeeds but dump-config lacks the bundle:** repeat the plugin add command and inspect only the profile's `package.json` bundle list and dsh's command diagnostic. Do not inspect plugin implementation files.

## Idempotent update

For an existing checkout, update it with the repository's normal Git workflow, then repeat steps 2 through 6. The absolute `link:` dependency continues to point at the checkout, and the repeated add command reconciles the profile without creating a second bundle entry.

## Removal

When the user explicitly requests removal:

```sh
dsh plugin --profile web remove @dsh-external/dsh-openai-codex
```

Remove the `llm-openai-codex` override from the profile patch without changing other rows. Credential deletion is a separate action and must be explicitly requested:

```sh
dsh plugin --profile web exec dsh-openai-codex logout
```
