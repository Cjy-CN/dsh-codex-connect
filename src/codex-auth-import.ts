/** Secure one-time import of OpenAI Codex CLI OAuth credentials. */

import { constants } from 'node:fs'
import { lstat, open } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type { OAuthCredential } from '@earendil-works/pi-ai'
import {
  OpenAICodexCredentialStore,
  OPENAI_CODEX_PROVIDER,
} from './store.ts'

/** Maximum accepted Codex auth document size. Tokens need only a few KiB. */
export const MAX_CODEX_AUTH_IMPORT_BYTES = 256 * 1024

/** Stable browser-safe failure codes; none reveal a local path or credential. */
export type CodexAuthImportErrorCode =
  | 'codex-auth-not-found'
  | 'codex-auth-unreadable'
  | 'codex-auth-unsafe-file'
  | 'codex-auth-invalid'

/** One expected import failure with a redacted public code. */
export class CodexAuthImportError extends Error {
  constructor(readonly code: CodexAuthImportErrorCode) {
    super(code)
    this.name = 'CodexAuthImportError'
  }
}

export type CodexAuthImportResult =
  | { status: 'confirmation-required' }
  | { status: 'imported'; replaced: boolean }

export interface CodexAuthImportOptions {
  /** Explicit test/operator source; defaults to `$CODEX_HOME/auth.json`. */
  sourcePath?: string
  /** Permit replacing an existing plugin-owned credential. */
  overwrite?: boolean
}

function nodeErrorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | null)?.code
}

function invalid(): never {
  throw new CodexAuthImportError('codex-auth-invalid')
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined
}

/** Resolve the Codex CLI file-backed credential path without touching it. */
export function codexAuthJsonPath(codexHome: string | undefined = process.env['CODEX_HOME']): string {
  const configured = codexHome?.trim()
  const root = configured === undefined || configured.length === 0
    ? join(homedir(), '.codex')
    : configured
  return resolve(root, 'auth.json')
}

/** Decode one JWT payload without logging token-bearing input. */
function jwtPayload(token: string): Record<string, unknown> {
  const parts = token.split('.')
  const encoded = parts.length === 3 ? parts[1] : undefined
  if (encoded === undefined || encoded.length === 0 || !/^[A-Za-z0-9_-]+$/u.test(encoded)) return invalid()
  try {
    const value: unknown = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
    return record(value) ?? invalid()
  } catch {
    return invalid()
  }
}

function accountIdFromPayload(payload: Record<string, unknown>): string | undefined {
  const auth = record(payload['https://api.openai.com/auth'])
  return nonEmptyString(auth?.['chatgpt_account_id'])
}

/** Parse only the OAuth leaves needed by this plugin and build its canonical credential. */
export function parseCodexAuthJson(text: string): OAuthCredential {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return invalid()
  }
  const document = record(value) ?? invalid()
  const tokenContainer = record(document['tokens']) ?? invalid()
  // Current Codex serializes TokenData directly under `tokens`; older builds
  // and compatibility tools may wrap the same fields in `tokens.chatgpt`.
  const tokens = record(tokenContainer['chatgpt']) ?? tokenContainer
  const access = nonEmptyString(tokens['access_token']) ?? invalid()
  const refresh = nonEmptyString(tokens['refresh_token']) ?? invalid()
  const accessPayload = jwtPayload(access)
  const exp = accessPayload['exp']
  if (typeof exp !== 'number' || !Number.isSafeInteger(exp) || exp <= 0) return invalid()
  const expires = exp * 1000
  if (!Number.isSafeInteger(expires) || expires <= 0) return invalid()

  const declaredAccount = tokens['account_id']
  if (declaredAccount !== undefined && declaredAccount !== null && nonEmptyString(declaredAccount) === undefined) return invalid()
  const idToken = tokens['id_token']
  if (idToken !== undefined && idToken !== null && nonEmptyString(idToken) === undefined) return invalid()
  const accountId = nonEmptyString(declaredAccount)
    ?? accountIdFromPayload(accessPayload)
    ?? (typeof idToken === 'string' ? accountIdFromPayload(jwtPayload(idToken)) : undefined)
    ?? invalid()

  return {
    type: 'oauth',
    access,
    refresh,
    expires,
    accountId,
  }
}

/** Read one bounded, owner-only regular file and convert its Codex OAuth data. */
export async function readCodexAuthCredential(
  sourcePath: string = codexAuthJsonPath(),
): Promise<OAuthCredential> {
  const filename = resolve(sourcePath)
  let before
  try {
    before = await lstat(filename)
  } catch (error: unknown) {
    if (nodeErrorCode(error) === 'ENOENT') throw new CodexAuthImportError('codex-auth-not-found')
    throw new CodexAuthImportError('codex-auth-unreadable')
  }
  if (!before.isFile() || before.isSymbolicLink() || before.size > MAX_CODEX_AUTH_IMPORT_BYTES) {
    throw new CodexAuthImportError('codex-auth-unsafe-file')
  }
  if (process.platform !== 'win32' && (before.mode & 0o077) !== 0) {
    throw new CodexAuthImportError('codex-auth-unsafe-file')
  }

  let handle
  try {
    const flags = constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW)
    handle = await open(filename, flags)
    const opened = await handle.stat()
    if (!opened.isFile() || opened.size > MAX_CODEX_AUTH_IMPORT_BYTES) {
      throw new CodexAuthImportError('codex-auth-unsafe-file')
    }
    return parseCodexAuthJson(await handle.readFile('utf8'))
  } catch (error: unknown) {
    if (error instanceof CodexAuthImportError) throw error
    if (nodeErrorCode(error) === 'ENOENT') throw new CodexAuthImportError('codex-auth-not-found')
    throw new CodexAuthImportError('codex-auth-unreadable')
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

/**
 * Import a Codex CLI credential without mutating the source document.
 *
 * The first call stops before reading the source when the plugin already owns
 * a credential. A confirmed retry performs a serialized read-modify-write, so
 * a concurrent login cannot be overwritten without the same explicit flag.
 */
export async function importCodexAuthCredential(
  store: OpenAICodexCredentialStore = new OpenAICodexCredentialStore(),
  options: CodexAuthImportOptions = {},
): Promise<CodexAuthImportResult> {
  const overwrite = options.overwrite === true
  if (!overwrite && await store.read(OPENAI_CODEX_PROVIDER) !== undefined) {
    return { status: 'confirmation-required' }
  }
  const imported = await readCodexAuthCredential(options.sourcePath)
  let replaced = false
  let confirmationRequired = false
  await store.modify(OPENAI_CODEX_PROVIDER, async (current) => {
    if (current !== undefined && !overwrite) {
      confirmationRequired = true
      return undefined
    }
    replaced = current !== undefined
    return imported
  })
  return confirmationRequired
    ? { status: 'confirmation-required' }
    : { status: 'imported', replaced }
}
