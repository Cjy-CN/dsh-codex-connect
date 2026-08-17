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

import { request as httpRequest } from 'node:http'
import type { IncomingMessage } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { connect as tlsConnect } from 'node:tls'
import type { Socket } from 'node:net'
import { PassThrough, Readable } from 'node:stream'

/** A usable proxy endpoint after {@link buildCodexProxyConfig} validation. */
export type OpenAICodexProxyConfig = URL

/** Redirect ceiling applied by the tunneled fetch, matching the native fetch default. */
const MAX_REDIRECTS = 5

/** First-party OpenAI/ChatGPT hosts owned by this plugin's provider. */
function isCodexHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/u, '')
  return host === 'chatgpt.com'
    || host.endsWith('.chatgpt.com')
    || host === 'openai.com'
    || host.endsWith('.openai.com')
}

/** Whether one URL targets the OpenAI/ChatGPT endpoints the plugin proxies. */
export function isCodexTargetUrl(url: URL): boolean {
  return isCodexHost(url.hostname)
}

function validPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65535
}

function bracketHost(hostname: string): string {
  return hostname.includes(':') ? `[${hostname}]` : hostname
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
export function buildCodexProxyConfig(
  input: { proxyAddress?: string; proxyPort?: number },
): OpenAICodexProxyConfig | undefined {
  const raw = input.proxyAddress?.trim()
  if (raw === undefined || raw.length === 0) return undefined
  let url: URL
  try {
    url = new URL(raw.includes('://') ? raw : `http://${raw}`)
  } catch {
    return undefined
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
  if (url.hostname.length === 0) return undefined
  let port = url.port === '' ? Number.NaN : Number(url.port)
  if (!validPort(port)) {
    port = input.proxyPort === undefined ? Number.NaN : input.proxyPort
  }
  if (!validPort(port)) return undefined
  url.port = String(port)
  return url
}

function abortReason(signal: AbortSignal | undefined): Error {
  if (signal === undefined) return new Error('fetch aborted')
  if (signal.reason instanceof Error) return signal.reason
  return new DOMException('The operation was aborted.', 'AbortError')
}

/** Headers hop-by-hop headers must never travel through the tunnel unmodified. */
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
])

function headersRecord(headers: Headers): Record<string, string> {
  for (const name of HOP_BY_HOP) headers.delete(name)
  const record: Record<string, string> = {}
  headers.forEach((value, key) => { record[key] = value })
  return record
}

/** Convert a fetch body into bytes; `null` marks an unsupported streaming body. */
function bodyBytes(body: BodyInit | null | undefined): Buffer | undefined | null {
  if (body === undefined || body === null) return undefined
  if (typeof body === 'string') return Buffer.from(body, 'utf8')
  if (body instanceof URLSearchParams) return Buffer.from(body.toString(), 'utf8')
  if (body instanceof ArrayBuffer) return Buffer.from(body)
  if (ArrayBuffer.isView(body)) return Buffer.from(body.buffer, body.byteOffset, body.byteLength)
  return null
}

/** One established CONNECT tunnel with a destroy barrier for teardown. */
interface ProxyTunnel {
  socket: Socket
  destroy(): void
}

/**
 * Open a CONNECT tunnel through `proxy` toward `target`. For an https target
 * the tunnel socket is wrapped in TLS before it resolves; an http target keeps
 * the raw tunneled socket. Aborts tear the tunnel down with the signal's reason.
 */
function openTunnel(target: URL, proxy: URL, signal: AbortSignal | undefined): Promise<ProxyTunnel> {
  return new Promise<ProxyTunnel>((resolve, reject) => {
    const connectAuthority = `${bracketHost(target.hostname)}:${target.port || (target.protocol === 'https:' ? 443 : 80)}`
    const connectHeaders: Record<string, string> = { host: connectAuthority }
    if (proxy.username !== '' || proxy.password !== '') {
      const credentials = `${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`
      connectHeaders['proxy-authorization'] = `Basic ${Buffer.from(credentials, 'utf8').toString('base64')}`
    }
    let settled = false
    let connectRequest: ReturnType<typeof httpRequest> | undefined
    const fail = (error: unknown): void => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', onAbort)
      reject(error instanceof Error ? error : new Error(String(error)))
    }
    const onAbort = (): void => {
      fail(abortReason(signal))
      connectRequest?.destroy()
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    const start = (proxySocket?: Socket): void => {
      const connectRequestStarted = httpRequest({
        host: bracketHost(proxy.hostname),
        port: Number(proxy.port),
        method: 'CONNECT',
        path: connectAuthority,
        headers: connectHeaders,
        agent: false,
        ...proxySocket === undefined ? {} : { createConnection: () => proxySocket },
      })
      connectRequest = connectRequestStarted
      connectRequestStarted.once('connect', (res, socket, head) => {
        if (res.statusCode !== 200) {
          socket.destroy()
          fail(new Error(`proxy CONNECT to ${connectAuthority} failed with HTTP ${String(res.statusCode)}`))
          return
        }
        if (head.length > 0) socket.unshift(head)
        if (target.protocol !== 'https:') {
          if (settled) return
          settled = true
          signal?.removeEventListener('abort', onAbort)
          resolve({ socket, destroy: () => { socket.destroy() } })
          return
        }
        const tlsSocket = tlsConnect({ socket, servername: target.hostname })
        const onTlsError = (error: unknown): void => { fail(error) }
        tlsSocket.once('secureConnect', () => {
          if (settled) return
          settled = true
          signal?.removeEventListener('abort', onAbort)
          tlsSocket.off('error', onTlsError)
          tlsSocket.on('error', () => { /* post-settle socket errors surface on the request */ })
          resolve({
            socket: tlsSocket,
            destroy: () => { try { socket.destroy() } catch { /* already closed */ } },
          })
        })
        tlsSocket.on('error', onTlsError)
      })
      connectRequestStarted.once('error', (error) => {
        if (signal?.aborted === true) fail(abortReason(signal))
        else fail(error)
      })
      connectRequestStarted.end()
    }
    if (proxy.protocol === 'https:') {
      const proxyTls = tlsConnect({
        host: proxy.hostname,
        port: Number(proxy.port),
        servername: proxy.hostname,
      })
      proxyTls.once('secureConnect', () => start(proxyTls))
      proxyTls.once('error', fail)
    } else {
      start()
    }
  })
}

