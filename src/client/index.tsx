/** Browser half: OpenAI Codex account management inside the dsh Plugins section. */

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
export const name = 'dsh-codex-connect-client'
/** Client services required by the Plugins contribution. */
export const inject = ['slots', 'locale']

/** Register account copy and the OpenAI Codex page under Plugins. */
export function apply(ctx: ClientContext): void {
  const namespace = 'settings.openai-codex'
  ctx.effect(() => ctx.locale.register(namespace, { zh, en }), 'dsh-codex-connect: settings copy')
  const t = ctx.locale.bind(namespace) as OpenAICodexSettingsInjected['t']
  ctx.slots.inject('settings.plugins.tab', () => ctx.slots.register({
    name: 'settings.plugins.tab',
    id: 'openai-codex',
    order: 20,
    label: () => t('nav'),
    inject: (): OpenAICodexSettingsInjected => ({ t }),
  }, OpenAICodexSettings))
}
