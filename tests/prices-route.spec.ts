/** Prices route: body parsing, tiered/legacy-normalized writes, merge semantics, seam failure. */
import { describe, expect, it } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createPricesHandler, mergePrices, type PricesDeps } from '../src/host/prices-route.ts'
import type { Currency, ModelPrice, TieredModelPrice } from '../src/shared/types.ts'

interface Captured { status: number; body: string }

function resOf(captured: Captured): ServerResponse {
  return { writeHead: (status: number) => { captured.status = status }, end: (body: string) => { captured.body = body } } as unknown as ServerResponse
}

function post(deps: Partial<PricesDeps> = {}) {
  const calls: Array<{ currency: Currency; prices: Record<string, TieredModelPrice> }> = []
  const handler = createPricesHandler({
    writePrices: async (currency, prices) => { calls.push({ currency, prices }) },
    ...deps,
  })
  const captured: Captured = { status: 0, body: '' }
  return { handler, captured, calls }
}

function reqOf(body: unknown, method = 'POST'): IncomingMessage {
  return {
    method,
    url: '/dsh-token-usage/prices',
    [Symbol.asyncIterator]: async function* () { yield JSON.stringify(body) },
  } as unknown as IncomingMessage
}

const FLASH: ModelPrice = { inputPerM: 0.33, cacheReadPerM: 0.03, outputPerM: 0.5, cacheWritePerM: 0.33 }
const FLASH_TIERED: TieredModelPrice = {
  peak: { inputPerM: 0.66, cacheReadPerM: 0.06, outputPerM: 1.0, cacheWritePerM: 0.33 },
  offPeak: FLASH,
}

describe('mergePrices', () => {
  it('overlays the edited currency and preserves every other entry', () => {
    const base = {
      'deepseek-v4-pro': { cny: FLASH_TIERED, usd: FLASH_TIERED },
      'custom-model': { cny: FLASH },
    }
    const out = mergePrices(base, 'CNY', { 'deepseek-v4-pro': FLASH_TIERED })
    // edited currency updated, USD untouched, non-catalog model untouched (flat legacy preserved)
    expect(out['deepseek-v4-pro']?.cny).toEqual(FLASH_TIERED)
    expect(out['deepseek-v4-pro']?.usd).toEqual(FLASH_TIERED)
    expect(out['custom-model']?.cny).toEqual(FLASH)
  })

  it('adds an entry the base never saw and fills only the edited currency', () => {
    const out = mergePrices(undefined, 'USD', { 'deepseek-v4-flash': FLASH_TIERED })
    expect(out['deepseek-v4-flash']?.usd).toEqual(FLASH_TIERED)
    expect(out['deepseek-v4-flash']?.cny).toBeUndefined()
  })

  it('an empty overlay leaves the base untouched', () => {
    const base = { a: { cny: FLASH_TIERED } }
    expect(mergePrices(base, 'CNY', {})).toEqual(base)
  })
})

describe('createPricesHandler', () => {
  it('persists a valid tiered overlay and answers ok', async () => {
    const { handler, captured, calls } = post()
    await handler(reqOf({ currency: 'CNY', prices: { 'deepseek-v4-flash': FLASH_TIERED } }), resOf(captured))
    expect(captured.status).toBe(200)
    expect(JSON.parse(captured.body)).toEqual({ ok: true })
    expect(calls).toEqual([{ currency: 'CNY', prices: { 'deepseek-v4-flash': FLASH_TIERED } }])
  })

  it('normalizes a legacy flat write into equal tiers', async () => {
    const { handler, captured, calls } = post()
    await handler(reqOf({ currency: 'USD', prices: { 'deepseek-v4-flash': FLASH } }), resOf(captured))
    expect(captured.status).toBe(200)
    expect(calls).toEqual([{ currency: 'USD', prices: { 'deepseek-v4-flash': { peak: FLASH, offPeak: FLASH } } }])
  })

  it('an empty prices object is a valid write', async () => {
    const { handler, captured, calls } = post()
    await handler(reqOf({ currency: 'USD', prices: {} }), resOf(captured))
    expect(captured.status).toBe(200)
    expect(calls).toEqual([{ currency: 'USD', prices: {} }])
  })

  it('rejects a non-POST method with 405', async () => {
    const { handler, captured } = post()
    await handler(reqOf({}, 'GET'), resOf(captured))
    expect(captured.status).toBe(405)
  })

  it('rejects malformed JSON with 400', async () => {
    const { handler, captured, calls } = post()
    const req = { method: 'POST', url: '/dsh-token-usage/prices', [Symbol.asyncIterator]: async function* () { yield 'not json' } } as unknown as IncomingMessage
    await handler(req, resOf(captured))
    expect(captured.status).toBe(400)
    expect(JSON.parse(captured.body).ok).toBe(false)
    expect(calls).toEqual([])
  })

  it('rejects an unknown currency with 400', async () => {
    const { handler, captured, calls } = post()
    await handler(reqOf({ currency: 'EUR', prices: {} }), resOf(captured))
    expect(captured.status).toBe(400)
    expect(calls).toEqual([])
  })

  it('rejects a negative or missing price field with 400', async () => {
    const bad = [
      { ...FLASH_TIERED, peak: { ...FLASH_TIERED.peak, inputPerM: -1 } },
      { ...FLASH_TIERED, offPeak: { inputPerM: 0.33, cacheReadPerM: 0.03, outputPerM: 0.5 } },
      { ...FLASH_TIERED, peak: 'nope' },
    ]
    for (const entry of bad) {
      const { handler, captured, calls } = post()
      await handler(reqOf({ currency: 'CNY', prices: { 'deepseek-v4-flash': entry } }), resOf(captured))
      expect(captured.status).toBe(400)
      expect(calls).toEqual([])
    }
  })

  it('rejects non-object prices with 400', async () => {
    const { handler, captured, calls } = post()
    await handler(reqOf({ currency: 'CNY', prices: [FLASH_TIERED] }), resOf(captured))
    expect(captured.status).toBe(400)
    expect(calls).toEqual([])
  })

  it('a seam failure surfaces as 400 with the message', async () => {
    const { handler, captured } = post({ writePrices: async () => { throw new Error('settings service is unavailable') } })
    await handler(reqOf({ currency: 'CNY', prices: { 'deepseek-v4-flash': FLASH_TIERED } }), resOf(captured))
    expect(captured.status).toBe(400)
    expect(JSON.parse(captured.body)).toEqual({ ok: false, error: 'settings service is unavailable' })
  })
})