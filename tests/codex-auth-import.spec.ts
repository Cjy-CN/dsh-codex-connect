import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { OAuthCredential } from '@earendil-works/pi-ai'
import {
  CodexAuthImportError,
  codexAuthJsonPath,
  importCodexAuthCredential,
  MAX_CODEX_AUTH_IMPORT_BYTES,
  parseCodexAuthJson,
  readCodexAuthCredential,
} from '../src/codex-auth-import.ts'
import {
  OpenAICodexCredentialStore,
  OPENAI_CODEX_PROVIDER,
} from '../src/store.ts'

let root: string | undefined

function jwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${header}.${body}.signature`
}

function codexDocument(options: {
  accountId?: string | null
  nested?: boolean
  exp?: number
  accessAccountId?: string
} = {}): string {
  const access = jwt({
    exp: options.exp ?? 1_900_000_000,
    'https://api.openai.com/auth': {
      chatgpt_account_id: options.accessAccountId ?? 'account-from-access',
    },
  })
  const values = {
    id_token: jwt({
      exp: 1_900_000_100,
      'https://api.openai.com/auth': { chatgpt_account_id: 'account-from-id' },
    }),
    access_token: access,
    refresh_token: 'refresh-secret',
    account_id: options.accountId === undefined ? 'account-explicit' : options.accountId,
  }
  return JSON.stringify({
    auth_mode: 'chatgpt',
    OPENAI_API_KEY: null,
    tokens: options.nested ? { chatgpt: values } : values,
    last_refresh: '2026-08-17T00:00:00Z',
  })
}

function existingCredential(access = 'existing-access'): OAuthCredential {
  return {
    type: 'oauth',
    access,
    refresh: 'existing-refresh',
    expires: Date.now() + 60_000,
    accountId: 'existing-account',
  }
}

async function fixture(): Promise<{
  source: string
  store: OpenAICodexCredentialStore
}> {
  root = await mkdtemp(join(tmpdir(), 'dsh-codex-import-'))
  const source = join(root, 'codex-auth.json')
  await writeFile(source, codexDocument(), { mode: 0o600 })
  return {
    source,
    store: new OpenAICodexCredentialStore(join(root, 'dsh-auth.json')),
  }
}

afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

describe('Codex CLI auth.json import', () => {
  it('maps the current flat Codex TokenData shape into the canonical plugin credential', () => {
    expect(parseCodexAuthJson(codexDocument())).toEqual({
      type: 'oauth',
      access: expect.any(String),
      refresh: 'refresh-secret',
      expires: 1_900_000_000_000,
      accountId: 'account-explicit',
    })
  })

  it('accepts the legacy tokens.chatgpt wrapper and falls back to the access JWT account claim', () => {
    expect(parseCodexAuthJson(codexDocument({ nested: true, accountId: null }))).toMatchObject({
      type: 'oauth',
      refresh: 'refresh-secret',
      expires: 1_900_000_000_000,
      accountId: 'account-from-access',
    })
  })

  it.each([
    ['malformed JSON', '{not-json'],
    ['API-key-only document', JSON.stringify({ OPENAI_API_KEY: 'do-not-echo' })],
    ['missing refresh token', JSON.stringify({ tokens: { access_token: jwt({ exp: 1_900_000_000 }) } })],
    ['invalid JWT', JSON.stringify({ tokens: { access_token: 'access-secret', refresh_token: 'refresh-secret', account_id: 'account-1' } })],
    ['missing expiry', JSON.stringify({ tokens: { access_token: jwt({}), refresh_token: 'refresh-secret', account_id: 'account-1' } })],
    ['missing account', JSON.stringify({ tokens: { access_token: jwt({ exp: 1_900_000_000 }), refresh_token: 'refresh-secret' } })],
  ])('rejects %s without echoing credential material', (_label, text) => {
    const failure = (() => {
      try {
        parseCodexAuthJson(text)
        return undefined
      } catch (error: unknown) {
        return error
      }
    })()
    expect(failure).toBeInstanceOf(CodexAuthImportError)
    expect((failure as CodexAuthImportError).code).toBe('codex-auth-invalid')
    expect(String(failure)).not.toMatch(/do-not-echo|access-secret|refresh-secret/u)
  })

  it('reads a bounded owner-only source without modifying its bytes', async () => {
    const { source } = await fixture()
    const before = await readFile(source)

    await expect(readCodexAuthCredential(source)).resolves.toMatchObject({
      type: 'oauth',
      accountId: 'account-explicit',
    })

    expect(await readFile(source)).toEqual(before)
  })

  it('returns confirmation before reading the source when a plugin credential already exists', async () => {
    const { source, store } = await fixture()
    await store.modify(OPENAI_CODEX_PROVIDER, async () => existingCredential())
    await rm(source)

    await expect(importCodexAuthCredential(store, { sourcePath: source })).resolves.toEqual({
      status: 'confirmation-required',
    })
    await expect(store.read(OPENAI_CODEX_PROVIDER)).resolves.toMatchObject({ access: 'existing-access' })
  })

  it('atomically imports and explicitly replaces an existing plugin credential', async () => {
    const { source, store } = await fixture()
    const sourceBefore = await readFile(source)

    await expect(importCodexAuthCredential(store, { sourcePath: source })).resolves.toEqual({
      status: 'imported',
      replaced: false,
    })
    await expect(importCodexAuthCredential(store, { sourcePath: source })).resolves.toEqual({
      status: 'confirmation-required',
    })
    await store.modify(OPENAI_CODEX_PROVIDER, async () => existingCredential('newer-existing'))
    await expect(importCodexAuthCredential(store, { sourcePath: source, overwrite: true })).resolves.toEqual({
      status: 'imported',
      replaced: true,
    })

    await expect(store.read(OPENAI_CODEX_PROVIDER)).resolves.toMatchObject({
      type: 'oauth',
      refresh: 'refresh-secret',
      accountId: 'account-explicit',
      expires: 1_900_000_000_000,
    })
    expect(await readFile(source)).toEqual(sourceBefore)
    if (process.platform !== 'win32') expect((await stat(store.filename)).mode & 0o777).toBe(0o600)
  })

  it('reports missing and unsafe source files with stable redacted codes', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-codex-import-errors-'))
    const missing = join(root, 'missing.json')
    await expect(readCodexAuthCredential(missing)).rejects.toMatchObject({ code: 'codex-auth-not-found' })
    await expect(readCodexAuthCredential(root)).rejects.toMatchObject({ code: 'codex-auth-unsafe-file' })

    const oversized = join(root, 'oversized.json')
    await writeFile(oversized, 'x'.repeat(MAX_CODEX_AUTH_IMPORT_BYTES + 1), { mode: 0o600 })
    await expect(readCodexAuthCredential(oversized)).rejects.toMatchObject({ code: 'codex-auth-unsafe-file' })

    if (process.platform !== 'win32') {
      const broad = join(root, 'broad.json')
      await writeFile(broad, codexDocument(), { mode: 0o644 })
      await chmod(broad, 0o644)
      await expect(readCodexAuthCredential(broad)).rejects.toMatchObject({ code: 'codex-auth-unsafe-file' })
    }
  })

  it('resolves CODEX_HOME to its auth.json without exposing or reading the file', () => {
    expect(codexAuthJsonPath(join('fixture', 'codex-home'))).toBe(resolve('fixture', 'codex-home', 'auth.json'))
  })
})
