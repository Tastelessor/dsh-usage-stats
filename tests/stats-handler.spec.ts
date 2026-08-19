/** Stats route (v2): single endpoint, indexer pipeline, windows, caching, fault tolerance. */
import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createStatsHandler, type StatsDeps } from '../src/host/stats-route.ts'
import { UsageIndexer, type SessionSource } from '../src/host/indexer.ts'
import type { TieredModelPrice } from '../src/shared/types.ts'

/** Equal-tier tables: amounts are timezone-independent, so structure assertions stay stable. */
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

const NOW = new Date('2026-08-19T12:00:00').getTime()

interface Captured { status: number; body: string }

function eventOf(time: number, input: number, output: number): never {
  return {
    type: 'assistant/message', seq: 0, time,
    data: {
      usage: { inputTokens: input, outputTokens: output },
      message: { source: { kind: 'model', provider: 'deepseek-official', model: 'deepseek-v4-flash' } },
    },
  } as never
}

function source(id: string, createdAt: number, live: boolean, mtimeMs?: number): SessionSource {
  return { id: id as never, createdAt, live, mtimeMs }
}

function request(deps: Partial<StatsDeps> = {}) {
  const captured: Captured = { status: 0, body: '' }
  const indexer = deps.indexer ?? new UsageIndexer({
    listSessions: async () => [],
    loadEvents: async () => [],
    indexPath: () => join(mkdtempSync(join(tmpdir(), 'dsh-tu-route-')), 'index.json'),
    now: () => NOW,
  })
  const handler = createStatsHandler({
    indexer,
    listProviders: () => [{ id: 'deepseek-official', name: 'DeepSeek' }],
    listModels: async () => [{ provider: 'deepseek-official', id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash' }],
    pricesCny: () => CNY,
    pricesUsd: () => USD,
    currency: () => 'CNY',
    now: () => NOW,
    ...deps,
  })
  const req = { method: 'GET', url: '/dsh-token-usage/stats' } as IncomingMessage
  return { handler, captured, req, indexer }
}

function resOf(captured: Captured): ServerResponse {
  return { writeHead: (status: number) => { captured.status = status }, end: (body: string) => { captured.body = body } } as unknown as ServerResponse
}

describe('createStatsHandler (v2)', () => {
  it('serves a full StatsResponse with zero-filled buckets, windows, and catalog rows', async () => {
    const { handler, captured, req } = request()
    await handler(req, resOf(captured))
    expect(captured.status).toBe(200)
    const body = JSON.parse(captured.body)
    expect(body.currency).toBe('CNY')
    expect(body.from).toBe(new Date('2026-08-01T00:00:00').getTime())
    expect(body.buckets).toHaveLength(19) // 08-01..08-19
    expect(body.buckets[18].date).toBe('2026-08-19')
    expect(body.windows.today.tokens.total).toBe(0)
    expect(body.windows.month.avgDailyTokens).toBe(0)
    expect(body.models).toEqual([{
      provider: 'deepseek-official', model: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash',
      cny: CNY['deepseek-v4-flash'], usd: USD['deepseek-v4-flash'],
    }])
    expect(body.unpricedModels).toEqual([])
  })

  it('aggregates usage through the indexer into buckets and windows', async () => {
    const indexer = new UsageIndexer({
      listSessions: async () => [source('s1', 0, true)],
      loadEvents: async () => [eventOf(new Date('2026-08-19T12:00:00').getTime(), 1_000_000, 500_000)],
      indexPath: () => join(mkdtempSync(join(tmpdir(), 'dsh-tu-route-')), 'index.json'),
      now: () => NOW,
    })
    const { handler, captured, req } = request({ indexer })
    await handler(req, resOf(captured))
    const body = JSON.parse(captured.body)
    expect(body.windows.today.tokens.total).toBe(1_500_000)
    expect(body.windows.today.amountCny).toBeCloseTo(2)
    expect(body.windows.today.amountUsd).toBeCloseTo(0.4)
    expect(body.buckets[18].amountCny).toBeCloseTo(2)
  })

  it('serves a cached payload and skips the whole pipeline on a cache hit', async () => {
    let fresh = ''
    const { handler, captured, req } = request({
      cache: { get: () => (fresh === '' ? undefined : fresh), set: (p) => { fresh = p } },
    })
    await handler(req, resOf(captured))
    expect(captured.body).toBe(fresh)
    const body1 = captured.body
    await handler(req, resOf(captured))
    expect(captured.body).toBe(body1)
  })

  it('keeps serving when one session load fails (indexer fault tolerance)', async () => {
    const indexer = new UsageIndexer({
      listSessions: async () => [source('bad', 0, true)],
      loadEvents: async () => { throw new Error('corrupt log') },
      indexPath: () => join(mkdtempSync(join(tmpdir(), 'dsh-tu-route-')), 'index.json'),
      now: () => NOW,
    })
    const { handler, captured, req } = request({ indexer })
    await handler(req, resOf(captured))
    expect(captured.status).toBe(200)
    expect(JSON.parse(captured.body).buckets).toHaveLength(19)
  })

  it('rejects non-GET with 405', async () => {
    const { handler, captured } = request()
    await handler({ method: 'POST', url: '/dsh-token-usage/stats' } as IncomingMessage, resOf(captured))
    expect(captured.status).toBe(405)
  })
})