/** Perform one tunneled round trip and rebuild a fetch-compatible Response. */
async function roundTrip(
  target: URL,
  init: RequestInit,
  proxy: URL,
): Promise<Response> {
  const signal = init.signal ?? undefined
  if (signal?.aborted === true) throw abortReason(signal)
  const body = bodyBytes(init.body)
  if (body === null) {
    throw new TypeError('request body type is not supported over the configured proxy')
  }
  const tunnel = await openTunnel(target, proxy, signal)
  return await new Promise<Response>((resolve, reject) => {
    const pass = new PassThrough()
    let settled = false
    const settle = (callback: () => void): void => {
      if (settled) return
      settled = true
      callback()
    }
    const onAbort = (): void => {
      const error = abortReason(signal)
      tunnel.destroy()
      pass.destroy(error)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    // The abort listener stays alive until the response body finishes, so an
    // abort mid-stream still tears the tunnel and rejects the body reader.
    const releaseAbort = (): void => { signal?.removeEventListener('abort', onAbort) }
    pass.once('end', releaseAbort)
    pass.once('error', releaseAbort)
    const onResponse = (response: IncomingMessage): void => {
      response.pipe(pass)
      const headers = new Headers()
      for (const [name, value] of Object.entries(response.headers)) {
        if (value === undefined) continue
        if (Array.isArray(value)) for (const item of value) headers.append(name, item)
        else headers.set(name, value)
      }
      const result = new Response(Readable.toWeb(pass) as unknown as ReadableStream, {
        status: response.statusCode ?? 0,
        statusText: response.statusMessage ?? '',
        headers,
      })
      settle(() => resolve(result))
    }
    const requestOptions = {
      method: (init.method ?? 'GET').toUpperCase(),
      hostname: target.hostname,
      port: target.port === '' ? (target.protocol === 'https:' ? 443 : 80) : Number(target.port),
      path: `${target.pathname}${target.search}`,
      headers: headersRecord(new Headers(init.headers)),
      agent: false,
      createConnection: () => tunnel.socket,
    }
    const request = target.protocol === 'https:'
      ? httpsRequest(requestOptions, onResponse)
      : httpRequest(requestOptions, onResponse)
    request.once('error', (error) => {
      if (signal?.aborted === true) settle(() => reject(abortReason(signal)))
      else settle(() => reject(error))
    })
    if (body !== undefined) request.end(body)
    else request.end()
  })
}

/**
 * Fetch through `proxy`, following redirects like the native fetch. `redirect`
 * is honored: `error` rejects on a redirect, `manual` returns it as-is.
 */
export async function proxyFetch(
  input: string | URL,
  init: RequestInit | undefined,
  proxy: URL,
  redirects = 0,
): Promise<Response> {
  const target = new URL(String(input))
  const options = init ?? {}
  const response = await roundTrip(target, options, proxy)
  const status = response.status
  if (status < 300 || status >= 400) return response
  const location = response.headers.get('location')
  if (location === null) return response
  const mode = options.redirect ?? 'follow'
  if (mode === 'error') {
    throw new TypeError('fetch failed', { cause: new TypeError(`unexpected redirect to ${location}`) })
  }
  if (mode === 'manual') return response
  if (redirects >= MAX_REDIRECTS) {
    throw new TypeError('fetch failed', { cause: new Error('too many redirects') })
  }
  const next = new URL(location, target)
  const nextInit: RequestInit = { ...options }
  delete nextInit.body
  if (status === 303) nextInit.method = 'GET'
  return proxyFetch(next, nextInit, proxy, redirects + 1)
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
export function installCodexProxyFetch(proxy: OpenAICodexProxyConfig): () => void {
  const original = globalThis.fetch
  const patched: typeof fetch = ((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    let url: URL | undefined
    try {
      url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    } catch {
      url = undefined
    }
    if (url !== undefined && isCodexTargetUrl(url)) {
      return proxyFetch(url, init, proxy)
    }
    return original(input, init)
  }) as typeof fetch
  globalThis.fetch = patched
  return () => {
    if (globalThis.fetch === patched) globalThis.fetch = original
  }
}