/** Prices route: body parsing, merge semantics, seam failure containment. */
import { describe, expect, it } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createPricesHandler, mergePrices, type PricesDeps } from '../src/host/prices-route.ts'
import type { Currency, ModelPrice } from '../src/shared/types.ts'

interface Captured { status: number; body: string }

function resOf(captured: Captured): ServerResponse {
  return { writeHead: (status: number) => { captured.status = status }, end: (body: string) => { captured.body = body } } as unknown as ServerResponse
}

function post(deps: Partial<PricesDeps> = {}) {
  const calls: Array<{ currency: Currency; prices: Record<string, ModelPrice> }> = []
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

describe('mergePrices', () => {
  it('overlays the edited currency and preserves every other entry', () => {
    const base = {
      'deepseek-v4-pro': { cny: FLASH, usd: { inputPerM: 0.078, cacheReadPerM: 0.008, outputPerM: 0.117, cacheWritePerM: 0.078 } },
      'custom-model': { cny: { inputPerM: 9, cacheReadPerM: 1, outputPerM: 9, cacheWritePerM: 9 } },
    }
    const out = mergePrices(base, 'CNY', { 'deepseek-v4-pro': { inputPerM: 0.99, cacheReadPerM: 0.1, outputPerM: 1.5, cacheWritePerM: 0.99 } })
    // edited currency updated, USD untouched, non-catalog model untouched
    expect(out['deepseek-v4-pro']?.cny?.inputPerM).toBe(0.99)
    expect(out['deepseek-v4-pro']?.usd?.outputPerM).toBe(0.117)
    expect(out['custom-model']?.cny?.inputPerM).toBe(9)
  })

  it('adds an entry the base never saw and fills only the edited currency', () => {
    const out = mergePrices(undefined, 'USD', { 'deepseek-v4-flash': FLASH })
    expect(out['deepseek-v4-flash']?.usd).toEqual(FLASH)
    expect(out['deepseek-v4-flash']?.cny).toBeUndefined()
  })

  it('an empty overlay leaves the base untouched', () => {
    const base = { a: { cny: FLASH } }
    expect(mergePrices(base, 'CNY', {})).toEqual(base)
  })
})

describe('createPricesHandler', () => {
  it('persists a valid overlay and answers ok', async () => {
    const { handler, captured, calls } = post()
    await handler(reqOf({ currency: 'CNY', prices: { 'deepseek-v4-flash': FLASH } }), resOf(captured))
    expect(captured.status).toBe(200)
    expect(JSON.parse(captured.body)).toEqual({ ok: true })
    expect(calls).toEqual([{ currency: 'CNY', prices: { 'deepseek-v4-flash': FLASH } }])
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
    for (const bad of [
      { ...FLASH, inputPerM: -1 },
      { inputPerM: 0.33, cacheReadPerM: 0.03, outputPerM: 0.5 },
    ]) {
      const { handler, captured, calls } = post()
      await handler(reqOf({ currency: 'CNY', prices: { 'deepseek-v4-flash': bad } }), resOf(captured))
      expect(captured.status).toBe(400)
      expect(calls).toEqual([])
    }
  })

  it('rejects non-object prices with 400', async () => {
    const { handler, captured, calls } = post()
    await handler(reqOf({ currency: 'CNY', prices: [FLASH] }), resOf(captured))
    expect(captured.status).toBe(400)
    expect(calls).toEqual([])
  })

  it('a seam failure surfaces as 400 with the message', async () => {
    const { handler, captured } = post({ writePrices: async () => { throw new Error('settings service is unavailable') } })
    await handler(reqOf({ currency: 'CNY', prices: { 'deepseek-v4-flash': FLASH } }), resOf(captured))
    expect(captured.status).toBe(400)
    expect(JSON.parse(captured.body)).toEqual({ ok: false, error: 'settings service is unavailable' })
  })
})
