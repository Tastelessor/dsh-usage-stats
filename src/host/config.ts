/**
 * Plugin configuration: a per-model price table keyed by model id, split by
 * currency (CNY default, USD optional), plus the preferred display currency.
 * Defaults cover the official DeepSeek route's catalog (deepseek-v4-flash,
 * deepseek-v4-pro) with the 2026-08-17+ official peak/off-peak prices.
 *
 * Prices are per 1M tokens in the given currency. Since 2026-08-17 DeepSeek
 * bills time-of-day tiers: peak hours are Beijing time 09:00–12:00 and
 * 14:00–18:00, off-peak is half of peak. A model's per-currency entry is a
 * `{ peak, offPeak }` pair; legacy flat entries (a bare 4-bucket price) still
 * parse and are normalized to both tiers equal ("this price applies at all
 * hours"). Fill the current official public prices here (verify against the
 * provider's pricing page; README carries the "official prices win"
 * disclaimer).
 */

import z from '@deepseek-ai/schemastery'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { SETTINGS_NAMESPACE } from '../shared/types.ts'
import type { Currency, ModelPrice, ModelPricesByCurrency, TieredModelPrice } from '../shared/types.ts'

/** Settings namespace of this plugin (the string value is shared with the client). */
export const NS = settingsNamespace(SETTINGS_NAMESPACE)

/** Default display currency. */
export const DEFAULT_CURRENCY: Currency = 'CNY'

/** Zero cache-write price: the official v4 pricing has no cache-write bucket. */
const NO_CACHE_WRITE = 0

/**
 * Default prices in CNY, keyed by the exact ids the official llm-deepseek
 * catalog advertises (CNY per 1M tokens, cache hit / miss / output).
 * Verified against the official DeepSeek API pricing page
 * (api-docs.deepseek.com, fetched 2026-08-18): peak hours are Beijing time
 * 09:00–12:00 and 14:00–18:00; off-peak is half of peak.
 *   deepseek-v4-flash 空闲 0.05/1.5/4.5  高峰 0.10/3.0/9.0
 *   deepseek-v4-pro   空闲 0.15/4.5/13.5 高峰 0.30/9.0/27.0
 */
export const DEFAULT_PRICES_CNY: Record<string, TieredModelPrice> = {
  'deepseek-v4-flash': {
    peak: { inputPerM: 3.0, cacheReadPerM: 0.10, outputPerM: 9.0, cacheWritePerM: NO_CACHE_WRITE },
    offPeak: { inputPerM: 1.5, cacheReadPerM: 0.05, outputPerM: 4.5, cacheWritePerM: NO_CACHE_WRITE },
  },
  'deepseek-v4-pro': {
    peak: { inputPerM: 9.0, cacheReadPerM: 0.30, outputPerM: 27.0, cacheWritePerM: NO_CACHE_WRITE },
    offPeak: { inputPerM: 4.5, cacheReadPerM: 0.15, outputPerM: 13.5, cacheWritePerM: NO_CACHE_WRITE },
  },
}

/**
 * Default prices in USD, verified against the official DeepSeek API pricing
 * page (2026-08): flash 空闲 $0.007/$0.22/$0.66 高峰 $0.014/$0.44/$1.32；
 * pro 空闲 $0.022/$0.66/$1.98 高峰 $0.044/$1.32/$3.96。
 */
export const DEFAULT_PRICES_USD: Record<string, TieredModelPrice> = {
  'deepseek-v4-flash': {
    peak: { inputPerM: 0.44, cacheReadPerM: 0.014, outputPerM: 1.32, cacheWritePerM: NO_CACHE_WRITE },
    offPeak: { inputPerM: 0.22, cacheReadPerM: 0.007, outputPerM: 0.66, cacheWritePerM: NO_CACHE_WRITE },
  },
  'deepseek-v4-pro': {
    peak: { inputPerM: 1.32, cacheReadPerM: 0.044, outputPerM: 3.96, cacheWritePerM: NO_CACHE_WRITE },
    offPeak: { inputPerM: 0.66, cacheReadPerM: 0.022, outputPerM: 1.98, cacheWritePerM: NO_CACHE_WRITE },
  },
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

/** New official form: one price per peak/off-peak period. */
const tieredPriceSchema = z.object({
  peak: priceSchema.required(),
  offPeak: priceSchema.required(),
})

/** Accept the tiered form and the legacy flat form; resolution normalizes flat → equal tiers. */
const currencyPriceSchema = z.union([tieredPriceSchema, priceSchema])

// Schemastery object keys are optional only when their schema can tolerate an
// absent value: `z.object` auto-defaults to `{}`, which then fails the
// `.required()` price fields. A `.default(undefined)` (harness idiom for an
// optional nested object) makes the key skipable, so `cny`/`usd` may be
// absent independently — a per-currency price block is optional in yml.
const currencyPricesSchema = z.object({
  cny: currencyPriceSchema.default(undefined as unknown as TieredModelPrice),
  usd: currencyPriceSchema.default(undefined as unknown as TieredModelPrice),
})

/** Schemastery schema doubling as the settings-section shape. */
export const ConfigSchema: z<Config> = z.object({
  currency: z.union([z.const('CNY'), z.const('USD')]).default(DEFAULT_CURRENCY),
  models: z.dict(currencyPricesSchema).default({}),
})

/** True for the tiered {peak, offPeak} shape; a bare ModelPrice is legacy flat. */
export function isTieredPrice(value: ModelPrice | TieredModelPrice | undefined): value is TieredModelPrice {
  return value !== undefined
    && typeof value === 'object'
    && typeof (value as TieredModelPrice).peak === 'object'
    && (value as TieredModelPrice).peak !== null
    && typeof (value as TieredModelPrice).offPeak === 'object'
    && (value as TieredModelPrice).offPeak !== null
}

/** Normalize any config price to the downstream tiered shape: flat = both tiers equal. */
export function normalizeTiered(price: ModelPrice | TieredModelPrice): TieredModelPrice {
  return isTieredPrice(price) ? price : { peak: price, offPeak: price }
}

/** Resolved per-currency price tables: configured entries win, defaults fill the rest. */
export function resolvePriceTables(config: Config | undefined): {
  cny: Record<string, TieredModelPrice>
  usd: Record<string, TieredModelPrice>
} {
  const cny: Record<string, TieredModelPrice> = { ...DEFAULT_PRICES_CNY }
  const usd: Record<string, TieredModelPrice> = { ...DEFAULT_PRICES_USD }
  for (const [id, entry] of Object.entries(config?.models ?? {})) {
    if (entry.cny !== undefined) cny[id] = normalizeTiered(entry.cny)
    if (entry.usd !== undefined) usd[id] = normalizeTiered(entry.usd)
  }
  return { cny, usd }
}

/** Resolve the price table for one display currency. */
export function resolvePriceTable(config: Config | undefined, currency: Currency): Record<string, TieredModelPrice> {
  return resolvePriceTables(config)[currency === 'CNY' ? 'cny' : 'usd']
}

/** Resolve the preferred display currency. */
export function resolveCurrency(config: Config | undefined): Currency {
  return config?.currency ?? DEFAULT_CURRENCY
}