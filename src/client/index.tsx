/** Browser half: OpenAI Codex account management inside dsh Settings. */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { OpenAICodexSettings } from './OpenAICodexSettings.tsx'
import type { OpenAICodexSettingsInjected } from './OpenAICodexSettings.tsx'
import { en, zh } from './locales.ts'
import type { OpenAICodexSettingsKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** OpenAI Codex account page copy. */
    'settings.openai-codex': OpenAICodexSettingsKey
  }
}

/** Stable browser-plugin name. */
export const name = 'dsh-openai-codex-client'
/** Client services required by the settings contribution. */
export const inject = ['slots', 'locale']

/** Register account copy and the OpenAI Codex settings page. */
export function apply(ctx: ClientContext): void {
  const namespace = 'settings.openai-codex'
  ctx.effect(() => ctx.locale.register(namespace, { zh, en }), 'dsh-openai-codex: settings copy')
  const t = ctx.locale.bind(namespace) as OpenAICodexSettingsInjected['t']
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'openai-codex',
    order: 15,
    label: () => t('nav'),
    inject: (): OpenAICodexSettingsInjected => ({ t }),
  }, OpenAICodexSettings))
}
