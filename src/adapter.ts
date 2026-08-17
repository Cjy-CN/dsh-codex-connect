/** OpenAI Codex adapter assembled from public dsh-llm-pi-ai extension points. */

import { createModels } from '@earendil-works/pi-ai'
import type { MutableModels, Provider } from '@earendil-works/pi-ai'
import { openaiCodexProvider } from '@earendil-works/pi-ai/providers/openai-codex'
import { resolveRetryPolicy } from '@deepseek-ai/dsh-llm'
import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai'
import type { ResolvedPiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'
import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import type { OpenAICodexCredentialStore } from './store.ts'
import { OPENAI_CODEX_PROVIDER } from './store.ts'

/** Provider idle ceiling used by the composite route. */
export const OPENAI_CODEX_STREAM_IDLE_TIMEOUT_MS = 300_000

/**
 * Give the generic dsh adapter a request-scoped bearer-token entry without
 * changing the provider's user-facing OAuth flow. The resolver accepts only
 * the explicit override supplied by this plugin; it never discovers an API
 * key from the environment or persistent api-key credentials.
 */
function requestProvider(provider: Provider, contextWindow?: number): Provider {
  const wrapped: Provider = {
    ...provider,
    auth: {
      ...provider.auth,
      apiKey: {
        name: 'OpenAI Codex OAuth bearer token',
        async resolve({ credential }) {
          const apiKey = credential?.key
          return apiKey === undefined || apiKey.length === 0
            ? undefined
            : { auth: { apiKey }, source: 'OAuth' }
        },
      },
    },
  }
  if (contextWindow === undefined) return wrapped
  return {
    ...wrapped,
    getModels: () => wrapped.getModels().map(model => ({ ...model, contextWindow })),
  }
}

/**
 * Create the Codex subscription adapter without requiring a dsh fork. The
 * public pi-ai adapter owns Harness message conversion, image attachment
 * resolution, streaming, reasoning metadata, and compaction behavior; this
 * plugin supplies its provider-native OAuth token for each request.
 *
 * When a proxy is configured the profile forces the SSE transport: the
 * Codex WebSocket path in Node cannot traverse an HTTP proxy, so proxying
 * would silently bypass the tunnel unless the SSE path is used.
 * @param credentials - persistent provider-owned OAuth store.
 * @param resolveAttachments - resolve the optional durable attachment service.
 * @param resolveProxyEnabled - read the live proxy setting before each request.
 * @param resolveContextWindow - read the optional global model-context override.
 *   A fresh profile map is published per call so either setting reaches the next
 *   request without a restart while in-flight requests keep their snapshot.
 */
export function createOpenAICodexAdapter(
  credentials: OpenAICodexCredentialStore,
  resolveAttachments: () => AttachmentStore | undefined,
  resolveProxyEnabled: () => boolean,
  resolveContextWindow: () => number | undefined,
): PiAiAdapter {
  const provider = openaiCodexProvider()
  const baseProfile: ResolvedPiAiProviderProfile = {
    provider: OPENAI_CODEX_PROVIDER,
    displayName: 'OpenAI Codex',
    streamIdleTimeoutMs: OPENAI_CODEX_STREAM_IDLE_TIMEOUT_MS,
    retryPolicy: resolveRetryPolicy(undefined, 'dsh-codex-connect retryPolicy'),
    configuredMaxTokens: new Map(),
    piProvider: requestProvider(provider),
  }
  const models: MutableModels = createModels({ credentials })
  models.setProvider(provider)
  return new PiAiAdapter({
    profiles: () => {
      const contextWindow = resolveContextWindow()
      const proxyEnabled = resolveProxyEnabled()
      const profile = contextWindow === undefined && !proxyEnabled
        ? baseProfile
        : {
            ...baseProfile,
            ...contextWindow === undefined ? {} : { piProvider: requestProvider(provider, contextWindow) },
            ...proxyEnabled ? { transport: 'sse' as const } : {},
          }
      return new Map<string, ResolvedPiAiProviderProfile>([[OPENAI_CODEX_PROVIDER, profile]])
    },
    resolveApiKey: async () => (await models.getAuth(OPENAI_CODEX_PROVIDER))?.auth.apiKey,
    resolveAttachments,
  })
}
