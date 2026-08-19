/** Price table resolution: tiered defaults, legacy-flat normalization, tier selection by time. */
import { describe, expect, it } from 'vitest'
import {
  ConfigSchema, DEFAULT_PRICES_CNY, DEFAULT_PRICES_USD, isTieredPrice, normalizeTiered,
  resolveCurrency, resolvePriceTable, resolvePriceTables,
} from '../src/host/config.ts'
import type { ModelPrice, TieredModelPrice } from '../src/shared/types.ts'

const FLAT: ModelPrice = { inputPerM: 0.33, cacheReadPerM: 0.03, outputPerM: 0.5, cacheWritePerM: 0.33 }

const TIERED: TieredModelPrice = {
  peak: { inputPerM: 3, cacheReadPerM: 0.1, outputPerM: 6, cacheWritePerM: 0.5 },
  offPeak: { inputPerM: 1, cacheReadPerM: 0.05, outputPerM: 2, cacheWritePerM: 0.5 },
}

describe('ConfigSchema', () => {
  it('accepts a tiered per-currency entry with cny or usd independently absent', () => {
    // The settings seam validates every write with this schema; the price
    // editor's first save writes the tiered {peak, offPeak} shape.
    const out = ConfigSchema({
      models: {
        'deepseek-v4-flash': { cny: TIERED },
        'other-model': { usd: TIERED },
      },
    })
    const models = out.models ?? {}
    expect(models['deepseek-v4-flash']?.cny).toEqual(TIERED)
    expect(models['deepseek-v4-flash']?.usd).toBeUndefined()
    expect(isTieredPrice(models['other-model']?.usd)).toBe(true)
  })

  it('still accepts the legacy flat form (normalized later at resolution)', () => {
    const out = ConfigSchema({
      models: { 'deepseek-v4-flash': { cny: FLAT } },
    })
    const cny = out.models?.['deepseek-v4-flash']?.cny
    expect(isTieredPrice(cny)).toBe(false)
    expect(normalizeTiered(cny as ModelPrice)).toEqual({ peak: FLAT, offPeak: FLAT })
  })

  it('accepts an empty models dict and defaults the currency', () => {
    const out = ConfigSchema({})
    expect(out.currency).toBe('CNY')
    expect(out.models).toEqual({})
    expect(out.aliases).toEqual({})
  })

  it('round-trips an aliases override', () => {
    const out = ConfigSchema({ aliases: { 'my-alias': 'deepseek-v4-pro' } })
    expect(out.aliases).toEqual({ 'my-alias': 'deepseek-v4-pro' })
  })
})

describe('price defaults', () => {
  it('ships tiered CNY and USD defaults for deepseek-v4-flash and deepseek-v4-pro', () => {
    for (const table of [DEFAULT_PRICES_CNY, DEFAULT_PRICES_USD]) {
      for (const id of ['deepseek-v4-flash', 'deepseek-v4-pro']) {
        const price = table[id]
        expect(price).toBeDefined()
        for (const tier of ['peak', 'offPeak'] as const) {
          expect(tier in price).toBe(true)
          const slot = price[tier]
          for (const key of ['inputPerM', 'cacheReadPerM', 'outputPerM'] as const) {
            expect(slot[key]).toBeGreaterThan(0)
            expect(Number.isFinite(slot[key])).toBe(true)
          }
          // The official v4 pricing has no cache-write bucket.
          expect(slot.cacheWritePerM).toBe(0)
        }
        // Off-peak is officially half of peak.
        expect(price.offPeak.inputPerM).toBeCloseTo(price.peak.inputPerM / 2)
        expect(price.offPeak.outputPerM).toBeCloseTo(price.peak.outputPerM / 2)
      }
    }
  })

  it('keeps the USD defaults strictly below the CNY ones in both tiers', () => {
    for (const id of ['deepseek-v4-flash', 'deepseek-v4-pro']) {
      for (const tier of ['peak', 'offPeak'] as const) {
        expect(DEFAULT_PRICES_USD[id][tier].inputPerM).toBeLessThan(DEFAULT_PRICES_CNY[id][tier].inputPerM)
        expect(DEFAULT_PRICES_USD[id][tier].outputPerM).toBeLessThan(DEFAULT_PRICES_CNY[id][tier].outputPerM)
      }
    }
  })
})

