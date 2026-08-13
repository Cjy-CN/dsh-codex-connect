# Installation Runbook for CLI Agents

This is the complete installation procedure for Codex, Claude Code, and other automation agents. Do not inspect the plugin source or another plugin to infer missing steps.

## Objective

Install this checkout as a local dsh bundle, enable the `openai-codex` model and search routes in the requested profile, preserve existing user configuration, and verify non-secret login state.

## Inputs and defaults

- **Plugin checkout:** use the directory supplied by the user. If absent, clone `git@github.com:Yan-Zero/dsh-codex.git` into a user-approved source directory.
- **Profile:** use the profile named by the user; otherwise use `web`.
- **Launcher:** prefer an installed `dsh`. When operating from a DeepSeek Harness checkout, set that checkout as the command working directory and replace every `dsh` invocation below with `pnpm dsh`.
- **Search mode:** use `live` unless the user explicitly requests `cached` or `indexed`.

This plugin uses standard DeepSeek Harness plugin APIs. Do not patch, fork, or commit changes to the dsh repository during installation.

## Safety requirements

- Never read, print, copy, move, or modify `~/.codex/auth.json`.
- Never print `$DSH_HOME/.openai-codex-auth.json` or include it in diagnostics.
- Never add credentials, OAuth URLs/codes, tokens, account identifiers, or generated profile state to Git.
- Preserve every unrelated profile dependency, bundle, and `cordis.patch.yml` row.
- Use an absolute `link:` path for the plugin checkout. Do not add relative paths into this repository.
- OAuth approval belongs to the user. Automate opening/waiting where possible, but never request the user's OpenAI password or attempt to complete their account page.

## Procedure

### 1. Validate the checkout and launcher

Require these files in the plugin directory:

- `package.json`
- `cordis.patch.yml`
- `lib/index.js`
- `lib/client.js`
- `lib/bin.js`

Require `package.json.name` to equal `@dsh-external/dsh-openai-codex`. If any check fails, stop and report that the checkout needs a completed build or the correct repository. Do not run a package installation or rebuild merely to install a checkout whose committed `lib/` is present.

Run `dsh --version` or `dsh --help`. If using a source checkout, run `pnpm dsh --version` or `pnpm dsh --help` from that checkout. Stop on launcher failure.

Normalize the absolute plugin path for pnpm. On Windows use forward slashes, for example `E:/source/ai/dsh/openai-codex`.

### 2. Link the bundle

Substitute the selected profile and absolute path:

```sh
dsh plugin --profile web add link:E:/absolute/path/to/dsh-codex
```

From a Harness source checkout, use:

```sh
pnpm dsh plugin --profile web add link:E:/absolute/path/to/dsh-codex
```

The command is idempotent. It must leave `@dsh-external/dsh-openai-codex` in both the profile dependency map and `dsh.profile.bundles` list exactly once.

### 3. Configure search without replacing user settings

Resolve the profile directory as `$DSH_HOME/profiles/<profile>`; when `DSH_HOME` is unset, use `~/.dsh/profiles/<profile>`.

Edit that profile's `cordis.patch.yml`, preserving all unrelated rows. Ensure exactly one row with id `llm-openai-codex` contains the selected search mode:

```yaml
- id: llm-openai-codex
  config:
    searchMode: live
```

If the file contains only `[]`, replace that token with the row. If the id already exists, update `config.searchMode` on that row and retain its other fields. Never append a duplicate id.

### 4. Validate the effective composition

Run:

```sh
dsh --profile web --dump-config
```

Require all of these facts:

- `llm-openai-codex` loads `@dsh-external/dsh-openai-codex`;
- `agent-default-model` selects provider `openai-codex` and model `gpt-5.6-sol` unless a later user setting overrides it;
- the `web` row selects `searchProvider: openai-codex`;
- `llm-openai-codex.config.searchMode` equals the selected mode.

Stop and report the exact diagnostic if composition fails. Do not start OAuth while the bundle is absent or malformed.

### 5. Reuse or create the dsh login

Check non-secret status:

```sh
dsh plugin --profile web exec dsh-openai-codex status
```

If it reports `signed in`, do not start another login.

If signed out and an interactive terminal is available, run:

```sh
dsh plugin --profile web exec dsh-openai-codex login
```

The command opens OpenAI's page and waits for its localhost callback. Tell the user to approve the page, then keep waiting for command completion. Never ask the user to paste a token. If the machine cannot open a browser, use:

```sh
dsh plugin --profile web exec dsh-openai-codex login --device-code
```

For a local Web profile, the equivalent user path is **Settings → OpenAI Codex → Sign in with ChatGPT**. Do not require both GUI and CLI login.

After approval, rerun `status` and require `signed in`.

### 6. Verify Web integration

For the `web` profile, start `dsh web` if the user wants the application running. From the same machine, require:

- the root page loads;
- its boot manifest contains `@dsh-external/dsh-openai-codex` and the plugin `client.js` URL;
- `GET /plugins/dsh-openai-codex/auth/status` returns a JSON status without credentials;
- Settings contains an **OpenAI Codex** section.

Do not call the login endpoint solely as a health check because it intentionally starts an OAuth operation.

The Web composer already owns image paste/drop. Do not patch dsh to add Ctrl+V support. The bundle adds `view_image`; its model route must explicitly advertise image input before the tool returns an image.

### 7. Report completion

Report only:

- installed profile;
- absolute plugin checkout path;
- selected search mode;
- signed-in or signed-out state;
- whether the Web client entry was detected.

Do not report OAuth URLs, authorization codes, token timestamps, account ids, or auth-file contents.

## Failure handling

- **Executable not found:** confirm the profile resolves this checkout and `lib/bin.js` exists, then repeat the absolute `link:` add command.
- **Client entry missing:** confirm `lib/client.js`, the `./client` package export, and `dsh.client` metadata exist in the checkout; repeat the add command and restart dsh.
- **Duplicate provider:** remove only a manually configured `llm-pi-ai.providers.openai-codex` route. The dedicated bundle owns this route.
- **401/403 after login:** run the dedicated login again. Do not copy Codex CLI credentials.
- **OAuth callback cannot bind:** retry with `--device-code`.
- **Browser account route returns 403:** browser login is intentionally loopback-only; use the CLI on the dsh host.
- **Profile patch parse failure:** repair only the `llm-openai-codex` row and preserve unrelated rows, then rerun `--dump-config`.
- **Image refusal:** select a Codex model whose catalog explicitly includes image input; text-only and unknown-capability models are rejected intentionally.
- **A session reports unknown `web/search-model-request`:** that event came from the discontinued fork implementation, not this plugin. Ask before deleting or migrating the named session; never alter all sessions automatically.

## Updating

Update the checkout using its normal Git workflow, then repeat steps 2, 4, 5, and 6. An absolute `link:` continues to point at the same directory; the repeated add command reconciles the profile without adding a duplicate bundle.

## Removal

Only when explicitly requested:

```sh
dsh plugin --profile web remove @dsh-external/dsh-openai-codex
```

Remove only the `llm-openai-codex` row from the profile patch. Credential deletion is separate and requires explicit authorization:

```sh
dsh plugin --profile web exec dsh-openai-codex logout
```
