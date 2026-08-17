/**
 * ChatGPT OAuth and Codex models for DeepSeek Harness, with opt-in search and
 * image tooling.
 * @module dsh-codex-connect
 */

import type { Context, Fiber } from '@deepseek-ai/cordis'
import { randomUUID } from 'node:crypto'
import z from '@deepseek-ai/schemastery'
import { deepEqualJson, installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-web'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-fs'
import { createOpenAICodexAdapter } from './adapter.ts'
import { registerOpenAICodexAuthRoutes } from './auth-routes.ts'
import { assertNoOpenAICodexProviderConflict } from './doctor.ts'
import { buildCodexProxyConfig, installCodexProxyFetch } from './proxy.ts'
import { viewImageTool } from './view-image.ts'
import {
  installOpenAICodexSearchEvent,
  recordOpenAICodexSearchRequest,
} from './search-event.ts'

export { VIEW_IMAGE_TOOL_NAME } from './view-image.ts'
export {
  assertNoOpenAICodexProviderConflict,
  diagnoseOpenAICodex,
  openAICodexConflictMessage,
} from './doctor.ts'
export type {
  OpenAICodexDiagnosticOptions,
  OpenAICodexDiagnosticReport,
} from './doctor.ts'
export {
  assessCompatibility,
  COMPATIBILITY_CONTRACT,
  COMPATIBILITY_PACKAGES,
  COMPATIBILITY_SCHEMA_VERSION,
  detectCompatibility,
  DSH_PLUGIN_API_PACKAGES,
  PI_AI_PACKAGE,
  SUPPORTED_DSH_PLUGIN_API_VERSION,
  SUPPORTED_NODE_RANGE,
  SUPPORTED_PI_AI_VERSION,
  evaluateCompatibility,
} from './compatibility.ts'
export type {
  CompatibilityDetectionOptions,
  CompatibilityEntry,
  CompatibilityEvaluationInput,
  CompatibilityPackageName,
  CompatibilityReport,
  CompatibilityStatus,
} from './compatibility.ts'
export { OPENAI_CODEX_USAGE_URL, parseOpenAICodexUsage, readOpenAICodexRateLimits } from './usage.ts'
export type {
  OpenAICodexCredits,
  OpenAICodexIndividualLimit,
  OpenAICodexRateLimit,
  OpenAICodexRateLimitWindow,
  OpenAICodexUsage,
} from './usage.ts'
export {
  installOpenAICodexSearchEvent,
  OPENAI_CODEX_SEARCH_MODEL_REQUEST_EVENT,
  recordOpenAICodexSearchRequest,
} from './search-event.ts'
import {
  DEFAULT_OPENAI_CODEX_SEARCH_CONTEXT_SIZE,
  DEFAULT_OPENAI_CODEX_SEARCH_MAX_OUTPUT_TOKENS,
  DEFAULT_OPENAI_CODEX_SEARCH_MODE,
  DEFAULT_OPENAI_CODEX_SEARCH_MODEL,
  OpenAICodexSearchProvider,
} from './search.ts'
import type { OpenAICodexSearchContextSize, OpenAICodexSearchMode } from './search.ts'
import { OpenAICodexCredentialStore, OPENAI_CODEX_PROVIDER } from './store.ts'
import {
  OPENAI_CODEX_SETTINGS_NAMESPACE,
  resolveOpenAICodexSettings,
} from './settings-contract.ts'

export {
  decodeOpenAICodexSettings,
  DEFAULT_OPENAI_CODEX_SETTINGS,
  OPENAI_CODEX_SETTINGS_NAMESPACE,
  resolveOpenAICodexSettings,
} from './settings-contract.ts'
export type { OpenAICodexSettingsConfig } from './settings-contract.ts'

export {
  buildCodexProxyConfig,
  installCodexProxyFetch,
  isCodexTargetUrl,
  proxyFetch,
} from './proxy.ts'
export type { OpenAICodexProxyConfig } from './proxy.ts'

export { loginOpenAICodex, logoutOpenAICodex, openAICodexAuthStatus } from './auth.ts'
export type { OpenAICodexAuthStatus } from './auth.ts'
export {
  CodexAuthImportError,
  codexAuthJsonPath,
  importCodexAuthCredential,
  MAX_CODEX_AUTH_IMPORT_BYTES,
  parseCodexAuthJson,
  readCodexAuthCredential,
} from './codex-auth-import.ts'
export type {
  CodexAuthImportErrorCode,
  CodexAuthImportOptions,
  CodexAuthImportResult,
} from './codex-auth-import.ts'
export {
  OpenAICodexCredentialStore,
  OPENAI_CODEX_AUTH_FILENAME,
  OPENAI_CODEX_PROVIDER,
  openAICodexAuthPath,
} from './store.ts'
export {
  DEFAULT_OPENAI_CODEX_SEARCH_CONTEXT_SIZE,
  DEFAULT_OPENAI_CODEX_SEARCH_MAX_OUTPUT_TOKENS,
  DEFAULT_OPENAI_CODEX_SEARCH_MODE,
  DEFAULT_OPENAI_CODEX_SEARCH_MODEL,
  mapOpenAICodexSearchResponse,
  OpenAICodexSearchProvider,
  OPENAI_CODEX_BASE_URL,
  OPENAI_CODEX_SEARCH_PROVIDER,
  OPENAI_CODEX_SEARCH_URL,
} from './search.ts'
export type {
  OpenAICodexSearchContextSize,
  OpenAICodexSearchMode,
  OpenAICodexSearchProviderOptions,
  OpenAICodexSearchRequestRecord,
} from './search.ts'

/** Stable Cordis plugin name. */
export const name = 'llm-openai-codex'

/** The model registry required before the provider can register. */
export const inject = ['llm']

/** Branded Host settings namespace used by the configurable-provider directory. */
export const OPENAI_CODEX_SETTINGS_NS = settingsNamespace(OPENAI_CODEX_SETTINGS_NAMESPACE)

/** Composite model and standalone-search configuration. */
export interface Config {
  /** Register the optional standalone Codex search provider. */
  enableSearch?: boolean
  /** Register the optional image-loading tool. */
  enableImageTool?: boolean
  /** Model used for auxiliary standalone searches. */
  searchModel?: string
  /** Cached, indexed, or live web access. */
  searchMode?: OpenAICodexSearchMode
  /** Amount of search context returned by the provider. */
  searchContextSize?: OpenAICodexSearchContextSize
  /** Maximum generated tokens returned by the standalone search endpoint. */
  searchMaxOutputTokens?: number
  /**
   * Context-window override, in tokens, applied to every Codex model. Omit it
   * to retain the capacities published by the upstream pi-ai catalog.
   */
  contextWindow?: number
  /**
   * HTTP(S) proxy host for every OpenAI/ChatGPT request: a hostname or IP,
   * optionally `host:port` or `scheme://host[:port]`. Leave blank to send
   * requests directly.
   */
  proxyAddress?: string
  /** HTTP(S) proxy port, used when `proxyAddress` carries none. */
  proxyPort?: number
}

export const Config: z<Config> = z.object({
  enableSearch: z.boolean().default(false),
  enableImageTool: z.boolean().default(false),
  searchModel: z.string().default(DEFAULT_OPENAI_CODEX_SEARCH_MODEL),
  searchMode: z.union(['cached', 'indexed', 'live'] as const).default(DEFAULT_OPENAI_CODEX_SEARCH_MODE),
  searchContextSize: z.union(['low', 'medium', 'high'] as const).default(DEFAULT_OPENAI_CODEX_SEARCH_CONTEXT_SIZE),
  searchMaxOutputTokens: z.number().step(1).min(1).default(DEFAULT_OPENAI_CODEX_SEARCH_MAX_OUTPUT_TOKENS),
  contextWindow: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER),
  proxyAddress: z.string().default(''),
  proxyPort: z.number().step(1).min(1).max(65535),
})

