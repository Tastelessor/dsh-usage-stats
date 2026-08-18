/** Cross-process JSON contract between the host aggregation and the browser page. */

/** Settings-namespace name of this plugin (host applies the settingsNamespace brand). */
export const SETTINGS_NAMESPACE = 'dsh-token-usage' as const

/** Price-table display currency: CNY by default, USD optional. */
export type Currency = 'CNY' | 'USD'

/** Which official rate schedule applies to one at-time usage event. */
export type Tier = 'peak' | 'offPeak'

/** Per-million-token price for one tier (one model, one currency, one period). */
export interface ModelPrice {
  /** Uncached input, per 1M tokens. */
  inputPerM: number
  /** Cache-hit input, per 1M tokens. */
  cacheReadPerM: number
  /** Output, per 1M tokens. */
  outputPerM: number
  /** Cache-write input, per 1M tokens (amounts only; not displayed). */
  cacheWritePerM: number
}

/**
 * Peak/off-peak price schedule. Legacy flat configs (a bare ModelPrice) are
 * normalized to both tiers equal at resolution time, so downstream code only
 * ever sees this shape.
 */
export interface TieredModelPrice {
  peak: ModelPrice
  offPeak: ModelPrice
}

/** Token counts per bucket for one day or the whole range. */
export interface TokenTotals {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  reasoning: number
  total: number
}

/** One day of the requested range, zero-filled. */
export interface DayBucket {
  /** Local calendar date, 'YYYY-MM-DD'. */
  date: string
  tokens: TokenTotals
  /** Estimated amount in CNY; null when no CNY-priced model contributed that day. */
  amountCny: number | null
  /** Estimated amount in USD; null when no USD-priced model contributed that day. */
  amountUsd: number | null
}

/** Whole-range totals plus derived summary metrics. */
export interface StatsTotals {
  tokens: TokenTotals
  /** Estimated amount in CNY; null when no CNY-priced model produced usage in the range. */
  amountCny: number | null
  /** Estimated amount in USD; null when no USD-priced model produced usage in the range. */
  amountUsd: number | null
  /** tokens.total / days — the average daily token volume. */
  avgDailyTokens: number
  /** cacheRead / (input + cacheRead + cacheWrite) over the range; 0 when there is no prompt input. */
  cacheHitRate: number
}

/** A model seen in usage but absent from both currency price tables. */
export interface UnpricedModel {
  provider: string
  model: string
}

/** One row of the model price table: catalog row joined with both currencies' prices. */
export interface ModelPriceRow {
  provider: string
  model: string
  name: string
  /** Price in CNY, or null when not configured. */
  cny: TieredModelPrice | null
  /** Price in USD, or null when not configured. */
  usd: TieredModelPrice | null
}

/** Settings-section shape written back by the price editor (shared with the host config). */
export interface ModelPricesByCurrency {
  /** Flat (legacy) and tiered configs both resolve; the editor always writes tiered. */
  cny?: ModelPrice | TieredModelPrice
  usd?: ModelPrice | TieredModelPrice
}

/** The whole page payload served by GET /dsh-token-usage/stats?days=N. */
export interface StatsResponse {
  days: number
  /** Inclusive window start, epoch ms. */
  from: number
  /** Inclusive window end, epoch ms. */
  to: number
  generatedAt: number
  /** Preferred display currency (seeds the price-table toggle). */
  currency: Currency
  buckets: DayBucket[]
  totals: StatsTotals
  /** Price table rows for every catalog model. */
  models: ModelPriceRow[]
  /** Models that produced usage but have no price configured in either currency. */
  unpricedModels: UnpricedModel[]
}
