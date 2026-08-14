/**
 * Pure per-day aggregation: buckets token counts and estimated amounts by
 * local calendar date, zero-filling the requested range. No dsh imports —
 * the sessionQuery adapter (Task 6) feeds UsageSample values.
 */

import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import type { DayBucket, ModelPrice, TokenTotals, UnpricedModel } from '../shared/types.ts'
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
  totals: { tokens: TokenTotals; amount: number | null }
  unpricedModels: UnpricedModel[]
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
 * Aggregate samples into one zero-filled bucket per day.
 * @param samples - in-window model calls.
 * @param prices - model id → price; unpriced models count tokens but not amounts.
 * @param days - range length (7 / 15 / 30).
 * @param now - reference instant (defaults to Date.now()).
 */
export function aggregateUsage(
  samples: readonly UsageSample[],
  prices: Readonly<Record<string, ModelPrice>>,
  days: number,
  now: number = Date.now(),
): Aggregation {
  // Build the day list ending today (walking calendar dates avoids DST drift).
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  const dateKeys: string[] = []
  const cursor = new Date(today)
  for (let i = 0; i < days; i++) {
    dateKeys.push(localDayKey(cursor.getTime()))
    cursor.setDate(cursor.getDate() - 1)
  }
  dateKeys.reverse()
  const indexByDate = new Map(dateKeys.map((date, index) => [date, index]))

  const buckets: DayBucket[] = dateKeys.map(date => ({ date, tokens: EMPTY_TOTALS(), amount: null }))
  const totals = { tokens: EMPTY_TOTALS(), amount: 0 }
  const unpriced = new Map<string, UnpricedModel>()
  let pricedCount = 0

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

    const price = prices[sample.model]
    if (price !== undefined) {
      const amount = amountBreakdown(usage, price)
      bucket.amount = (bucket.amount ?? 0) + amount.total
      totals.amount += amount.total
      pricedCount += 1
    } else {
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

  for (const bucket of buckets) {
    if (bucket.amount === null || !(bucket.tokens.total > 0)) continue
    bucket.amount = bucket.amount // amount already carries only priced contributions
  }

  return {
    buckets,
    totals: {
      tokens: totals.tokens,
      amount: pricedCount > 0 ? totals.amount : null,
    },
    unpricedModels: [...unpriced.values()],
  }
}
