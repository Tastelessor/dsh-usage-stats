/** Per-day aggregation: bucketing, zero-fill, dual-currency amounts, tier-aware billing. */
import { describe, expect, it } from 'vitest'
import { aggregateEntries, localDayKey, type UsageSample } from '../src/host/aggregate.ts'
import { dayStartMs, weekStartMs, monthStartMs, rangeFromMs, elapsedWeekDays, elapsedMonthDays } from '../src/host/aggregate.ts'
import { foldSamples, type SessionIndexEntry } from '../src/host/indexer.ts'
import type { SessionId } from '@deepseek-ai/dsh-session'
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
  it('range start covers the last 3 calendar months (min with week Monday)', () => {
    expect(localDayKey(rangeFromMs(WED))).toBe('2026-06-01')      // 08-19 → 06-01
    const NEXT_WED = new Date('2026-09-02T10:30:00').getTime()
    expect(localDayKey(weekStartMs(NEXT_WED))).toBe('2026-08-31') // 跨月
    expect(localDayKey(rangeFromMs(NEXT_WED))).toBe('2026-07-01') // 3 个月前 07-01 早于周一
    const JAN = new Date('2026-01-15T10:00:00').getTime()
    expect(localDayKey(rangeFromMs(JAN))).toBe('2025-11-01')      // 跨年
  })
  it('counts elapsed days inside the week and the month', () => {
    expect(elapsedWeekDays(WED)).toBe(3)   // 周一..周三
    expect(elapsedMonthDays(WED)).toBe(19)
    expect(elapsedWeekDays(new Date('2026-08-17T08:00:00').getTime())).toBe(1)
    expect(elapsedMonthDays(new Date('2026-08-01T08:00:00').getTime())).toBe(1)
  })
})

const entryOf = (samples: Parameters<typeof foldSamples>[1], mtimeMs?: number): SessionIndexEntry =>
  foldSamples({ mtimeMs, days: new Map() }, samples)

