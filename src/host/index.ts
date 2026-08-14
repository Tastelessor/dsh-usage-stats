/**
 * dsh-usage-stats host half: aggregates token usage from persisted session
 * logs and serves it as JSON over a plugin-owned HTTP route.
 * @module dsh-usage-stats/host
 */

import type { Context } from '@deepseek-ai/cordis'
import { installSettingsSection } from '@deepseek-ai/dsh-settings'
import { ConfigSchema, NS, type Config } from './config.ts'

export const name = 'dsh-usage-stats'

/** Host services this plugin depends on (filled in later tasks). */
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
  ctx.logger.info('dsh-usage-stats: host half loaded')
}