describe('resolvePriceTables', () => {
  it('merges configured per-currency tiered entries over defaults independently', () => {
    const tables = resolvePriceTables({ models: { 'deepseek-v4-flash': { cny: TIERED } } })
    expect(tables.cny['deepseek-v4-flash']).toEqual(TIERED)
    expect(tables.usd['deepseek-v4-flash']).toEqual(DEFAULT_PRICES_USD['deepseek-v4-flash'])
    expect(tables.cny['deepseek-v4-pro']).toEqual(DEFAULT_PRICES_CNY['deepseek-v4-pro'])
  })

  it('normalizes a legacy flat overlay into equal tiers', () => {
    const tables = resolvePriceTables({ models: { 'some-model': { usd: FLAT } } })
    expect(tables.usd['some-model']).toEqual({ peak: FLAT, offPeak: FLAT })
  })

  it('resolvePriceTable picks the requested currency', () => {
    const config = { models: { 'deepseek-v4-flash': { usd: TIERED } } }
    expect(resolvePriceTable(config, 'USD')['deepseek-v4-flash']).toEqual(TIERED)
    expect(resolvePriceTable(config, 'CNY')['deepseek-v4-flash']).toEqual(DEFAULT_PRICES_CNY['deepseek-v4-flash'])
  })

  it('falls back to defaults when config is empty, plus alias entries', () => {
    expect(resolvePriceTables(undefined)).toEqual({
      cny: { ...DEFAULT_PRICES_CNY, 'ark-code-latest': DEFAULT_PRICES_CNY['deepseek-v4-flash'] },
      usd: { ...DEFAULT_PRICES_USD, 'ark-code-latest': DEFAULT_PRICES_USD['deepseek-v4-flash'] },
    })
  })

  it('injects the default ARK alias into both currency tables at the canonical price', () => {
    const tables = resolvePriceTables(undefined)
    expect(tables.cny['ark-code-latest']).toEqual(DEFAULT_PRICES_CNY['deepseek-v4-flash'])
    expect(tables.usd['ark-code-latest']).toEqual(DEFAULT_PRICES_USD['deepseek-v4-flash'])
  })

  it('an explicit config price for the alias wins over the aliased default', () => {
    const tables = resolvePriceTables({ models: { 'ark-code-latest': { cny: TIERED } } })
    expect(tables.cny['ark-code-latest']).toEqual(TIERED)
    expect(tables.cny['deepseek-v4-flash']).toEqual(DEFAULT_PRICES_CNY['deepseek-v4-flash'])
  })

  it('maps custom aliases from config alongside the defaults', () => {
    const tables = resolvePriceTables({ aliases: { 'my-alias': 'deepseek-v4-pro' } })
    expect(tables.cny['my-alias']).toEqual(DEFAULT_PRICES_CNY['deepseek-v4-pro'])
    expect(tables.cny['ark-code-latest']).toEqual(DEFAULT_PRICES_CNY['deepseek-v4-flash'])
  })

  it('defaults the currency to CNY and honors an override', () => {
    expect(resolveCurrency(undefined)).toBe('CNY')
    expect(resolveCurrency({ currency: 'USD' })).toBe('USD')
  })
})

/** Tier selection: Beijing-hour windows, amount formula, reasoning never double-counted. */
import { amountBreakdown, amountOf, amountOfTotals, beijingHour, tierOf } from '../src/host/prices.ts'

/** Epoch ms of a UTC instant with the given Beijing hour (hour 0..23). */
const atBeijingHour = (day: number, hour: number): number =>
  Date.UTC(2026, 7, day, (hour + 16) % 24, 0, 0)

