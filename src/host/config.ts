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
 * catalog advertises (CNY per 1M tokens). Verified against the official
 * DeepSeek API pricing page (api-docs.deepseek.com, fetched 2026-08-14):
 * deepseek-v4-flash 缓存命中 0.02 / 未命中 1 / 输出 2；deepseek-v4-pro
 * 缓存命中 0.025 / 未命中 3 / 输出 6。
 * NOTE: DeepSeek 将于 2026-08-17 00:00（北京时间）切换峰谷定价（高峰时段为
 * 北京时间 9:00–12:00、14:00–18:00，空闲时段为高峰的一半）；下表为切换前的
 * 现行平价。cacheWritePerM 无官方价格（DeepSeek 只按缓存命中/未命中与输出计费，
 * 无缓存写入桶），仅作占位，DeepSeek 用量不会产生 cacheWriteTokens。
 */
export const DEFAULT_PRICES_CNY: Record<string, ModelPrice> = {
  'deepseek-v4-flash': { inputPerM: 1, cacheReadPerM: 0.02, outputPerM: 2, cacheWritePerM: 0.28 },
  'deepseek-v4-pro': { inputPerM: 3, cacheReadPerM: 0.025, outputPerM: 6, cacheWritePerM: 0.56 },
}

/**
 * Default prices in USD, verified against the official DeepSeek API pricing
 * page (2026-08): deepseek-v4-flash $0.14 / $0.0028 / $0.28；
 * deepseek-v4-pro $0.435 / $0.003625 / $0.87。峰谷价切换说明同 CNY 表。
 */
export const DEFAULT_PRICES_USD: Record<string, ModelPrice> = {
  'deepseek-v4-flash': { inputPerM: 0.14, cacheReadPerM: 0.0028, outputPerM: 0.28, cacheWritePerM: 0.039 },
  'deepseek-v4-pro': { inputPerM: 0.435, cacheReadPerM: 0.003625, outputPerM: 0.87, cacheWritePerM: 0.078 },
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

// Schemastery object keys are optional only when their schema can tolerate an
// absent value: `z.object` auto-defaults to `{}`, which then fails the
// `.required()` price fields. A `.default(undefined)` (harness idiom for an
// optional nested object) makes the key skipable, so `cny`/`usd` may be
// absent independently — a per-currency price block is optional in yml.
const currencyPricesSchema = z.object({
  cny: priceSchema.default(undefined as unknown as ModelPrice),
  usd: priceSchema.default(undefined as unknown as ModelPrice),
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
