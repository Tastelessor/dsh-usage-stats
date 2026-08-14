/**
 * Plugin configuration: a per-model price table keyed by model id, split by
 * currency (CNY default, USD optional), plus the preferred display currency.
 * Defaults cover the official DeepSeek route's catalog (deepseek-v4-flash,
 * deepseek-v4-pro). Price values are per 1M tokens in the given currency; fill
 * the current official public prices here (verify against the provider's
 * pricing page; README carries the "official prices win" disclaimer).
 */

import z from '@deepseek-ai/schemastery'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { SETTINGS_NAMESPACE } from '../shared/types.ts'
import type { Currency, ModelPrice, ModelPricesByCurrency } from '../shared/types.ts'

/** Settings namespace of this plugin (the string value is shared with the client). */
export const NS = settingsNamespace(SETTINGS_NAMESPACE)

/** Default display currency. */
export const DEFAULT_CURRENCY: Currency = 'CNY'

/**
 * Default prices in CNY, keyed by the exact ids the official llm-deepseek
 * catalog advertises (CNY per 1M tokens).
 */
export const DEFAULT_PRICES_CNY: Record<string, ModelPrice> = {
  // TODO(verify-prices): replace the example numbers below with the current
  // official DeepSeek public prices before release; the acceptance tests only
  // assert positivity, so this is a manual step.
  'deepseek-v4-flash': { inputPerM: 0.28, cacheReadPerM: 0.028, outputPerM: 0.42, cacheWritePerM: 0.28 },
  'deepseek-v4-pro': { inputPerM: 0.56, cacheReadPerM: 0.056, outputPerM: 0.84, cacheWritePerM: 0.56 },
}

/**
 * Default prices in USD. Placeholder conversion from the CNY defaults at a
 * 7.2 CNY/USD reference rate, rounded to 3 decimals.
 * TODO(verify-prices): replace with the current official DeepSeek USD prices
 * before release; the acceptance tests only assert positivity.
 */
export const DEFAULT_PRICES_USD: Record<string, ModelPrice> = {
  'deepseek-v4-flash': { inputPerM: 0.039, cacheReadPerM: 0.004, outputPerM: 0.058, cacheWritePerM: 0.039 },
  'deepseek-v4-pro': { inputPerM: 0.078, cacheReadPerM: 0.008, outputPerM: 0.117, cacheWritePerM: 0.078 },
}

/** Raw plugin config; every field optional in yml. */
export interface Config {
  /** Preferred display currency for prices and amounts; defaults to CNY. */
  currency?: Currency
  /** Per-model prices by currency; omitted entries fall back to the defaults. */
  models?: Record<string, ModelPricesByCurrency>
}

const priceSchema = z.object({
  inputPerM: z.number().min(0).required(),
  cacheReadPerM: z.number().min(0).required(),
  outputPerM: z.number().min(0).required(),
  cacheWritePerM: z.number().min(0).required(),
})

// Schemastery object keys are optional by default; `cny`/`usd` may be absent.
const currencyPricesSchema = z.object({
  cny: priceSchema,
  usd: priceSchema,
})

/** Schemastery schema doubling as the settings-section shape. */
export const ConfigSchema: z<Config> = z.object({
  currency: z.union([z.const('CNY'), z.const('USD')]).default(DEFAULT_CURRENCY),
  models: z.dict(currencyPricesSchema).default({}),
})

/** Resolved per-currency price tables: configured entries win, defaults fill the rest. */
export function resolvePriceTables(config: Config | undefined): {
  cny: Record<string, ModelPrice>
  usd: Record<string, ModelPrice>
} {
  const cny = { ...DEFAULT_PRICES_CNY }
  const usd = { ...DEFAULT_PRICES_USD }
  for (const [id, entry] of Object.entries(config?.models ?? {})) {
    if (entry.cny !== undefined) cny[id] = entry.cny
    if (entry.usd !== undefined) usd[id] = entry.usd
  }
  return { cny, usd }
}

/** Resolve the price table for one display currency. */
export function resolvePriceTable(config: Config | undefined, currency: Currency): Record<string, ModelPrice> {
  return resolvePriceTables(config)[currency === 'CNY' ? 'cny' : 'usd']
}

/** Resolve the preferred display currency. */
export function resolveCurrency(config: Config | undefined): Currency {
  return config?.currency ?? DEFAULT_CURRENCY
}