describe('aggregateEntries', () => {
  const NOW = new Date('2026-08-19T10:00:00').getTime()   // 周三
  const FROM = rangeFromMs(NOW)                            // 3 个月前首日 2026-06-01

  function aggregate(samples: UsageSample[], prices: { cny: typeof CNY; usd: typeof USD } = { cny: CNY, usd: USD }) {
    const entries = new Map<SessionId, SessionIndexEntry>()
    if (samples.length > 0) entries.set('s-1' as SessionId, entryOf(samples))
    return aggregateEntries(entries, prices, FROM, NOW, NOW)
  }

  it('zero-fills every day from range start to today', () => {
    const out = aggregate([])
    expect(out.buckets[0].date).toBe('2026-06-01')
    expect(out.buckets).toHaveLength(80) // 06-01..08-19
    expect(out.buckets[79].date).toBe('2026-08-19')
    expect(out.buckets.every(b => b.tokens.total === 0)).toBe(true)
  })

  it('aggregates tier-split cells into day buckets and windows', () => {
    const PEAK = Date.UTC(2026, 7, 18, 1, 30, 0)   // 08-18 高峰
    const OFF = Date.UTC(2026, 7, 18, 20, 0, 0)    // 08-19 空闲
    const samples: UsageSample[] = [
      { time: PEAK, provider: 'deepseek-official', model: 'deepseek-v4-flash', usage: { inputTokens: 1_000_000, outputTokens: 500_000 } },
      { time: OFF, provider: 'deepseek-official', model: 'deepseek-v4-flash', usage: { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 3_000_000 } },
    ]
    const out = aggregate(samples, { cny: TIERED_CNY, usd: {} })
    const day18 = out.buckets.find(b => b.date === '2026-08-18')!
    expect(day18.tokens.total).toBe(1_500_000)
    expect(day18.amountCny).toBeCloseTo(6) // 高峰: 1M*3 + 500k*6
    const day19 = out.buckets.find(b => b.date === '2026-08-19')!
    expect(day19.tokens.cacheRead).toBe(3_000_000)
    expect(day19.amountCny).toBeCloseTo(1.3) // 空闲: 1M*1 + 3M*0.1
    // 窗口：today=08-19（4M）；week=08-17..19（5.5M，elapsed=3）；month=08-01..19（5.5M，elapsed=19）
    expect(out.windows.today.tokens.total).toBe(4_000_000)
    expect(out.windows.today.avgDailyTokens).toBe(4_000_000)
    expect(out.windows.week.tokens.total).toBe(5_500_000)
    expect(out.windows.week.avgDailyTokens).toBeCloseTo(5_500_000 / 3)
    expect(out.windows.month.tokens.total).toBe(5_500_000)
    expect(out.windows.month.avgDailyTokens).toBeCloseTo(5_500_000 / 19)
    expect(out.windows.today.cacheHitRate).toBeCloseTo(3_000_000 / 4_000_000)
    expect(out.unpricedModels).toEqual([])
  })

  it('handles a week crossing the month boundary', () => {
    const NOW2 = new Date('2026-09-02T10:00:00').getTime()   // 周三，周一=08-31 跨月
    const out = aggregateEntries(new Map(), { cny: CNY, usd: {} }, rangeFromMs(NOW2), NOW2, NOW2)
    expect(out.buckets[0].date).toBe('2026-07-01')
    expect(out.buckets).toHaveLength(64) // 07-01..09-02
    expect(out.windows.week.avgDailyTokens).toBe(0 / 3)   // elapsed=3
    expect(out.windows.month.avgDailyTokens).toBe(0 / 2)  // elapsed=2
  })

  it('tracks unpriced models and leaves their amounts null', () => {
    const out = aggregate([
      { time: Date.UTC(2026, 7, 19, 1, 0, 0), provider: 'openai', model: 'gpt-x', usage: { inputTokens: 1_000_000, outputTokens: 0 } },
    ])
    expect(out.unpricedModels).toEqual([{ provider: 'openai', model: 'gpt-x' }])
    expect(out.buckets[79].amountCny).toBeNull()
    expect(out.windows.today.amountCny).toBeNull()
  })

  it('treats a model priced in one currency as not unpriced', () => {
    const out = aggregate([
      { time: Date.UTC(2026, 7, 19, 1, 0, 0), provider: 'deepseek-official', model: 'deepseek-v4-flash', usage: { inputTokens: 1_000_000, outputTokens: 0 } },
    ], { cny: CNY, usd: {} })
    expect(out.unpricedModels).toEqual([])
    expect(out.windows.today.amountCny).toBeCloseTo(1)
    expect(out.windows.today.amountUsd).toBeNull()
  })

  it('prices usage under a harness alias id once the resolved tables carry the alias', () => {
    // resolvePriceTables injects `ark-code-latest` → canonical deepseek-v4-flash
    const tables = {
      cny: { ...CNY, 'ark-code-latest': CNY['deepseek-v4-flash'] },
      usd: {},
    }
    const out = aggregate([
      { time: Date.UTC(2026, 7, 19, 1, 0, 0), provider: 'deepseek-official', model: 'ark-code-latest', usage: { inputTokens: 1_000_000, outputTokens: 0 } },
    ], tables)
    expect(out.unpricedModels).toEqual([])          // 不再当作未配置模型
    expect(out.buckets[79].amountCny).toBeCloseTo(1)
    expect(out.windows.today.amountCny).toBeCloseTo(1)
  })

  it('drops entries outside the requested range', () => {
    const out = aggregate([
      { time: new Date('2026-05-01T12:00:00').getTime(), provider: 'deepseek-official', model: 'deepseek-v4-flash', usage: { inputTokens: 5_000_000, outputTokens: 0 } },
    ])
    expect(out.buckets.every(b => b.tokens.total === 0)).toBe(true)
  })
})