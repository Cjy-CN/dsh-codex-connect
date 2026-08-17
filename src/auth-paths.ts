/** Node-free route constants shared by the Host and browser plugin halves. */

/** Plugin-owned status endpoint consumed by its browser half. */
export const OPENAI_CODEX_AUTH_STATUS_PATH = '/plugins/dsh-openai-codex/auth/status'
/** Plugin-owned browser-login endpoint consumed by its browser half. */
export const OPENAI_CODEX_AUTH_LOGIN_PATH = '/plugins/dsh-openai-codex/auth/login'
/** Plugin-owned logout endpoint consumed by its browser half. */
export const OPENAI_CODEX_AUTH_LOGOUT_PATH = '/plugins/dsh-openai-codex/auth/logout'
/** Host-only Codex CLI credential import endpoint; no secret crosses this route. */
export const OPENAI_CODEX_AUTH_IMPORT_PATH = '/plugins/dsh-openai-codex/auth/import'
/** Explicit value sent only after the user accepts the overwrite prompt. */
export const OPENAI_CODEX_IMPORT_OVERWRITE_HEADER = 'x-dsh-codex-overwrite'
