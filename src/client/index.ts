/**
 * dsh-usage-stats browser half: registers the Settings → Usage Stats section.
 * The node half serves aggregated JSON; this half fetches, renders, and
 * persists edited model prices back through the settings scope.
 * @module dsh-usage-stats/client
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
// Type-only: pulls the shell's SlotMap merge (the 'settings.section' entry)
// and the ctx.settingsScope Context merge. Cross-plugin collaboration goes
// through the service, never a value import (client bundle purity gate).
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the ctx.remote Context merge and the forwarded-event key face.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings/types'
import type { LocaleId } from '@deepseek-ai/dsh-client-locale/client'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-web-react'
import { UsageStatsSection } from './UsageStatsSection.tsx'
import type { UsageStatsSectionProps } from './UsageStatsSection.tsx'
import { UsageStatsStore } from './store.ts'
import type { UsageStatsState } from './store.ts'
import { zh, en, type UsageStatsKey } from './locales.ts'
import { injectUsageStatsCss } from './usage-stats.css.ts'
import { SETTINGS_NAMESPACE } from '../shared/types.ts'
import type { Config } from '../host/config.ts'
import type { Currency, ModelPrice, ModelPricesByCurrency } from '../shared/types.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The usage-stats page copy. */
    'settings.usageStats': UsageStatsKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'settings.usageStats'

/** Settings namespace branded for the scope bind (same value the host installs). */
const SETTINGS_NS = SETTINGS_NAMESPACE as unknown as SettingsNamespace

/** rc.6's LocaleDictOf types every dictionary value as string, but this
 * namespace ships function-valued keys (rangeDays, unpricedHint); the locale
 * runtime stores entries by value and functions pass through untouched, so
 * the contract is narrowed once at registration. */
type UsageStatsDicts = Record<LocaleId, Record<UsageStatsKey, string>>

export const inject = ['slots', 'locale', 'connection', 'remote', 'settingsScope']

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

  // Price-editor write-back: overlay the edited currency's prices on the
  // current section and persist through the settings scope; the host's
  // settings wiring then serves the new prices on the next stats fetch.
  const scope = ctx.settingsScope.bind<Config>({ namespace: SETTINGS_NS })
  const savePrices = async (currency: Currency, prices: Record<string, ModelPrice>): Promise<void> => {
    const models: Record<string, ModelPricesByCurrency> = { ...(scope.getSnapshot().value?.models ?? {}) }
    for (const [id, price] of Object.entries(prices)) {
      models[id] = { ...(models[id] ?? {}), [currency === 'CNY' ? 'cny' : 'usd']: price }
    }
    await scope.set('models', models)
    await controller.refresh()
  }

  const injected = (): UsageStatsSectionProps => ({
    controller,
    useSnapshot,
    t,
    onSavePrices: savePrices,
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
