/** Cross-process JSON contract between the host aggregation and the browser page. */

/** Price-table display currency: CNY by default, USD optional. */
export type Currency = 'CNY' | 'USD'

/** Per-million-token price for one model, in the selected currency. */
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
  /** Estimated amount; null when no priced model contributed that day. */
  amount: number | null
}

/** A model seen in usage but absent from the price table. */
export interface UnpricedModel {
  provider: string
  model: string
}

/** One row of the model price table (catalog row joined with prices). */
export interface ModelPriceRow {
  provider: string
  model: string
  name: string
  inputPerM: number | null
  cacheReadPerM: number | null
  outputPerM: number | null
  cacheWritePerM: number | null
  priced: boolean
}

/** The whole page payload served by GET /dsh-usage-stats/stats?days=N. */
export interface StatsResponse {
  days: number
  /** Inclusive window start, epoch ms. */
  from: number
  /** Inclusive window end, epoch ms. */
  to: number
  generatedAt: number
  /** Display currency for every amount in this payload. */
  currency: Currency
  buckets: DayBucket[]
  totals: { tokens: TokenTotals; amount: number | null }
  /** Price table rows for every catalog model. */
  models: ModelPriceRow[]
  /** Models that produced usage but have no price configured. */
  unpricedModels: UnpricedModel[]
}
