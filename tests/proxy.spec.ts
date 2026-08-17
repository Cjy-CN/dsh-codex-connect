import { createServer as createHttpServer } from 'node:http'
import type { Server as HttpServer } from 'node:http'
import { connect as netConnect, createServer as createNetServer } from 'node:net'
import type { Server as NetServer, Socket } from 'node:net'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildCodexProxyConfig,
  installCodexProxyFetch,
  isCodexTargetUrl,
  proxyFetch,
} from '../src/proxy.ts'

const ORIGINAL_FETCH = globalThis.fetch

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH
  vi.restoreAllMocks()
})

describe('buildCodexProxyConfig', () => {
  it('disables proxying when no usable address and port exist', () => {
    expect(buildCodexProxyConfig({})).toBeUndefined()
    expect(buildCodexProxyConfig({ proxyAddress: '' })).toBeUndefined()
    expect(buildCodexProxyConfig({ proxyAddress: '   ' })).toBeUndefined()
    expect(buildCodexProxyConfig({ proxyAddress: '127.0.0.1' })).toBeUndefined()
    expect(buildCodexProxyConfig({ proxyPort: 7890 })).toBeUndefined()
    expect(buildCodexProxyConfig({ proxyAddress: '127.0.0.1', proxyPort: 0 })).toBeUndefined()
    expect(buildCodexProxyConfig({ proxyAddress: '127.0.0.1', proxyPort: 70_000 })).toBeUndefined()
  })

  it('accepts bare hosts, host:port, schemes, credentials, and IPv6', () => {
    expect(buildCodexProxyConfig({ proxyAddress: '127.0.0.1', proxyPort: 7890 })?.href)
      .toBe('http://127.0.0.1:7890/')
    expect(buildCodexProxyConfig({ proxyAddress: 'proxy.local:3128', proxyPort: 9999 })?.href)
      .toBe('http://proxy.local:3128/')
    expect(buildCodexProxyConfig({ proxyAddress: 'http://proxy.example.com:8080' })?.href)
      .toBe('http://proxy.example.com:8080/')
    expect(buildCodexProxyConfig({
      proxyAddress: 'https://user:pass@proxy.example.com',
      proxyPort: 8443,
    })?.href).toBe('https://user:pass@proxy.example.com:8443/')
    expect(buildCodexProxyConfig({ proxyAddress: '[::1]', proxyPort: 1080 })?.href)
      .toBe('http://[::1]:1080/')
  })

  it('rejects unsupported schemes and malformed addresses', () => {
    expect(buildCodexProxyConfig({ proxyAddress: 'socks5://127.0.0.1', proxyPort: 1080 })).toBeUndefined()
    expect(buildCodexProxyConfig({ proxyAddress: 'not a url', proxyPort: 1 })).toBeUndefined()
  })
})

describe('isCodexTargetUrl', () => {
  it('matches only first-party OpenAI/ChatGPT hosts', () => {
    expect(isCodexTargetUrl(new URL('https://chatgpt.com/backend-api/codex/responses'))).toBe(true)
    expect(isCodexTargetUrl(new URL('https://auth.openai.com/oauth/token'))).toBe(true)
    expect(isCodexTargetUrl(new URL('https://api.openai.com/v1/models'))).toBe(true)
    expect(isCodexTargetUrl(new URL('https://sub.chatgpt.com/x'))).toBe(true)
    expect(isCodexTargetUrl(new URL('https://chatgpt.com.evil.example/x'))).toBe(false)
    expect(isCodexTargetUrl(new URL('https://notopenai.com/x'))).toBe(false)
    expect(isCodexTargetUrl(new URL('https://example.com/x'))).toBe(false)
  })
})

describe('installCodexProxyFetch', () => {
  it('routes OpenAI hosts to the tunnel and delegates everything else to the original fetch', async () => {
    const fallback = vi.fn(async () => new Response('fallback'))
    globalThis.fetch = fallback as unknown as typeof fetch
    const dispose = installCodexProxyFetch(new URL('http://127.0.0.1:1'))
    try {
      await expect(fetch('https://example.com/plain')).resolves.toMatchObject({ status: 200 })
      expect(fallback).toHaveBeenCalledTimes(1)
      await expect(fetch('https://chatgpt.com/backend-api/me')).rejects.toThrow()
      expect(fallback).toHaveBeenCalledTimes(1)
    } finally {
      dispose()
    }
    expect(globalThis.fetch).toBe(fallback)
  })
})

interface TunnelProxyFixture {
  server: NetServer
  port: number
  connects: string[]
  proxyAuth: string[]
  close: () => Promise<void>
}

