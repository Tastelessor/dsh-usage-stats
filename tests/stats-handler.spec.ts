/** Stats route: days parsing, JSON shape, model rows, fault tolerance. */
import { describe, expect, it } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createStatsHandler, parseDays, type StatsDeps } from '../src/host/stats-route.ts'
import type { ModelPrice } from '../src/shared/types.ts'

const PRICES: Record<string, ModelPrice> = {
  'deepseek-v4-flash': { inputPerM: 1, cacheReadPerM: 0.1, outputPerM: 2, cacheWritePerM: 0.5 },
}

interface Captured { status: number; body: string }

function request(deps: Partial<StatsDeps> = {}, query = 'days=7') {
  const captured: Captured = { status: 0, body: '' }
  const handler = createStatsHandler({
    listSessions: async () => [],
    readSession: async () => { throw new Error('unused') },
    listProviders: () => [{ id: 'deepseek-official', name: 'DeepSeek' }],
    listModels: async () => [{ provider: 'deepseek-official', id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash' }],
    prices: () => PRICES,
    currency: () => 'CNY',
    now: () => new Date('2026-08-14T12:00:00').getTime(),
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

describe('createStatsHandler', () => {
  it('serves a full StatsResponse with zero-filled buckets and catalog rows', async () => {
    const { handler, captured, req } = request()
    await handler(req, resOf(captured))
    expect(captured.status).toBe(200)
    const body = JSON.parse(captured.body)
    expect(body.days).toBe(7)
    expect(body.currency).toBe('CNY')
    expect(body.buckets).toHaveLength(7)
    expect(body.buckets[6].date).toBe('2026-08-14')
    expect(body.totals.amount).toBeNull()
    expect(body.models).toEqual([{
      provider: 'deepseek-official', model: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash',
      inputPerM: 1, cacheReadPerM: 0.1, outputPerM: 2, cacheWritePerM: 0.5, priced: true,
    }])
    expect(body.unpricedModels).toEqual([])
  })

  it('rejects non-GET with 405', async () => {
    const { handler, captured } = request()
    await handler({ method: 'POST', url: '/dsh-usage-stats/stats' } as IncomingMessage, resOf(captured))
    expect(captured.status).toBe(405)
  })

  it('keeps serving when one session read fails', async () => {
    const { handler, captured, req } = request({
      listSessions: async () => [
        { header: { id: 's1', createdAt: 0 } as never, live: true, persisted: false },
        { header: { id: 's2', createdAt: 0 } as never, live: true, persisted: false },
      ],
      readSession: async (id: string) => {
        if (id === 's1') throw new Error('corrupt log')
        return { session: {} as never, events: [] }
      },
    })
    await handler(req, resOf(captured))
    expect(captured.status).toBe(200)
    expect(JSON.parse(captured.body).buckets).toHaveLength(7)
  })

  it('skips sessions created after the window end', async () => {
    let reads = 0
    const { handler, captured, req } = request({
      listSessions: async () => [
        { header: { id: 'future', createdAt: new Date('2026-08-20T00:00:00').getTime() } as never, live: true, persisted: false },
      ],
      readSession: async () => { reads += 1; return { session: {} as never, events: [] } },
    })
    await handler(req, resOf(captured))
    expect(reads).toBe(0)
    expect(captured.status).toBe(200)
  })
})

function resOf(captured: Captured): ServerResponse {
  return { writeHead: (status: number) => { captured.status = status }, end: (body: string) => { captured.body = body } } as unknown as ServerResponse
}
