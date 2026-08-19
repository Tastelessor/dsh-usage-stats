/**
 * Pure per-day aggregation: buckets token counts and estimated amounts (CNY
 * and USD independently) by local calendar date, zero-filling the requested
 * range. No dsh imports — the sessionQuery adapter (Task 6) feeds
 * UsageSample values.
 */

import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import type { DayBucket, StatsTotals, TieredModelPrice, TokenTotals, UnpricedModel } from '../shared/types.ts'
import { amountBreakdown } from './prices.ts'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionIndexEntry } from './indexer.ts'
import type { WindowPeriod, WindowSummary } from '../shared/types.ts'
import { amountOfTotals } from './prices.ts'

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

/** Local midnight of an instant. */
export function dayStartMs(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** Local midnight of the current ISO week's Monday (Mon=0). */
export function weekStartMs(now: number): number {
  const d = new Date(dayStartMs(now))
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return d.getTime()
}

/** Local midnight of the first day of the current month. */
export function monthStartMs(now: number): number {
  const d = new Date(dayStartMs(now))
  d.setDate(1)
  return d.getTime()
}

/** Inclusive range start for the whole page: min(week Monday, month 1st). */
export function rangeFromMs(now: number): number {
  return Math.min(weekStartMs(now), monthStartMs(now))
}

/** Days elapsed inside the current ISO week (Mon..today), 1..7. */
export function elapsedWeekDays(now: number): number {
  return ((new Date(now).getDay() + 6) % 7) + 1
}

/** Days elapsed inside the current month (1st..today), 1..31. */
export function elapsedMonthDays(now: number): number {
  return new Date(now).getDate()
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

/** v2 aggregation result: day buckets over [from..to] plus three window summaries. */
export interface AggregationV2 {
  buckets: DayBucket[]
  windows: Record<WindowPeriod, WindowSummary>
  unpricedModels: UnpricedModel[]
}

/** Split a provider\u0000model composite key back into its parts. */
function splitModelKey(key: string): { provider: string; model: string } {
  const sep = key.indexOf('\u0000')
  return sep >= 0 ? { provider: key.slice(0, sep), model: key.slice(sep + 1) } : { provider: 'unknown', model: key }
}

function addTotalsInto(target: TokenTotals, source: TokenTotals): void {
  target.input += source.input
  target.output += source.output
  target.cacheRead += source.cacheRead
  target.cacheWrite += source.cacheWrite
  target.reasoning += source.reasoning
  target.total += source.total
}

/** Sum buckets whose date is >= fromKey (bucket list is date-ascending). */
function sumFrom(buckets: readonly DayBucket[], fromKey: string, elapsedDays: number): WindowSummary {
  const tokens = EMPTY_TOTALS()
  let amountCny: number | null = 0
  let amountUsd: number | null = 0
  let cnySeen = false
  let usdSeen = false
  for (const bucket of buckets) {
    if (bucket.date < fromKey) continue
    addTotalsInto(tokens, bucket.tokens)
    if (bucket.amountCny !== null) { amountCny += bucket.amountCny; cnySeen = true }
    if (bucket.amountUsd !== null) { amountUsd += bucket.amountUsd; usdSeen = true }
  }
  const promptInput = tokens.input + tokens.cacheRead + tokens.cacheWrite
  return {
    tokens,
    amountCny: cnySeen ? amountCny : null,
    amountUsd: usdSeen ? amountUsd : null,
    cacheHitRate: promptInput > 0 ? tokens.cacheRead / promptInput : 0,
    avgDailyTokens: tokens.total / Math.max(1, elapsedDays),
  }
}

/**
 * Aggregate pre-folded index entries into [from..to] day buckets and the
 * today/week/month window summaries. Amounts are recomputed from the current
 * price tables at query time, so price edits never require an index rebuild.
 */
export function aggregateEntries(
  entries: ReadonlyMap<SessionId, SessionIndexEntry>,
  prices: PriceTables,
  fromMs: number,
  toMs: number,
  now: number,
): AggregationV2 {
  // Zero-filled day keys, from..to inclusive.
  const dateKeys: string[] = []
  const end = new Date(toMs)
  end.setHours(0, 0, 0, 0)
  for (let d = new Date(fromMs); d.getTime() <= end.getTime(); d.setDate(d.getDate() + 1)) {
    dateKeys.push(localDayKey(d.getTime()))
  }
  const indexByDate = new Map(dateKeys.map((date, index) => [date, index]))
  const buckets: DayBucket[] = dateKeys.map(date => ({ date, tokens: EMPTY_TOTALS(), amountCny: null, amountUsd: null }))
  const unpriced = new Map<string, UnpricedModel>()

  for (const entry of entries.values()) {
    for (const [date, cell] of entry.days) {
      const bucketIndex = indexByDate.get(date)
      if (bucketIndex === undefined) continue
      const bucket = buckets[bucketIndex]!
      for (const tier of ['peak', 'offPeak'] as const) {
        for (const [key, totals] of cell[tier]) {
          addTotalsInto(bucket.tokens, totals)
          const { provider, model } = splitModelKey(key)
          const cnyPrice = prices.cny[model]
          const usdPrice = prices.usd[model]
          if (cnyPrice !== undefined) {
            bucket.amountCny = (bucket.amountCny ?? 0) + amountOfTotals(totals, cnyPrice[tier])
          }
          if (usdPrice !== undefined) {
            bucket.amountUsd = (bucket.amountUsd ?? 0) + amountOfTotals(totals, usdPrice[tier])
          }
          if (cnyPrice === undefined && usdPrice === undefined) {
            unpriced.set(key, { provider, model })
          }
        }
      }
    }
  }

  const todayKey = localDayKey(toMs)
  return {
    buckets,
    windows: {
      today: sumFrom(buckets, todayKey, 1),
      week: sumFrom(buckets, localDayKey(weekStartMs(now)), elapsedWeekDays(now)),
      month: sumFrom(buckets, localDayKey(monthStartMs(now)), elapsedMonthDays(now)),
    },
    unpricedModels: [...unpriced.values()],
  }
}
