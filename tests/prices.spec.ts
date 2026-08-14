/** Price table resolution: defaults exist and configured entries win. */
import { describe, expect, it } from 'vitest'
import { DEFAULT_PRICES, resolveCurrency, resolvePriceTable } from '../src/host/config.ts'

describe('resolvePriceTable', () => {
  it('ships defaults for deepseek-v4-flash and deepseek-v4-pro', () => {
    for (const id of ['deepseek-v4-flash', 'deepseek-v4-pro']) {
      const price = DEFAULT_PRICES[id]
      expect(price).toBeDefined()
      for (const key of ['inputPerM', 'cacheReadPerM', 'outputPerM', 'cacheWritePerM'] as const) {
        expect(price[key]).toBeGreaterThan(0)
        expect(Number.isFinite(price[key])).toBe(true)
      }
    }
  })

  it('merges configured entries over defaults', () => {
    const table = resolvePriceTable({
      models: { 'deepseek-v4-flash': { inputPerM: 1, cacheReadPerM: 2, outputPerM: 3, cacheWritePerM: 4 } },
    })
    expect(table['deepseek-v4-flash'].inputPerM).toBe(1)
    expect(table['deepseek-v4-pro']).toEqual(DEFAULT_PRICES['deepseek-v4-pro'])
  })

  it('falls back to defaults when config is empty', () => {
    expect(resolvePriceTable(undefined)).toEqual(DEFAULT_PRICES)
  })

  it('defaults the currency to CNY and honors an override', () => {
    expect(resolveCurrency(undefined)).toBe('CNY')
    expect(resolveCurrency({ currency: 'USD' })).toBe('USD')
  })
})

/** Amount formula: disjoint buckets, reasoning never double-counted. */
import { amountBreakdown, amountOf } from '../src/host/prices.ts'

const PRICE = { inputPerM: 1, cacheReadPerM: 0.1, outputPerM: 2, cacheWritePerM: 0.5 }

describe('amountBreakdown', () => {
  it('computes per-bucket amounts at per-million rates', () => {
    const b = amountBreakdown(
      { inputTokens: 500_000, outputTokens: 200_000, cacheReadTokens: 1_000_000, cacheWriteTokens: 100_000 },
      PRICE,
    )
    expect(b.input).toBeCloseTo(0.5)          // 500k/1e6 * 1
    expect(b.cacheRead).toBeCloseTo(0.1)      // 1M/1e6 * 0.1
    expect(b.output).toBeCloseTo(0.4)         // 200k/1e6 * 2
    expect(b.cacheWrite).toBeCloseTo(0.05)    // 100k/1e6 * 0.5
    expect(b.total).toBeCloseTo(1.05)
  })

  it('does not add reasoningTokens on top of outputTokens', () => {
    const withReasoning = amountOf({ inputTokens: 0, outputTokens: 100_000, reasoningTokens: 100_000 }, PRICE)
    const without = amountOf({ inputTokens: 0, outputTokens: 100_000 }, PRICE)
    expect(withReasoning).toBeCloseTo(without) // reasoning ⊆ output
  })

  it('treats absent cache buckets as zero', () => {
    expect(amountOf({ inputTokens: 0, outputTokens: 0 }, PRICE)).toBe(0)
  })
})
