/** Stats route: days parsing, JSON shape, model rows, pruning, fault tolerance. */
import { describe, expect, it } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createStatsHandler, mapLimit, parseDays, type SessionSource, type StatsDeps } from '../src/host/stats-route.ts'
import type { ModelPrice } from '../src/shared/types.ts'

const CNY: Record<string, ModelPrice> = {
  'deepseek-v4-flash': { inputPerM: 1, cacheReadPerM: 0.1, outputPerM: 2, cacheWritePerM: 0.5 },
}
const USD: Record<string, ModelPrice> = {
  'deepseek-v4-flash': { inputPerM: 0.2, cacheReadPerM: 0.02, outputPerM: 0.4, cacheWritePerM: 0.1 },
}

const NOW = new Date('2026-08-14T12:00:00').getTime()

interface Captured { status: number; body: string }

function request(deps: Partial<StatsDeps> = {}, query = 'days=7') {
  const captured: Captured = { status: 0, body: '' }
  const handler = createStatsHandler({
    listSessions: async () => [],
    loadEvents: async () => [],
    listProviders: () => [{ id: 'deepseek-official', name: 'DeepSeek' }],
    listModels: async () => [{ provider: 'deepseek-official', id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash' }],
    pricesCny: () => CNY,
    pricesUsd: () => USD,
    currency: () => 'CNY',
    now: () => NOW,
    ...deps,
  })
  const req = { method: 'GET', url: `/dsh-usage-stats/stats?${query}` } as IncomingMessage
  return { handler, captured, req }
}

describe('parseDays', () => {
  it('accepts 7/15/30 and defaults to 7', () => {
    expect(parseDays('7')).toBe(7)
    expect(parseDays('15')).toBe(15)
    expect(parseDays('30')).toBe(30)
    expect(parseDays(null)).toBe(7)
    expect(parseDays('99')).toBe(7)
    expect(parseDays('abc')).toBe(7)
  })
})

describe('mapLimit', () => {
  it('runs items with a bounded concurrency and preserves order', async () => {
    let inFlight = 0
    let peak = 0
    const out = await mapLimit([1, 2, 3, 4, 5], 2, async (n) => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await new Promise(resolve => setTimeout(resolve, 5))
      inFlight -= 1
      return n * 2
    })
    expect(out).toEqual([2, 4, 6, 8, 10])
    expect(peak).toBe(2)
  })

  it('handles an empty input', async () => {
    expect(await mapLimit([], 3, async () => 1)).toEqual([])
  })
})

describe('createStatsHandler', () => {
  it('serves a full StatsResponse with zero-filled buckets and per-currency catalog rows', async () => {
    const { handler, captured, req } = request()
    await handler(req, resOf(captured))
    expect(captured.status).toBe(200)
    const body = JSON.parse(captured.body)
    expect(body.days).toBe(7)
    expect(body.currency).toBe('CNY')
    expect(body.from).toBe(new Date('2026-08-08T00:00:00').getTime())
    expect(body.buckets).toHaveLength(7)
    expect(body.buckets[6].date).toBe('2026-08-14')
    expect(body.totals.amountCny).toBeNull()
    expect(body.totals.amountUsd).toBeNull()
    expect(body.totals.avgDailyTokens).toBe(0)
    expect(body.totals.cacheHitRate).toBe(0)
    expect(body.models).toEqual([{
      provider: 'deepseek-official', model: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash',
      cny: CNY['deepseek-v4-flash'], usd: USD['deepseek-v4-flash'],
    }])
    expect(body.unpricedModels).toEqual([])
  })

  it('aggregates usage from loaded events into dual-currency amounts', async () => {
    const { handler, captured, req } = request({
      listSessions: async () => [source('s1', new Date('2026-08-14T00:00:00').getTime(), true)],
      loadEvents: async () => [eventOf('2026-08-14', 1_000_000, 500_000)],
    })
    await handler(req, resOf(captured))
    const body = JSON.parse(captured.body)
    expect(body.totals.tokens.total).toBe(1_500_000)
    expect(body.totals.amountCny).toBeCloseTo(2)
    expect(body.totals.amountUsd).toBeCloseTo(0.4)
    expect(body.buckets[6].amountCny).toBeCloseTo(2)
  })

  it('rejects non-GET with 405', async () => {
    const { handler, captured } = request()
    await handler({ method: 'POST', url: '/dsh-usage-stats/stats' } as IncomingMessage, resOf(captured))
    expect(captured.status).toBe(405)
  })

  it('skips persisted sessions whose log was not touched inside the window', async () => {
    let loads = 0
    const { handler, captured, req } = request({
      listSessions: async () => [
        source('idle', new Date('2026-07-01T00:00:00').getTime(), false, new Date('2026-07-02T00:00:00').getTime()),
        source('active', new Date('2026-07-01T00:00:00').getTime(), false, new Date('2026-08-10T00:00:00').getTime()),
      ],
      loadEvents: async () => { loads += 1; return [] },
    })
    await handler(req, resOf(captured))
    expect(loads).toBe(1) // only 'active' (mtime inside the 7-day window)
    expect(captured.status).toBe(200)
  })

  it('never mtime-prunes live sessions', async () => {
    let loads = 0
    const { handler, captured, req } = request({
      listSessions: async () => [
        source('live-idle', new Date('2026-07-01T00:00:00').getTime(), true, new Date('2026-07-02T00:00:00').getTime()),
      ],
      loadEvents: async () => { loads += 1; return [] },
    })
    await handler(req, resOf(captured))
    expect(loads).toBe(1)
    expect(captured.status).toBe(200)
  })

  it('keeps serving when one session load fails', async () => {
    const { handler, captured, req } = request({
      listSessions: async () => [
        source('s1', 0, true),
        source('s2', 0, true),
      ],
      loadEvents: async (s: SessionSource) => {
        if (s.id === 's1') throw new Error('corrupt log')
        return []
      },
    })
    await handler(req, resOf(captured))
    expect(captured.status).toBe(200)
    expect(JSON.parse(captured.body).buckets).toHaveLength(7)
  })

  it('skips sessions created after the window end', async () => {
    let loads = 0
    const { handler, captured, req } = request({
      listSessions: async () => [
        source('future', new Date('2026-08-20T00:00:00').getTime(), true),
      ],
      loadEvents: async () => { loads += 1; return [] },
    })
    await handler(req, resOf(captured))
    expect(loads).toBe(0)
    expect(captured.status).toBe(200)
  })

  it('serves a cached payload and skips the whole pipeline on a cache hit', async () => {
    let loads = 0
    const store = new Map<number, string>()
    const { handler, captured, req } = request({
      listSessions: async () => [source('s1', 0, true)],
      loadEvents: async () => { loads += 1; return [] },
      cache: {
        get: (days) => store.get(days),
        set: (days, payload) => { store.set(days, payload) },
      },
    })
    await handler(req, resOf(captured))
    expect(loads).toBe(1) // cold: full pipeline
    const cachedBody = captured.body
    await handler(req, resOf(captured))
    expect(loads).toBe(1) // hot: no session loads
    expect(captured.body).toBe(cachedBody)
  })
})

/** Minimal SessionEvent with a usage-bearing assistant/message payload. */
function eventOf(date: string, input: number, output: number): never {
  return {
    type: 'assistant/message',
    seq: 0,
    time: new Date(`${date}T12:00:00`).getTime(),
    data: {
      usage: { inputTokens: input, outputTokens: output },
      message: { source: { kind: 'model', provider: 'deepseek-official', model: 'deepseek-v4-flash' } },
    },
  } as never
}

function source(id: string, createdAt: number, live: boolean, mtimeMs?: number): SessionSource {
  return { id: id as never, createdAt, live, mtimeMs }
}

function resOf(captured: Captured): ServerResponse {
  return { writeHead: (status: number) => { captured.status = status }, end: (body: string) => { captured.body = body } } as unknown as ServerResponse
}