describe('tierOf', () => {
  it('maps the Beijing-hour windows to peak and everything else to off-peak', () => {
    const cases: Array<[hour: number, tier: 'peak' | 'offPeak']> = [
      [0, 'offPeak'], [8, 'offPeak'], [9, 'peak'], [11, 'peak'], [12, 'offPeak'],
      [13, 'offPeak'], [14, 'peak'], [17, 'peak'], [18, 'offPeak'], [23, 'offPeak'],
    ]
    for (const [hour, tier] of cases) {
      expect(beijingHour(atBeijingHour(14, hour))).toBe(hour)
      expect(tierOf(atBeijingHour(14, hour))).toBe(tier)
    }
  })

  it('derives the Beijing hour from UTC regardless of the host timezone', () => {
    // 2026-08-14T01:00:00Z is 09:00 in Beijing, whatever the runner's TZ is.
    expect(beijingHour(Date.UTC(2026, 7, 14, 1, 0, 0))).toBe(9)
    expect(tierOf(Date.UTC(2026, 7, 14, 1, 0, 0))).toBe('peak')
    expect(tierOf(Date.UTC(2026, 7, 14, 9, 59, 0))).toBe('peak')   // 17:59 Beijing ∈ 14:00–18:00
    expect(tierOf(Date.UTC(2026, 7, 14, 10, 0, 1))).toBe('offPeak') // 18:00:01 Beijing — outside
  })
})

describe('amountBreakdown', () => {
  const PEAK = Date.UTC(2026, 7, 14, 1, 30, 0) // Beijing 09:30
  const OFF = Date.UTC(2026, 7, 14, 20, 30, 0) // Beijing 04:30

  it('bills the peak tier during Beijing peak hours and the off-peak tier otherwise', () => {
    const peak = amountBreakdown(
      { inputTokens: 500_000, outputTokens: 200_000, cacheReadTokens: 1_000_000, cacheWriteTokens: 100_000 },
      TIERED, PEAK,
    )
    // 500k/1e6*3 + 1M/1e6*0.1 + 200k/1e6*6 + 100k/1e6*0.5
    expect(peak.input).toBeCloseTo(1.5)
    expect(peak.cacheRead).toBeCloseTo(0.1)
    expect(peak.output).toBeCloseTo(1.2)
    expect(peak.cacheWrite).toBeCloseTo(0.05)
    expect(peak.total).toBeCloseTo(2.85)

    const off = amountBreakdown(
      { inputTokens: 500_000, outputTokens: 200_000, cacheReadTokens: 1_000_000, cacheWriteTokens: 100_000 },
      TIERED, OFF,
    )
    expect(off.total).toBeCloseTo(1.0) // 0.5 + 0.05 + 0.4 + 0.05
    expect(off.total).toBeLessThan(peak.total)
  })

  it('does not add reasoningTokens on top of outputTokens', () => {
    const withReasoning = amountOf({ inputTokens: 0, outputTokens: 100_000, reasoningTokens: 100_000 }, TIERED, OFF)
    const without = amountOf({ inputTokens: 0, outputTokens: 100_000 }, TIERED, OFF)
    expect(withReasoning).toBeCloseTo(without) // reasoning ⊆ output
  })

  it('treats absent cache buckets as zero', () => {
    expect(amountOf({ inputTokens: 0, outputTokens: 0 }, TIERED, OFF)).toBe(0)
  })

  it('two equal tiers behave like the legacy flat price at any hour', () => {
    const flat = normalizeTiered(FLAT)
    for (const ms of [PEAK, OFF]) {
      expect(amountOf({ inputTokens: 1_000_000, outputTokens: 0 }, flat, ms)).toBeCloseTo(0.33)
    }
  })
})

describe('amountOfTotals', () => {
  const PRICE: ModelPrice = { inputPerM: 1, cacheReadPerM: 0.1, outputPerM: 2, cacheWritePerM: 0.5 }
  it('computes an amount from aggregated totals, no per-event tier logic', () => {
    const tokens = { input: 1_000_000, output: 500_000, cacheRead: 2_000_000, cacheWrite: 1_000_000, reasoning: 0, total: 4_500_000 }
    expect(amountOfTotals(tokens, PRICE)).toBeCloseTo(1 + 1 + 0.2 + 0.5) // input 1M*1 + cacheRead 2M*0.1 + cacheWrite 1M*0.5 + output 500k*2
  })
  it('ignores reasoning tokens (a subset of output)', () => {
    const tokens = { input: 0, output: 1_000_000, cacheRead: 0, cacheWrite: 0, reasoning: 900_000, total: 1_000_000 }
    expect(amountOfTotals(tokens, PRICE)).toBeCloseTo(2)
  })
})