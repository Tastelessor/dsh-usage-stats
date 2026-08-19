/** Per-day aggregation: bucketing, zero-fill, dual-currency amounts, tier-aware billing. */
import { describe, expect, it } from 'vitest'
import { aggregateUsage, localDayKey, windowStartMs, type UsageSample } from '../src/host/aggregate.ts'
import { dayStartMs, weekStartMs, monthStartMs, rangeFromMs, elapsedWeekDays, elapsedMonthDays } from '../src/host/aggregate.ts'
import { tierOf } from '../src/host/prices.ts'
import type { TieredModelPrice } from '../src/shared/types.ts'

const CNY: Record<string, TieredModelPrice> = {
  'deepseek-v4-flash': {
    peak: { inputPerM: 1, cacheReadPerM: 0.1, outputPerM: 2, cacheWritePerM: 0.5 },
    offPeak: { inputPerM: 1, cacheReadPerM: 0.1, outputPerM: 2, cacheWritePerM: 0.5 },
  },
}
const USD: Record<string, TieredModelPrice> = {
  'deepseek-v4-flash': {
    peak: { inputPerM: 0.2, cacheReadPerM: 0.02, outputPerM: 0.4, cacheWritePerM: 0.1 },
    offPeak: { inputPerM: 0.2, cacheReadPerM: 0.02, outputPerM: 0.4, cacheWritePerM: 0.1 },
  },
}

/** Distinct-tier table used by the tier-aware billing test. */
const TIERED_CNY: Record<string, TieredModelPrice> = {
  'deepseek-v4-flash': {
    peak: { inputPerM: 3, cacheReadPerM: 0.3, outputPerM: 6, cacheWritePerM: 0.6 },
    offPeak: { inputPerM: 1, cacheReadPerM: 0.1, outputPerM: 2, cacheWritePerM: 0.2 },
  },
}

const at = (date: string, h = 12): number => new Date(`${date}T${String(h).padStart(2, '0')}:00:00`).getTime()

