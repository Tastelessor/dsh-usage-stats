/** Per-day aggregation: bucketing, zero-fill, unpriced tracking, empty state. */
import { describe, expect, it } from 'vitest'
import { aggregateUsage, localDayKey, type UsageSample } from '../src/host/aggregate.ts'
import type { ModelPrice } from '../src/shared/types.ts'

const PRICES: Record<string, ModelPrice> = {
  'deepseek-v4-flash': { inputPerM: 1, cacheReadPerM: 0.1, outputPerM: 2, cacheWritePerM: 0.5 },
}

const at = (date: string, h = 12): number => new Date(`${date}T${String(h).padStart(2, '0')}:00:00`).getTime()

describe('aggregateUsage', () => {
  it('zero-fills every day of the requested range', () => {
    const out = aggregateUsage([], PRICES, 7, at('2026-08-14'))
    expect(out.buckets).toHaveLength(7)
    expect(out.buckets[6].date).toBe('2026-08-14')
    expect(out.buckets[0].date).toBe('2026-08-08')
    for (const bucket of out.buckets) {
      expect(bucket.tokens.total).toBe(0)
      expect(bucket.amount).toBeNull()
    }
    expect(out.totals.amount).toBeNull()
    expect(out.unpricedModels).toEqual([])
  })

  it('buckets tokens by local day and computes priced amounts', () => {
    const samples: UsageSample[] = [
      { time: at('2026-08-13'), provider: 'deepseek-official', model: 'deepseek-v4-flash',
        usage: { inputTokens: 1_000_000, outputTokens: 500_000 } },
      { time: at('2026-08-14'), provider: 'deepseek-official', model: 'deepseek-v4-flash',
        usage: { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 1_000_000 } },
    ]
    const out = aggregateUsage(samples, PRICES, 7, at('2026-08-14'))
    expect(out.buckets[5].date).toBe('2026-08-13')
    expect(out.buckets[5].tokens.total).toBe(1_500_000)
    expect(out.buckets[5].amount).toBeCloseTo(2)          // 1M/1e6*1 + 500k/1e6*2
    expect(out.buckets[6].tokens.cacheRead).toBe(1_000_000)
    expect(out.buckets[6].amount).toBeCloseTo(1.1)        // 1M/1e6*1 + 1M/1e6*0.1
    expect(out.totals.tokens.total).toBe(3_500_000)
    expect(out.totals.amount).toBeCloseTo(3.1)
    expect(out.unpricedModels).toEqual([])
  })

  it('tracks unpriced models and keeps their tokens out of amounts', () => {
    const samples: UsageSample[] = [
      { time: at('2026-08-14'), provider: 'openai', model: 'gpt-x',
        usage: { inputTokens: 1_000_000, outputTokens: 0 } },
    ]
    const out = aggregateUsage(samples, PRICES, 7, at('2026-08-14'))
    expect(out.buckets[6].tokens.total).toBe(1_000_000)
    expect(out.buckets[6].amount).toBeNull()
    expect(out.totals.amount).toBeNull()
    expect(out.unpricedModels).toEqual([{ provider: 'openai', model: 'gpt-x' }])
  })

  it('drops samples outside the requested range', () => {
    const samples: UsageSample[] = [
      { time: at('2026-08-01'), provider: 'deepseek-official', model: 'deepseek-v4-flash',
        usage: { inputTokens: 1_000_000, outputTokens: 0 } },
    ]
    const out = aggregateUsage(samples, PRICES, 7, at('2026-08-14'))
    expect(out.buckets.every(b => b.tokens.total === 0)).toBe(true)
  })

  it('formats local day keys with zero padding', () => {
    expect(localDayKey(at('2026-08-05'))).toBe('2026-08-05')
  })
})