/**
 * Register the `openai-codex` LLM route with one provider-native OAuth store.
 * Search and image tooling are added only when their config flags are true.
 * Selecting this route as the Harness default remains a separate profile choice.
 * @param ctx - plugin context carrying the LLM registry plus optional services.
 * @param config - capability gates and standalone-search tuning.
 */
export function apply(ctx: Context, config: Config): void {
  let current = () => config
  const credentials = new OpenAICodexCredentialStore()
  assertNoOpenAICodexProviderConflict(ctx.llm.listProviders().map(provider => provider.id))
  ctx.llm.registerAdapter(
    [OPENAI_CODEX_PROVIDER],
    createOpenAICodexAdapter(
      credentials,
      () => ctx.get('attachments'),
      () => buildCodexProxyConfig(resolveOpenAICodexSettings(current())) !== undefined,
      () => resolveOpenAICodexSettings(current()).contextWindow,
    ),
  )
  ctx.llm.registerConfigurableProviders([{
    provider: OPENAI_CODEX_PROVIDER,
    displayName: 'OpenAI Codex',
    settingsNs: OPENAI_CODEX_SETTINGS_NS,
    settingsPath: [],
    declared: false,
  }])
  ctx.inject(['webServer'], webCtx => registerOpenAICodexAuthRoutes(webCtx, credentials))

  let stopped = false
  let searchFiber: Fiber | undefined
  let searchRegistration: object | undefined
  let searchTail = Promise.resolve()
  let imageFiber: Fiber | undefined
  let imageTail = Promise.resolve()
  let proxyPatch: (() => void) | undefined
  let proxyKey = ''
  let proxyTail = Promise.resolve()

  const reconcileSearch = async (): Promise<void> => {
    if (stopped) return
    const resolved = resolveOpenAICodexSettings(current())
    const nextRegistration = resolved.enableSearch
      ? {
          model: resolved.searchModel,
          mode: resolved.searchMode,
          contextSize: resolved.searchContextSize,
          maxOutputTokens: resolved.searchMaxOutputTokens,
        }
      : undefined
    if (deepEqualJson(nextRegistration, searchRegistration)) return
    const previous = searchFiber
    searchFiber = undefined
    searchRegistration = undefined
    if (previous !== undefined) await previous.dispose()
    if (stopped || nextRegistration === undefined) return
    installOpenAICodexSearchEvent()
    const fiber = ctx.inject(['web'], webCtx => webCtx.web.registerSearchProvider(new OpenAICodexSearchProvider({
      credentials,
      model: nextRegistration.model,
      mode: nextRegistration.mode,
      contextSize: nextRegistration.contextSize,
      maxOutputTokens: nextRegistration.maxOutputTokens,
      resolveRequestId: () => String(webCtx.get('agents')?.currentInitiator()?.session.id ?? randomUUID()),
      recordRequest: request => { recordOpenAICodexSearchRequest(webCtx, request) },
    })))
    searchFiber = fiber
    searchRegistration = nextRegistration
    void Promise.resolve(fiber).catch((error: unknown) => {
      if (searchFiber === fiber) {
        searchFiber = undefined
        searchRegistration = undefined
      }
      ctx.logger.error('dsh-codex-connect: optional search provider failed to activate')
      ctx.logger.error(error)
    })
  }

  const reconcileImageTool = async (): Promise<void> => {
    if (stopped) return
    const enabled = resolveOpenAICodexSettings(current()).enableImageTool
    if (enabled === (imageFiber !== undefined)) return
    const previous = imageFiber
    imageFiber = undefined
    if (previous !== undefined) await previous.dispose()
    if (stopped || !enabled) return
    const fiber = ctx.inject(
      ['tools', 'fs', 'attachments'],
      toolCtx => toolCtx.tools.register(viewImageTool(toolCtx)),
    )
    imageFiber = fiber
    void Promise.resolve(fiber).catch((error: unknown) => {
      if (imageFiber === fiber) imageFiber = undefined
      ctx.logger.error('dsh-codex-connect: optional view_image tool failed to activate')
      ctx.logger.error(error)
    })
  }

  /**
   * Apply or remove the proxy fetch patch for the current settings. The patch
   * is scoped to the first-party OpenAI/ChatGPT hosts, so changing the proxy
   * setting reroutes the next request while every other URL keeps the original
   * fetch. A blank address removes the patch and restores direct connections.
   */
  const reconcileProxy = async (): Promise<void> => {
    if (stopped) return
    const resolved = resolveOpenAICodexSettings(current())
    const config = buildCodexProxyConfig(resolved)
    const key = config === undefined ? '' : config.href
    if (key === proxyKey) return
    if (proxyPatch !== undefined) {
      proxyPatch()
      proxyPatch = undefined
    }
    proxyKey = key
    if (config !== undefined) proxyPatch = installCodexProxyFetch(config)
  }

  const scheduleCapabilities = (): void => {
    searchTail = searchTail.then(reconcileSearch, reconcileSearch).catch((error: unknown) => {
      ctx.logger.error('dsh-codex-connect: could not apply the updated search configuration')
      ctx.logger.error(error)
    })
    imageTail = imageTail.then(reconcileImageTool, reconcileImageTool).catch((error: unknown) => {
      ctx.logger.error('dsh-codex-connect: could not apply the updated image-tool configuration')
      ctx.logger.error(error)
    })
    proxyTail = proxyTail.then(reconcileProxy, reconcileProxy).catch((error: unknown) => {
      ctx.logger.error('dsh-codex-connect: could not apply the updated proxy configuration')
      ctx.logger.error(error)
    })
  }

  ctx.effect(() => async () => {
    stopped = true
    await Promise.all([searchTail, imageTail, proxyTail])
    if (proxyPatch !== undefined) {
      proxyPatch()
      proxyPatch = undefined
    }
    const search = searchFiber
    const image = imageFiber
    searchFiber = undefined
    imageFiber = undefined
    await Promise.allSettled([
      search?.dispose() ?? Promise.resolve(),
      image?.dispose() ?? Promise.resolve(),
    ])
  }, 'dsh-codex-connect: optional capability lifecycle')

  installSettingsSection(ctx, OPENAI_CODEX_SETTINGS_NS, Config, config, {
    setSource(source) { current = source },
    onChange: scheduleCapabilities,
  })
  scheduleCapabilities()
}
