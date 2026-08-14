/** Per-day aggregation: bucketing, zero-fill, dual-currency amounts, metrics. */
import { describe, expect, it } from 'vitest'
import { aggregateUsage, localDayKey, windowStartMs, type UsageSample } from '../src/host/aggregate.ts'
import type { ModelPrice } from '../src/shared/types.ts'

const CNY: Record<string, ModelPrice> = {
  'deepseek-v4-flash': { inputPerM: 1, cacheReadPerM: 0.1, outputPerM: 2, cacheWritePerM: 0.5 },
}
const USD: Record<string, ModelPrice> = {
  'deepseek-v4-flash': { inputPerM: 0.2, cacheReadPerM: 0.02, outputPerM: 0.4, cacheWritePerM: 0.1 },
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
