/**
 * dsh-usage-stats browser half: registers the Settings → Usage Stats section.
 * The node half serves aggregated JSON; this half fetches, renders, and
 * persists edited model prices through the plugin's own write route (the
 * host's settings seam answers "settings-not-exposed" to web clients for
 * external-plugin namespaces, so the round-trip rides the plugin HTTP route
 * instead of the settings RPC).
 * @module dsh-usage-stats/client
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the shell's SlotMap merge (the 'settings.section' entry).
// Cross-plugin collaboration goes through the service, never a value import
// (client bundle purity gate).
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
import type { Currency, ModelPrice } from '../shared/types.ts'

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

/** Every window the page offers; the store warms them all at activation. */
const RANGES = [7, 15, 30] as const

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

  // Price-editor write-back: the host merges the edited currency's prices
  // over its resolved config and persists through the settings seam, then
  // busts the response caches so the next fetch reflects the new prices.
  const savePrices = async (currency: Currency, prices: Record<string, ModelPrice>): Promise<void> => {
    const response = await fetch('/dsh-usage-stats/prices', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ currency, prices }),
    })
    const body = await response.json().catch(() => null) as { ok?: boolean } | null
    if (!response.ok || body?.ok !== true) throw new Error('price save rejected')
    controller.clearCache()
    await controller.refresh()
    for (const days of RANGES) {
      if (days !== controller.store.getSnapshot().days) void controller.prefetch(days)
    }
  }

  const injected = (): UsageStatsSectionProps => ({
    controller,
    useSnapshot,
    t,
    onSavePrices: savePrices,
  })

  // The section body only exposes range/refresh controls after the first
  // response (an idle snapshot renders the loading text), so fetch the
  // default range once at activation and warm the other windows in the
  // background — range switches then render from cache instead of waiting
  // on a cold aggregation.
  ctx.effect(() => {
    const initial = controller.store.getSnapshot().days
    void controller.load(initial)
    for (const days of RANGES) {
      if (days !== initial) void controller.prefetch(days)
    }
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
