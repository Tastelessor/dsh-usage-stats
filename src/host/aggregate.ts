/**
 * Pure per-day aggregation: buckets token counts and estimated amounts (CNY
 * and USD independently) by local calendar date, zero-filling the requested
 * range. No dsh imports — the sessionQuery adapter (Task 6) feeds
 * UsageSample values.
 */

import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import type { DayBucket, StatsTotals, TieredModelPrice, TokenTotals, UnpricedModel } from '../shared/types.ts'
import { amountBreakdown } from './prices.ts'

/** One model call's usage facts extracted from a session event. */
export interface UsageSample {
  /** Event time, Unix epoch ms. */
  time: number
  provider: string
  model: string
  usage: TokenUsage
}

/** Aggregation result (the page payload minus the catalog join). */
export interface Aggregation {
  buckets: DayBucket[]
  totals: StatsTotals
  unpricedModels: UnpricedModel[]
}

/** Both currency price tables; a model missing from one only contributes to the other's amounts. */
export interface PriceTables {
  cny: Readonly<Record<string, TieredModelPrice>>
  usd: Readonly<Record<string, TieredModelPrice>>
}

const EMPTY_TOTALS = (): TokenTotals => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, total: 0 })

/** Local calendar date key, 'YYYY-MM-DD'. */
export function localDayKey(ms: number): string {
  const d = new Date(ms)
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${month}-${day}`
}

/**
 * Midnight (local) of the first bucket day: the inclusive start of the
 * `days`-long window ending today. Calendar-date walking avoids DST drift.
 */
export function windowStartMs(now: number, days: number): number {
  const cursor = new Date(now)
  cursor.setHours(0, 0, 0, 0)
  for (let i = 1; i < days; i++) cursor.setDate(cursor.getDate() - 1)
  return cursor.getTime()
}

/**
 * Aggregate samples into one zero-filled bucket per day.
 * @param samples - in-window model calls.
 * @param prices - per-currency model id → price; unpriced models count tokens but not amounts.
 * @param days - range length (7 / 15 / 30).
 * @param now - reference instant (defaults to Date.now()).
 */
export function aggregateUsage(
  samples: readonly UsageSample[],
  prices: PriceTables,
  days: number,
  now: number = Date.now(),
): Aggregation {
  const dateKeys: string[] = []
  const cursor = new Date(windowStartMs(now, days))
  for (let i = 0; i < days; i++) {
    dateKeys.push(localDayKey(cursor.getTime()))
    cursor.setDate(cursor.getDate() + 1)
  }
  const indexByDate = new Map(dateKeys.map((date, index) => [date, index]))

  const buckets: DayBucket[] = dateKeys.map(date => ({ date, tokens: EMPTY_TOTALS(), amountCny: null, amountUsd: null }))
  const totals: StatsTotals = { tokens: EMPTY_TOTALS(), amountCny: null, amountUsd: null, avgDailyTokens: 0, cacheHitRate: 0 }
  const unpriced = new Map<string, UnpricedModel>()
  let cnyPriced = 0
  let usdPriced = 0

  for (const sample of samples) {
    const index = indexByDate.get(localDayKey(sample.time))
    if (index === undefined) continue // outside the requested range
    const usage = sample.usage
    const bucket = buckets[index]
    const t = bucket.tokens
    t.input += usage.inputTokens
    t.output += usage.outputTokens
    t.cacheRead += usage.cacheReadTokens ?? 0
    t.cacheWrite += usage.cacheWriteTokens ?? 0
    t.reasoning += usage.reasoningTokens ?? 0
    t.total += usage.inputTokens + usage.outputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)

    const cnyPrice = prices.cny[sample.model]
    if (cnyPrice !== undefined) {
      const amount = amountBreakdown(usage, cnyPrice, sample.time).total
      bucket.amountCny = (bucket.amountCny ?? 0) + amount
      totals.amountCny = (totals.amountCny ?? 0) + amount
      cnyPriced += 1
    }
    const usdPrice = prices.usd[sample.model]
    if (usdPrice !== undefined) {
      const amount = amountBreakdown(usage, usdPrice, sample.time).total
      bucket.amountUsd = (bucket.amountUsd ?? 0) + amount
      totals.amountUsd = (totals.amountUsd ?? 0) + amount
      usdPriced += 1
    }
    if (cnyPrice === undefined && usdPrice === undefined) {
      unpriced.set(`${sample.provider}\u0000${sample.model}`, { provider: sample.provider, model: sample.model })
    }

    const tot = totals.tokens
    tot.input += usage.inputTokens
    tot.output += usage.outputTokens
    tot.cacheRead += usage.cacheReadTokens ?? 0
    tot.cacheWrite += usage.cacheWriteTokens ?? 0
    tot.reasoning += usage.reasoningTokens ?? 0
    tot.total += usage.inputTokens + usage.outputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
  }

  const tt = totals.tokens
  const promptInput = tt.input + tt.cacheRead + tt.cacheWrite
  totals.avgDailyTokens = tt.total / days
  totals.cacheHitRate = promptInput > 0 ? tt.cacheRead / promptInput : 0
  if (cnyPriced === 0) totals.amountCny = null
  if (usdPriced === 0) totals.amountUsd = null

  return {
    buckets,
    totals,
    unpricedModels: [...unpriced.values()],
  }
}
