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
import type { LocaleId } from '@deepseek-ai/dsh-client-locale/client'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { UsageStatsSection } from './UsageStatsSection.tsx'
import type { UsageStatsSectionProps } from './UsageStatsSection.tsx'
import { UsageStatsStore } from './store.ts'
import type { UsageStatsState } from './store.ts'
import { zh, en, type UsageStatsKey } from './locales.ts'
import { injectUsageStatsCss } from './usage-stats.css.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The usage-stats page copy. */
    'settings.usageStats': UsageStatsKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'settings.usageStats'

/** rc.6's LocaleDictOf types every dictionary value as string, but this
 * namespace ships function-valued keys (rangeDays, unpricedHint); the locale
 * runtime stores entries by value and functions pass through untouched, so
 * the contract is narrowed once at registration. */
type UsageStatsDicts = Record<LocaleId, Record<UsageStatsKey, string>>

export const inject = ['slots', 'locale']

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en } as unknown as UsageStatsDicts), 'dsh-usage-stats: copy dictionaries')

  // One <style data-plugin="dsh-usage-stats"> tag, appended once (idempotent).
  ctx.effect(() => {
    injectUsageStatsCss()
    return () => {}
  }, 'dsh-usage-stats: inject styles')

  const controller = new UsageStatsStore()
  const bound = bindSnapshotSelector(controller.store)
  const selectAll = (s: UsageStatsState): UsageStatsState => s
  const useSnapshot = (): UsageStatsState => bound(selectAll)
  // Function-valued keys (rangeDays, unpricedHint) force the loose translate
  // signature on the section's `t` seat; the bound translate satisfies it.
  const t = ctx.locale.bind(NS) as (key: string) => any
  const injected = (): UsageStatsSectionProps => ({
    controller,
    useSnapshot,
    t,
  })

  // The section body only exposes range/refresh controls after the first
  // response (an idle snapshot renders the loading text), so fetch the
  // default range once at activation; later loads ride the buttons.
  ctx.effect(() => {
    void controller.load(controller.store.getSnapshot().days)
    return () => {}
  }, 'dsh-usage-stats: initial stats load')

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'usage-stats',
    order: 20,
    label: () => t('nav'),
    inject: injected,
  }, UsageStatsSection))
}
