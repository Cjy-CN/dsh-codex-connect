import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SettingsProvider from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import WebRuntime from '@deepseek-ai/dsh-web'
import * as OpenAICodex from '../src/index.ts'

class MemorySettings extends SettingsProvider {
  readonly writable = true
  private storedDocument: Record<string, unknown> = {}

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.storedDocument))
  }

  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.storedDocument[ns] = structuredClone(section)
    return Promise.resolve()
  }
}

let context: Context | undefined
let root: string | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
  vi.unstubAllEnvs()
})

describe('OpenAI Codex Host settings integration', () => {
  it('exposes OpenAI Codex and applies optional capabilities without changing routes', async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-codex-connect-settings-'))
    vi.stubEnv('DSH_HOME', root)
    const workspace = join(root, 'workspace')
    const ctx = new Context()
    context = ctx
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(WebRuntime)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime, { mode: 'native' })
    await ctx.plugin(LocalFileSystem, { cwd: workspace })
    await ctx.plugin(LocalAttachmentStore, { dshHome: root })
    await ctx.plugin(MemorySettings)
    const plugin = await ctx.plugin(OpenAICodex, {})

    expect(ctx.llm.listConfigurableProviders()).toEqual([{
      provider: 'openai-codex',
      displayName: 'OpenAI Codex',
      settingsNs: 'llm-openai-codex',
      settingsPath: [],
      declared: false,
    }])
    const descriptor = ctx.settings.describe().find(entry => entry.ns === OpenAICodex.OPENAI_CODEX_SETTINGS_NS)
    expect(descriptor?.value).toEqual(OpenAICodex.DEFAULT_OPENAI_CODEX_SETTINGS)
    const catalogContextWindow = (await ctx.llm.resolveModelInfo('openai-codex', 'gpt-5.6-sol')).context?.contextWindow
    expect(catalogContextWindow).toBeTypeOf('number')
    expect(ctx.tools.get(OpenAICodex.VIEW_IMAGE_TOOL_NAME)).toBeUndefined()
    await expect(ctx.web.search({ query: 'disabled' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_UNAVAILABLE' })

    await ctx.settings.update(OpenAICodex.OPENAI_CODEX_SETTINGS_NS, {
      enableSearch: true,
      enableImageTool: true,
      searchModel: 'gpt-search-settings-test',
      searchMode: 'live',
      searchContextSize: 'high',
      searchMaxOutputTokens: 2048,
      contextWindow: 123_456,
    })
    await vi.waitFor(() => {
      expect(ctx.tools.get(OpenAICodex.VIEW_IMAGE_TOOL_NAME)).toBeDefined()
    })
    await expect(ctx.llm.resolveModelInfo('openai-codex', 'gpt-5.6-sol')).resolves.toMatchObject({
      context: { contextWindow: 123_456 },
    })
    await expect(ctx.web.search({ query: 'enabled' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_CREDENTIAL_MISSING' })

    await ctx.settings.update(OpenAICodex.OPENAI_CODEX_SETTINGS_NS, {
      enableSearch: false,
      enableImageTool: false,
    })
    await vi.waitFor(() => {
      expect(ctx.tools.get(OpenAICodex.VIEW_IMAGE_TOOL_NAME)).toBeUndefined()
    })
    await expect(ctx.web.search({ query: 'disabled again' })).rejects.toMatchObject({ code: 'WEB_PROVIDER_UNAVAILABLE' })

    await ctx.settings.mutate(OpenAICodex.OPENAI_CODEX_SETTINGS_NS, [{ op: 'unset', path: ['contextWindow'] }])
    await expect(ctx.llm.resolveModelInfo('openai-codex', 'gpt-5.6-sol')).resolves.toMatchObject({
      context: { contextWindow: catalogContextWindow },
    })

    await ctx.settings.update(OpenAICodex.OPENAI_CODEX_SETTINGS_NS, {
      proxyAddress: '127.0.0.1',
      proxyPort: 7890,
    })
    const proxied = ctx.settings.describe().find(entry => entry.ns === OpenAICodex.OPENAI_CODEX_SETTINGS_NS)
    expect(proxied?.value).toMatchObject({ proxyAddress: '127.0.0.1', proxyPort: 7890 })

    await ctx.settings.update(OpenAICodex.OPENAI_CODEX_SETTINGS_NS, { proxyAddress: '' })
    await ctx.settings.mutate(OpenAICodex.OPENAI_CODEX_SETTINGS_NS, [{ op: 'unset', path: ['proxyPort'] }])
    const cleared = ctx.settings.describe().find(entry => entry.ns === OpenAICodex.OPENAI_CODEX_SETTINGS_NS)
    expect(cleared?.value).toMatchObject({ proxyAddress: '' })
    expect((cleared?.value as { proxyPort?: unknown } | undefined)?.proxyPort).toBeUndefined()

    await plugin.dispose()
    expect(ctx.llm.listConfigurableProviders()).toEqual([])
  })
})