describe('aggregateUsage', () => {
  it('zero-fills every day of the requested range with null amounts', () => {
    const out = aggregateUsage([], { cny: CNY, usd: USD }, 7, at('2026-08-14'))
    expect(out.buckets).toHaveLength(7)
    expect(out.buckets[6].date).toBe('2026-08-14')
    expect(out.buckets[0].date).toBe('2026-08-08')
    for (const bucket of out.buckets) {
      expect(bucket.tokens.total).toBe(0)
      expect(bucket.amountCny).toBeNull()
      expect(bucket.amountUsd).toBeNull()
    }
    expect(out.totals.amountCny).toBeNull()
    expect(out.totals.amountUsd).toBeNull()
    expect(out.totals.avgDailyTokens).toBe(0)
    expect(out.totals.cacheHitRate).toBe(0)
    expect(out.unpricedModels).toEqual([])
  })

  it('buckets tokens by local day and computes amounts in both currencies', () => {
    const samples: UsageSample[] = [
      { time: at('2026-08-13'), provider: 'deepseek-official', model: 'deepseek-v4-flash',
        usage: { inputTokens: 1_000_000, outputTokens: 500_000 } },
      { time: at('2026-08-14'), provider: 'deepseek-official', model: 'deepseek-v4-flash',
        usage: { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 1_000_000 } },
    ]
    const out = aggregateUsage(samples, { cny: CNY, usd: USD }, 7, at('2026-08-14'))
    expect(out.buckets[5].date).toBe('2026-08-13')
    expect(out.buckets[5].tokens.total).toBe(1_500_000)
    expect(out.buckets[5].amountCny).toBeCloseTo(2)          // 1M/1e6*1 + 500k/1e6*2
    expect(out.buckets[5].amountUsd).toBeCloseTo(0.4)        // 1M/1e6*0.2 + 500k/1e6*0.4
    expect(out.buckets[6].tokens.cacheRead).toBe(1_000_000)
    expect(out.buckets[6].amountCny).toBeCloseTo(1.1)        // 1M/1e6*1 + 1M/1e6*0.1
    expect(out.buckets[6].amountUsd).toBeCloseTo(0.22)
    expect(out.totals.tokens.total).toBe(3_500_000)
    expect(out.totals.amountCny).toBeCloseTo(3.1)
    expect(out.totals.amountUsd).toBeCloseTo(0.62)
    expect(out.unpricedModels).toEqual([])
  })

  it('bills each call at the tier of its own event time (Beijing peak/off-peak)', () => {
    const PEAK = Date.UTC(2026, 7, 13, 1, 0, 0)  // Beijing 09:00 → peak
    const OFF = Date.UTC(2026, 7, 13, 20, 0, 0)  // Beijing 04:00 → off-peak
    expect(tierOf(PEAK)).toBe('peak')
    expect(tierOf(OFF)).toBe('offPeak')
    const samples: UsageSample[] = [
      { time: PEAK, provider: 'deepseek-official', model: 'deepseek-v4-flash',
        usage: { inputTokens: 1_000_000, outputTokens: 500_000 } },
      { time: OFF, provider: 'deepseek-official', model: 'deepseek-v4-flash',
        usage: { inputTokens: 1_000_000, outputTokens: 500_000 } },
    ]
    const out = aggregateUsage(samples, { cny: TIERED_CNY, usd: {} }, 7, Date.UTC(2026, 7, 14, 2, 0, 0))
    const peakBucket = out.buckets.find(b => b.date === localDayKey(PEAK))
    const offBucket = out.buckets.find(b => b.date === localDayKey(OFF))
    expect(peakBucket?.amountCny).toBeCloseTo(6) // 1M/1e6*3 + 500k/1e6*6
    expect(offBucket?.amountCny).toBeCloseTo(2)  // 1M/1e6*1 + 500k/1e6*2
    expect(out.totals.amountCny).toBeCloseTo(8)
  })

  it('computes the average daily tokens and the cache hit rate', () => {
    const samples: UsageSample[] = [
      { time: at('2026-08-13'), provider: 'deepseek-official', model: 'deepseek-v4-flash',
        usage: { inputTokens: 1_000_000, outputTokens: 0 } },
      { time: at('2026-08-14'), provider: 'deepseek-official', model: 'deepseek-v4-flash',
        usage: { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 3_000_000 } },
    ]
    const out = aggregateUsage(samples, { cny: CNY, usd: USD }, 7, at('2026-08-14'))
    expect(out.totals.avgDailyTokens).toBeCloseTo(5_000_000 / 7)
    // hit rate = cacheRead / (input + cacheRead + cacheWrite) = 3M / 5M
    expect(out.totals.cacheHitRate).toBeCloseTo(0.6)
  })

  it('treats a model priced in one currency as not unpriced overall', () => {
    const samples: UsageSample[] = [
      { time: at('2026-08-14'), provider: 'deepseek-official', model: 'deepseek-v4-flash',
        usage: { inputTokens: 1_000_000, outputTokens: 0 } },
    ]
    const out = aggregateUsage(samples, { cny: CNY, usd: {} }, 7, at('2026-08-14'))
    expect(out.unpricedModels).toEqual([])           // priced in CNY
    expect(out.buckets[6].amountCny).toBeCloseTo(1)
    expect(out.buckets[6].amountUsd).toBeNull()      // no USD price
    expect(out.totals.amountUsd).toBeNull()
  })

  it('tracks unpriced models and keeps their tokens out of amounts', () => {
    const samples: UsageSample[] = [
      { time: at('2026-08-14'), provider: 'openai', model: 'gpt-x',
        usage: { inputTokens: 1_000_000, outputTokens: 0 } },
    ]
    const out = aggregateUsage(samples, { cny: CNY, usd: USD }, 7, at('2026-08-14'))
    expect(out.buckets[6].tokens.total).toBe(1_000_000)
    expect(out.buckets[6].amountCny).toBeNull()
    expect(out.buckets[6].amountUsd).toBeNull()
    expect(out.totals.amountCny).toBeNull()
    expect(out.unpricedModels).toEqual([{ provider: 'openai', model: 'gpt-x' }])
  })

  it('drops samples outside the requested range', () => {
    const samples: UsageSample[] = [
      { time: at('2026-08-01'), provider: 'deepseek-official', model: 'deepseek-v4-flash',
        usage: { inputTokens: 1_000_000, outputTokens: 0 } },
    ]
    const out = aggregateUsage(samples, { cny: CNY, usd: USD }, 7, at('2026-08-14'))
    expect(out.buckets.every(b => b.tokens.total === 0)).toBe(true)
  })

  it('formats local day keys with zero padding and windows start at midnight', () => {
    expect(localDayKey(at('2026-08-05'))).toBe('2026-08-05')
    const start = windowStartMs(at('2026-08-14'), 7)
    expect(localDayKey(start)).toBe('2026-08-08')
    expect(new Date(start).getHours()).toBe(0)
  })
})

describe('window start helpers', () => {
  const WED = new Date('2026-08-19T10:30:00').getTime()
  it('normalizes to local midnight', () => {
    const start = dayStartMs(WED)
    expect(new Date(start).getHours()).toBe(0)
    expect(localDayKey(start)).toBe('2026-08-19')
  })
  it('finds the current week Monday (ISO) and the month first day', () => {
    expect(localDayKey(weekStartMs(WED))).toBe('2026-08-17')
    expect(localDayKey(monthStartMs(WED))).toBe('2026-08-01')
  })
  it('range start is the earlier of week Monday and month first day', () => {
    expect(rangeFromMs(WED)).toBe(monthStartMs(WED))
    const NEXT_WED = new Date('2026-09-02T10:30:00').getTime()
    expect(localDayKey(weekStartMs(NEXT_WED))).toBe('2026-08-31') // 跨月
    expect(rangeFromMs(NEXT_WED)).toBe(weekStartMs(NEXT_WED))
  })
  it('counts elapsed days inside the week and the month', () => {
    expect(elapsedWeekDays(WED)).toBe(3)   // 周一..周三
    expect(elapsedMonthDays(WED)).toBe(19)
    expect(elapsedWeekDays(new Date('2026-08-17T08:00:00').getTime())).toBe(1)
    expect(elapsedMonthDays(new Date('2026-08-01T08:00:00').getTime())).toBe(1)
  })
})