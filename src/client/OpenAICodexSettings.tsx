/** Plugin-owned OpenAI Codex account page inside the dsh Settings shell. */

import { useCallback, useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import type { OpenAICodexSettingsKey } from './locales.ts'

const STATUS_PATH = '/plugins/dsh-openai-codex/auth/status'
const LOGIN_PATH = '/plugins/dsh-openai-codex/auth/login'
const LOGOUT_PATH = '/plugins/dsh-openai-codex/auth/logout'
const POLL_INTERVAL_MS = 1_000

type AccountStatus =
  | { status: 'loading' }
  | { status: 'signed-out' }
  | { status: 'signing-in' }
  | { status: 'signed-in'; expiresAt?: string }
  | { status: 'error'; message: string }

interface LoginChallenge {
  url: string
}

/** Dependencies injected by the browser plugin entry. */
export interface OpenAICodexSettingsInjected {
  /** Localized page copy. */
  t: (key: OpenAICodexSettingsKey, params?: Record<string, unknown>) => string
}

/** Props delivered by the settings slot renderer. */
export type OpenAICodexSettingsProps = Partial<OpenAICodexSettingsInjected>

const pageStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 720 }
const titleStyle: CSSProperties = { margin: 0, fontSize: 20, lineHeight: '28px', fontWeight: 600, color: 'var(--dsw-alias-label-primary)' }
const bodyStyle: CSSProperties = { margin: 0, fontSize: 14, lineHeight: '22px', color: 'var(--dsw-alias-label-secondary)' }
const cardStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 14, padding: '18px 20px', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 12, background: 'var(--dsw-alias-bg-module-platform)' }
const rowStyle: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }
const statusStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 9, fontSize: 15, fontWeight: 500, color: 'var(--dsw-alias-label-primary)' }
const buttonStyle: CSSProperties = { boxSizing: 'border-box', minHeight: 34, padding: '6px 14px', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 18, background: 'var(--dsw-alias-bg-layer-1)', color: 'var(--dsw-alias-label-primary)', font: 'inherit', fontSize: 14, cursor: 'pointer' }
const primaryButtonStyle: CSSProperties = { ...buttonStyle, borderColor: 'var(--dsw-alias-brand-primary)', background: 'var(--dsw-alias-brand-primary)', color: 'white' }
const errorStyle: CSSProperties = { ...bodyStyle, color: 'var(--dsw-alias-state-error-primary)' }

function dotStyle(status: AccountStatus['status']): CSSProperties {
  const color = status === 'signed-in'
    ? 'var(--dsw-alias-state-success-primary, #22a06b)'
    : status === 'error'
      ? 'var(--dsw-alias-state-error-primary, #d92d20)'
      : status === 'signing-in' || status === 'loading'
        ? 'var(--dsw-alias-brand-primary, #1677ff)'
        : 'var(--dsw-alias-label-dimmed, #9aa0a6)'
  return { width: 9, height: 9, borderRadius: '50%', flex: '0 0 auto', background: color }
}

async function jsonRequest<T>(path: string, method = 'GET'): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: { accept: 'application/json' },
    credentials: 'same-origin',
  })
  const value: unknown = await response.json().catch(() => undefined)
  if (!response.ok) {
    const message = typeof value === 'object' && value !== null && 'error' in value && typeof value.error === 'string'
      ? value.error
      : `HTTP ${response.status}`
    throw new Error(message)
  }
  return value as T
}

/** OpenAI Codex account status and OAuth actions. */
export function OpenAICodexSettings({ t }: OpenAICodexSettingsProps) {
  if (t === undefined) throw new Error('OpenAI Codex settings requires its translation function')
  const [status, setStatus] = useState<AccountStatus>({ status: 'loading' })
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    try {
      setStatus(await jsonRequest<AccountStatus>(STATUS_PATH))
    } catch (error: unknown) {
      setStatus({ status: 'error', message: error instanceof Error ? error.message : t('requestFailed') })
    }
  }, [t])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    if (status.status !== 'signing-in') return
    const timer = window.setInterval(() => { void refresh() }, POLL_INTERVAL_MS)
    return () => { window.clearInterval(timer) }
  }, [refresh, status.status])

  const signIn = async (): Promise<void> => {
    const popup = window.open('about:blank', '_blank')
    if (popup !== null) popup.opener = null
    setBusy(true)
    setStatus({ status: 'signing-in' })
    try {
      const challenge = await jsonRequest<LoginChallenge>(LOGIN_PATH, 'POST')
      if (popup === null) {
        setStatus({ status: 'error', message: t('popupBlocked') })
        return
      }
      popup.location.replace(challenge.url)
    } catch (error: unknown) {
      popup?.close()
      setStatus({ status: 'error', message: error instanceof Error ? error.message : t('requestFailed') })
    } finally {
      setBusy(false)
    }
  }

  const signOut = async (): Promise<void> => {
    setBusy(true)
    try {
      await jsonRequest<{ ok: true }>(LOGOUT_PATH, 'POST')
      setStatus({ status: 'signed-out' })
    } catch (error: unknown) {
      setStatus({ status: 'error', message: error instanceof Error ? error.message : t('requestFailed') })
    } finally {
      setBusy(false)
    }
  }

  const label = status.status === 'signed-in'
    ? t('signedIn')
    : status.status === 'signing-in' || status.status === 'loading'
      ? t('signingIn')
      : status.status === 'error'
        ? t('requestFailed')
        : t('signedOut')

  return (
    <section style={pageStyle} aria-labelledby="openai-codex-settings-title">
      <div>
        <h2 id="openai-codex-settings-title" style={titleStyle}>{t('title')}</h2>
        <p style={{ ...bodyStyle, marginTop: 6 }}>{t('intro')}</p>
      </div>
      <div style={cardStyle}>
        <div style={rowStyle}>
          <div style={statusStyle} role="status">
            <span aria-hidden="true" style={dotStyle(status.status)} />
            <span>{label}</span>
          </div>
          {status.status === 'signed-in'
            ? <button type="button" style={buttonStyle} disabled={busy} onClick={() => { void signOut() }}>{busy ? t('working') : t('logout')}</button>
            : <button type="button" style={primaryButtonStyle} disabled={busy || status.status === 'loading'} onClick={() => { void signIn() }}>{busy ? t('working') : status.status === 'error' ? t('loginAgain') : t('login')}</button>}
        </div>
        {status.status === 'signed-in' && status.expiresAt !== undefined
          ? <p style={bodyStyle}>{t('expires', { date: new Date(status.expiresAt).toLocaleString() })}</p>
          : null}
        {status.status === 'error' ? <p style={errorStyle}>{status.message}</p> : null}
        <p style={bodyStyle}>{t('localOnly')}</p>
      </div>
      <div style={cardStyle}>
        <p style={bodyStyle}>{t('features')}</p>
        <p style={bodyStyle}>{t('storage')}</p>
      </div>
    </section>
  )
}
