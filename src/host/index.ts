/**
 * dsh-usage-stats host half: aggregates token usage from persisted session
 * logs and serves it as JSON over a plugin-owned HTTP route.
 * @module dsh-usage-stats/host
 */

import type { Context } from '@deepseek-ai/cordis'

export const name = 'dsh-usage-stats'

/** Host services this plugin depends on (filled in later tasks). */
export const inject = ['llm', 'sessionQuery', 'webServer']

export function apply(ctx: Context): void {
  ctx.logger.info('dsh-usage-stats: host half loaded')
}
