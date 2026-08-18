/**
 * HTTP handler for POST /dsh-token-usage/prices. Persists the price editor's
 * per-currency overlay through the settings seam in-process.
 *
 * Web clients cannot write an external plugin's settings namespace directly:
 * the host api-proxy serves only its hardcoded allowlist and answers
 * `settings-not-exposed` for anything else, so the write round-trip rides this
 * plugin-owned route, which calls `ctx.settings.mutate` on the host side —
 * the same seam, no allowlist involved. The merge lives here (not in the
 * browser) because the browser never sees the resolved config: non-catalog
 * models and the untouched currency must survive the write.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { normalizeTiered } from './config.ts'
import type { Currency, ModelPrice, ModelPricesByCurrency, TieredModelPrice } from '../shared/types.ts'

/** Everything the route needs from the host; faked directly in tests. */
export interface PricesDeps {
  /**
   * Persist the merged per-currency models dict. Rejects (throw) when the
   * settings seam refuses the write; the handler answers that as a 400.
   */
  writePrices(currency: Currency, prices: Record<string, TieredModelPrice>): Promise<void>
}

const CURRENCIES = new Set<Currency>(['CNY', 'USD'])
const PRICE_KEYS = ['inputPerM', 'cacheReadPerM', 'outputPerM', 'cacheWritePerM'] as const

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' } as const

/** Overlay one currency's edits onto the resolved models dict, preserving every other entry. */
export function mergePrices(
  base: Record<string, ModelPricesByCurrency> | undefined,
  currency: Currency,
  prices: Record<string, TieredModelPrice>,
): Record<string, ModelPricesByCurrency> {
  const models: Record<string, ModelPricesByCurrency> = { ...(base ?? {}) }
  for (const [id, price] of Object.entries(prices)) {
    models[id] = { ...(models[id] ?? {}), [currency === 'CNY' ? 'cny' : 'usd']: price }
  }
  return models
}

function isModelPrice(value: unknown): value is ModelPrice {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return PRICE_KEYS.every((key) => {
    const number = record[key]
    return typeof number === 'number' && Number.isFinite(number) && number >= 0
  })
}

/** Accept the tiered {peak, offPeak} write and the flat (legacy) form, normalized. */
function isTieredModelPrice(value: unknown): value is TieredModelPrice {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const record = value as { peak?: unknown; offPeak?: unknown }
  return isModelPrice(record.peak) && isModelPrice(record.offPeak)
}

/** Parse the {currency, prices} body; one discriminated outcome, no throws. */
function parseBody(raw: string): { currency: Currency; prices: Record<string, TieredModelPrice> } | { error: string } {
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return { error: 'body must be valid JSON' }
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return { error: 'body must be an object' }
  const record = body as { currency?: unknown; prices?: unknown }
  if (typeof record.currency !== 'string' || !CURRENCIES.has(record.currency as Currency)) {
    return { error: 'currency must be "CNY" or "USD"' }
  }
  if (typeof record.prices !== 'object' || record.prices === null || Array.isArray(record.prices)) {
    return { error: 'prices must be an object of model id → price' }
  }
  const prices: Record<string, TieredModelPrice> = {}
  for (const [id, price] of Object.entries(record.prices)) {
    if (isTieredModelPrice(price)) {
      prices[id] = price
    } else if (isModelPrice(price)) {
      prices[id] = normalizeTiered(price)
    } else {
      return { error: `invalid price for model "${id}": expected {peak, offPeak} or a flat price` }
    }
  }
  return { currency: record.currency as Currency, prices }
}

/** Build the handler bound to one deps snapshot. */
export function createPricesHandler(deps: PricesDeps): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    if (req.method !== 'POST') {
      res.writeHead(405, {
        allow: 'POST',
        'content-type': 'text/plain; charset=utf-8',
      })
      res.end()
      return
    }
    let raw = ''
    for await (const chunk of req) raw += chunk
    const parsed = parseBody(raw)
    if ('error' in parsed) {
      res.writeHead(400, JSON_HEADERS)
      res.end(JSON.stringify({ ok: false, error: parsed.error }))
      return
    }
    try {
      await deps.writePrices(parsed.currency, parsed.prices)
    } catch (error) {
      res.writeHead(400, JSON_HEADERS)
      res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }))
      return
    }
    res.writeHead(200, JSON_HEADERS)
    res.end(JSON.stringify({ ok: true }))
  }
}
