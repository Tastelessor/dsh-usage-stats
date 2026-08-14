/**
 * Plugin configuration: a per-model price table keyed by model id plus the
 * display currency (default CNY, USD optional). Defaults cover the official
 * DeepSeek route's catalog (deepseek-v4-flash, deepseek-v4-pro). Price values
 * are per 1M tokens in the selected currency; fill the current official public
 * prices here (verify against the provider's pricing page; README carries the
 * "official prices win" disclaimer).
 */

import z from '@deepseek-ai/schemastery'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import type { Currency, ModelPrice } from '../shared/types.ts'

/** Settings namespace of this plugin. */
export const NS = settingsNamespace('dsh-usage-stats')

/** Default display currency. */
export const DEFAULT_CURRENCY: Currency = 'CNY'

/** Default prices, keyed by the exact ids the official llm-deepseek catalog advertises (CNY per 1M tokens by default). */
export const DEFAULT_PRICES: Record<string, ModelPrice> = {
  // TODO(verify-prices): replace the example numbers below with the current
  // official DeepSeek public prices in the default currency (CNY per 1M
  // tokens) before release; the acceptance test only asserts positivity, so
  // this is a manual step.
  'deepseek-v4-flash': { inputPerM: 0.28, cacheReadPerM: 0.028, outputPerM: 0.42, cacheWritePerM: 0.28 },
  'deepseek-v4-pro': { inputPerM: 0.56, cacheReadPerM: 0.056, outputPerM: 0.84, cacheWritePerM: 0.56 },
}

/** Raw plugin config; every field optional in yml. */
export interface Config {
  /** Display currency for prices and amounts; defaults to CNY. */
  currency?: Currency
  /** Per-model prices; omitted entries fall back to DEFAULT_PRICES. */
  models?: Record<string, ModelPrice>
}

const priceSchema = z.object({
  inputPerM: z.number().min(0).required(),
  cacheReadPerM: z.number().min(0).required(),
  outputPerM: z.number().min(0).required(),
  cacheWritePerM: z.number().min(0).required(),
})

/** Schemastery schema doubling as the settings-section shape. */
export const ConfigSchema: z<Config> = z.object({
  currency: z.union([z.const('CNY'), z.const('USD')]).default(DEFAULT_CURRENCY),
  models: z.dict(priceSchema).default(DEFAULT_PRICES),
})

/** Resolve the effective price table: configured entries win, defaults fill the rest. */
export function resolvePriceTable(config: Config | undefined): Record<string, ModelPrice> {
  return { ...DEFAULT_PRICES, ...(config?.models ?? {}) }
}

/** Resolve the display currency. */
export function resolveCurrency(config: Config | undefined): Currency {
  return config?.currency ?? DEFAULT_CURRENCY
}