async function startTunnelProxy(): Promise<TunnelProxyFixture> {
  const connects: string[] = []
  const proxyAuth: string[] = []
  const active = new Set<Socket>()
  const server = createNetServer((socket) => {
    active.add(socket)
    socket.on('close', () => { active.delete(socket) })
    let buffer = ''
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8')
      const index = buffer.indexOf('\r\n\r\n')
      if (index === -1) return
      const head = buffer.slice(0, index)
      const lines = head.split('\r\n')
      const parts = (lines[0] ?? '').split(' ')
      const method = parts[0]
      const targetAuthority = parts[1]
      if (method !== 'CONNECT' || targetAuthority === undefined) {
        socket.end('HTTP/1.1 405 Method Not Allowed\r\n\r\n')
        return
      }
      connects.push(targetAuthority)
      proxyAuth.push(lines.find(line => line.toLowerCase().startsWith('proxy-authorization:')) ?? '')
      const separator = targetAuthority.indexOf(':')
      const host = separator === -1 ? targetAuthority : targetAuthority.slice(0, separator)
      const port = separator === -1 ? 443 : Number(targetAuthority.slice(separator + 1))
      const upstream = netConnect(port, host)
      upstream.on('error', () => socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'))
      socket.write('HTTP/1.1 200 Connection established\r\n\r\n')
      socket.pipe(upstream)
      upstream.pipe(socket)
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  return {
    server,
    port,
    connects,
    proxyAuth,
    close: () => new Promise<void>(resolve => {
      for (const socket of active) socket.destroy()
      server.close(() => resolve())
    }),
  }
}

async function startTargetServer(): Promise<{ server: HttpServer; port: number; close: () => Promise<void> }> {
  const server = createHttpServer((req, res) => {
    const chunks: string[] = []
    req.on('data', chunk => { chunks.push(chunk.toString('utf8')) })
    req.on('end', () => {
      const echo = chunks.join('')
      if (req.url === '/hello') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: true, echoed: echo, method: req.method }))
      } else if (req.url === '/redir') {
        res.writeHead(302, { location: '/hello' })
        res.end()
      } else if (req.url === '/deny') {
        res.writeHead(307, { location: '/hello' })
        res.end()
      } else if (req.url === '/slow') {
        res.writeHead(200, { 'content-type': 'text/plain' })
        res.write('partial')
        // Intentionally keep the response open until the client disconnects.
        req.on('close', () => res.destroy())
      } else {
        res.writeHead(404)
        res.end('nope')
      }
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  return {
    server,
    port,
    close: () => new Promise<void>(resolve => {
      server.closeAllConnections()
      server.close(() => resolve())
    }),
  }
}

describe('proxyFetch over a real CONNECT proxy', () => {
  it('tunnels GET and POST requests and rebuilds fetch-compatible responses', async () => {
    const target = await startTargetServer()
    const proxy = await startTunnelProxy()
    const proxyUrl = new URL(`http://127.0.0.1:${proxy.port}`)
    try {
      const response = await proxyFetch(`http://127.0.0.1:${target.port}/hello`, undefined, proxyUrl)
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toBe('application/json')
      await expect(response.json()).resolves.toEqual({ ok: true, echoed: '', method: 'GET' })

      const body = JSON.stringify({ prompt: 'hi' })
      const posted = await proxyFetch(`http://127.0.0.1:${target.port}/hello`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      }, proxyUrl)
      await expect(posted.json()).resolves.toEqual({ ok: true, echoed: body, method: 'POST' })

      expect(proxy.connects).toEqual([`127.0.0.1:${target.port}`, `127.0.0.1:${target.port}`])
    } finally {
      await target.close()
      await proxy.close()
    }
  })

  it('follows redirects and honors redirect: error', async () => {
    const target = await startTargetServer()
    const proxy = await startTunnelProxy()
    const proxyUrl = new URL(`http://127.0.0.1:${proxy.port}`)
    try {
      const followed = await proxyFetch(`http://127.0.0.1:${target.port}/redir`, undefined, proxyUrl)
      expect(followed.status).toBe(200)
      await expect(followed.json()).resolves.toEqual({ ok: true, echoed: '', method: 'GET' })

      await expect(proxyFetch(`http://127.0.0.1:${target.port}/deny`, { redirect: 'error' }, proxyUrl))
        .rejects.toBeInstanceOf(TypeError)
    } finally {
      await target.close()
      await proxy.close()
    }
  })

  it('sends proxy authorization credentials from the proxy URL', async () => {
    const target = await startTargetServer()
    const proxy = await startTunnelProxy()
    const proxyUrl = new URL(`http://user:secret@127.0.0.1:${proxy.port}`)
    try {
      const response = await proxyFetch(`http://127.0.0.1:${target.port}/hello`, undefined, proxyUrl)
      expect(response.status).toBe(200)
      const expected = `Basic ${Buffer.from('user:secret', 'utf8').toString('base64')}`
      expect(proxy.proxyAuth[0]).toBe(`proxy-authorization: ${expected}`)
    } finally {
      await target.close()
      await proxy.close()
    }
  })

  it('tears the tunnel down when the caller aborts mid-body', async () => {
    const target = await startTargetServer()
    const proxy = await startTunnelProxy()
    const proxyUrl = new URL(`http://127.0.0.1:${proxy.port}`)
    try {
      const controller = new AbortController()
      const response = await proxyFetch(`http://127.0.0.1:${target.port}/slow`, {
        signal: controller.signal,
      }, proxyUrl)
      expect(response.status).toBe(200)
      controller.abort()
      await expect(response.text()).rejects.toThrow()
    } finally {
      await target.close()
      await proxy.close()
    }
  })
})