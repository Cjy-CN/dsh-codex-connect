import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('OpenAI Codex browser contribution', () => {
  it('registers under Plugins instead of adding a top-level Settings section', async () => {
    const client = await readFile(new URL('../src/client/index.tsx', import.meta.url), 'utf8')
    expect(client).toContain("ctx.slots.inject('settings.plugins.tab'")
    expect(client).toContain("name: 'settings.plugins.tab'")
    expect(client).toContain("id: 'openai-codex'")
    expect(client).toContain('order: 20')
    expect(client).not.toContain("ctx.slots.inject('settings.section'")
  })

  it('uses OpenAI Codex for the Plugins page and Composer provider', async () => {
    const [locales, adapter] = await Promise.all([
      readFile(new URL('../src/client/locales.ts', import.meta.url), 'utf8'),
      readFile(new URL('../src/adapter.ts', import.meta.url), 'utf8'),
    ])
    expect(locales.match(/nav: 'OpenAI Codex'/gu)).toHaveLength(2)
    expect(locales.match(/title: 'OpenAI Codex'/gu)).toHaveLength(2)
    expect(adapter).toContain("displayName: 'OpenAI Codex'")
  })
})
