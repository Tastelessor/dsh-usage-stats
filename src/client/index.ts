/**
 * dsh-usage-stats browser half: registers the Settings → Usage Stats section.
 * @module dsh-usage-stats/client
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'

export const name = 'dsh-usage-stats'

export function apply(ctx: ClientContext): void {
  ctx.logger.info('dsh-usage-stats: client half loaded')
}
