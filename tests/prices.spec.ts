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
