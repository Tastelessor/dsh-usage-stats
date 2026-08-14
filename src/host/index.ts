/**
 * dsh-usage-stats host half: aggregates token usage from persisted session
 * logs and serves it as JSON over a plugin-owned HTTP route.
 * @module dsh-usage-stats/host
 */

import type { Context } from '@deepseek-ai/cordis'
import { installSettingsSection } from '@deepseek-ai/dsh-settings'
// Loads the '@deepseek-ai/cordis' Context augmentation that types ctx.webServer.
import type {} from '@deepseek-ai/dsh-host-webserver'
import { ConfigSchema, NS, resolveCurrency, resolvePriceTable, type Config } from './config.ts'
import { createStatsHandler } from './stats-route.ts'

export const name = 'dsh-usage-stats'

/** Host services this plugin depends on. */
export const inject = ['llm', 'sessionQuery', 'webServer']

export function apply(ctx: Context, config: Config): void {
  // Resolved-config source: starts as the composition entry; the settings
  // wiring swaps it to the live scope while a settings service is mounted.
  let current: () => Config = () => config
  installSettingsSection(ctx, NS, ConfigSchema, config, {
    setSource: (source) => {
      current = source
    },
    onChange: () => {},
  })
  const llm = ctx.llm
  const sessionQuery = ctx.sessionQuery
  const prices = (): ReturnType<typeof resolvePriceTable> => resolvePriceTable(current())
  const handler = createStatsHandler({
    listSessions: (signal?: AbortSignal) => sessionQuery.listSessions(signal),
    readSession: (sessionId) => sessionQuery.readSession(sessionId),
    listProviders: () => llm.listProviders(),
    listModels: (provider) => llm.listModels(provider),
    prices,
    currency: () => resolveCurrency(current()),
  })
  ctx.effect(
    () => ctx.webServer.register({ kind: 'prefix', path: '/dsh-usage-stats', handler }),
    'dsh-usage-stats: stats route',
  )
  ctx.logger.info('dsh-usage-stats: host half loaded')
}
