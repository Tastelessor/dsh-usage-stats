// @vitest-environment jsdom
/** Store state machine: loading → ready/error, latest-wins, refresh, single-entry cache. */
import { describe, expect, it } from 'vitest'
import { TokenUsageStore } from '../src/client/store.ts'
import type { StatsResponse } from '../src/shared/types.ts'

const EMPTY_WINDOW = { tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, total: 0 }, amountCny: null, amountUsd: null, cacheHitRate: 0, avgDailyTokens: 0 }

const RESPONSE: StatsResponse = {
  from: 0, to: 0, generatedAt: 0, currency: 'CNY',
  buckets: [],
  windows: { today: EMPTY_WINDOW, week: EMPTY_WINDOW, month: EMPTY_WINDOW },
  models: [], unpricedModels: [],
}

describe('TokenUsageStore', () => {
  it('publishes ready with data on success', async () => {
    const store = new TokenUsageStore(async () => ({ ...RESPONSE, generatedAt: 1 }))
    await store.load()
    const state = store.store.getSnapshot()
    expect(state.status).toBe('ready')
    expect(state.data?.generatedAt).toBe(1)
  })

  it('publishes error with message on failure', async () => {
    const store = new TokenUsageStore(async () => { throw new Error('boom') })
    await store.load()
    const state = store.store.getSnapshot()
    expect(state.status).toBe('error')
    expect(state.error).toBe('boom')
  })

  it('refresh re-fetches even when the cache is warm', async () => {
    const calls: number[] = []
    const store = new TokenUsageStore(async () => { calls.push(1); return { ...RESPONSE, generatedAt: calls.length } })
    await store.load()
    await store.refresh()
    expect(calls).toEqual([1, 1])
    expect(store.store.getSnapshot().data?.generatedAt).toBe(2)
  })

  it('serves a second load from cache without re-fetching', async () => {
    const calls: number[] = []
    const store = new TokenUsageStore(async () => { calls.push(1); return RESPONSE })
    await store.load()
    await store.load()
    expect(calls).toEqual([1])
    expect(store.store.getSnapshot().status).toBe('ready')
  })

  it('clearCache drops the entry; the next load re-fetches', async () => {
    const calls: number[] = []
    const store = new TokenUsageStore(async () => { calls.push(1); return RESPONSE })
    await store.load()
    store.clearCache()
    await store.load()
    expect(calls).toEqual([1, 1])
  })

  it('concurrent loads share one in-flight fetch', async () => {
    const calls: number[] = []
    const store = new TokenUsageStore(async () => {
      calls.push(1)
      await new Promise(resolve => setTimeout(resolve, 5))
      return RESPONSE
    })
    await Promise.all([store.load(), store.load(), store.load()])
    expect(calls).toEqual([1])
  })
})