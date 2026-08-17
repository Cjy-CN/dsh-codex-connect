/** Node-free settings contract shared by the Host plugin and browser card. */

/** Stable Harness settings namespace owned by this plugin. */
export const OPENAI_CODEX_SETTINGS_NAMESPACE = 'llm-openai-codex'

/** Search modes accepted by the Codex standalone search endpoint. */
export type OpenAICodexSearchMode = 'cached' | 'indexed' | 'live'

/** Search-context sizes accepted by the Codex standalone search endpoint. */
export type OpenAICodexSearchContextSize = 'low' | 'medium' | 'high'

/** Default model used by the standalone search endpoint. */
export const DEFAULT_OPENAI_CODEX_SEARCH_MODEL = 'gpt-5.6-sol'
/** Default search mode, matching the official local Codex client. */
export const DEFAULT_OPENAI_CODEX_SEARCH_MODE: OpenAICodexSearchMode = 'cached'
/** Default provider search-context size. */
export const DEFAULT_OPENAI_CODEX_SEARCH_CONTEXT_SIZE: OpenAICodexSearchContextSize = 'medium'
/** Default output budget for the standalone search response. */
export const DEFAULT_OPENAI_CODEX_SEARCH_MAX_OUTPUT_TOKENS = 10_000

/** Fully resolved user-editable section presented by Plugin configuration. */
export interface OpenAICodexSettingsConfig {
  enableSearch: boolean
  enableImageTool: boolean
  searchModel: string
  searchMode: OpenAICodexSearchMode
  searchContextSize: OpenAICodexSearchContextSize
  searchMaxOutputTokens: number
  /**
   * Optional context-window override, in tokens, applied to every Codex model.
   * Omitting it preserves the upstream pi-ai model catalog capacity.
   */
  contextWindow?: number
  /**
   * HTTP(S) proxy host for every OpenAI/ChatGPT request: a hostname or IP,
   * optionally `host:port` or `scheme://host[:port]`. An empty value disables
   * proxying and sends requests directly.
   */
  proxyAddress: string
  /**
   * HTTP(S) proxy port used when `proxyAddress` does not carry one. Omitting
   * both leaves proxying disabled.
   */
  proxyPort?: number
}

export const DEFAULT_OPENAI_CODEX_SETTINGS: Readonly<OpenAICodexSettingsConfig> = Object.freeze({
  enableSearch: false,
  enableImageTool: false,
  searchModel: DEFAULT_OPENAI_CODEX_SEARCH_MODEL,
  searchMode: DEFAULT_OPENAI_CODEX_SEARCH_MODE,
  searchContextSize: DEFAULT_OPENAI_CODEX_SEARCH_CONTEXT_SIZE,
  searchMaxOutputTokens: DEFAULT_OPENAI_CODEX_SEARCH_MAX_OUTPUT_TOKENS,
  proxyAddress: '',
})

/** Fill the schema defaults even when called without Cordis validation. */
export function resolveOpenAICodexSettings(
  value: Partial<OpenAICodexSettingsConfig>,
): OpenAICodexSettingsConfig {
  return { ...DEFAULT_OPENAI_CODEX_SETTINGS, ...value }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Narrow the redacted settings wire payload before it enters React state. */
export function decodeOpenAICodexSettings(value: unknown): OpenAICodexSettingsConfig | undefined {
  if (!isRecord(value)) return undefined
  const enableSearch = value['enableSearch']
  const enableImageTool = value['enableImageTool']
  const searchModel = value['searchModel']
  const searchMode = value['searchMode']
  const searchContextSize = value['searchContextSize']
  const searchMaxOutputTokens = value['searchMaxOutputTokens']
  const contextWindow = value['contextWindow']
  const proxyAddress = value['proxyAddress']
  const proxyPort = value['proxyPort']
  if (typeof enableSearch !== 'boolean' || typeof enableImageTool !== 'boolean') return undefined
  if (typeof searchModel !== 'string' || searchModel.trim().length === 0) return undefined
  if (searchMode !== 'cached' && searchMode !== 'indexed' && searchMode !== 'live') return undefined
  if (searchContextSize !== 'low' && searchContextSize !== 'medium' && searchContextSize !== 'high') return undefined
  if (typeof searchMaxOutputTokens !== 'number' || !Number.isInteger(searchMaxOutputTokens) || searchMaxOutputTokens < 1) return undefined
  const resolvedContextWindow = contextWindow === undefined || contextWindow === null
    ? undefined
    : typeof contextWindow === 'number' && Number.isSafeInteger(contextWindow) && contextWindow >= 1
      ? contextWindow
      : undefined
  if (contextWindow !== undefined && contextWindow !== null && resolvedContextWindow === undefined) return undefined
  if (typeof proxyAddress !== 'string') return undefined
  const resolvedProxyPort = proxyPort === undefined || proxyPort === null
    ? undefined
    : typeof proxyPort === 'number' && Number.isInteger(proxyPort) && proxyPort >= 1 && proxyPort <= 65535
      ? proxyPort
      : undefined
  if (proxyPort !== undefined && proxyPort !== null && resolvedProxyPort === undefined) return undefined
  return {
    enableSearch,
    enableImageTool,
    searchModel,
    searchMode,
    searchContextSize,
    searchMaxOutputTokens,
    ...resolvedContextWindow === undefined ? {} : { contextWindow: resolvedContextWindow },
    proxyAddress,
    ...resolvedProxyPort === undefined ? {} : { proxyPort: resolvedProxyPort },
  }
}
