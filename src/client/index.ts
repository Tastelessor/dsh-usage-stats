/**
 * dsh-usage-stats browser half: registers the Settings → Usage Stats section.
 * The node half serves aggregated JSON; this half only fetches and renders.
 * @module dsh-usage-stats/client
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the shell's SlotMap merge (the 'settings.section' entry).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { UsageStatsSection } from './UsageStatsSection.tsx'
import type { UsageStatsSectionProps } from './UsageStatsSection.tsx'
import { zh, en, type UsageStatsKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The usage-stats page copy. */
    'settings.usageStats': UsageStatsKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'settings.usageStats'

export const inject = ['slots', 'locale']

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-usage-stats: copy dictionaries')

  const t = ctx.locale.bind(NS)
  const injected = (): UsageStatsSectionProps => ({
    placeholder: t('placeholder'),
  })

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'usage-stats',
    order: 20,
    label: () => t('nav'),
    inject: injected,
  }, UsageStatsSection))
}
