// @vitest-environment jsdom
/** Store state machine: loading → ready/error, latest-wins, refresh. */
import { describe, expect, it } from 'vitest'
import { TokenUsageStore } from '../src/client/store.ts'
import type { StatsResponse } from '../src/shared/types.ts'

const RESPONSE: StatsResponse = {
  days: 7, from: 0, to: 0, generatedAt: 0, currency: 'CNY',
  buckets: [],
  totals: { tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, total: 0 }, amountCny: null, amountUsd: null, avgDailyTokens: 0, cacheHitRate: 0 },
  models: [], unpricedModels: [],
}

describe('TokenUsageStore', () => {
  it('publishes ready with data on success', async () => {
    const store = new TokenUsageStore(async (days) => ({ ...RESPONSE, days }))
    await store.load(15)
    const state = store.store.getSnapshot()
    expect(state.status).toBe('ready')
    expect(state.days).toBe(15)
    expect(state.data?.days).toBe(15)
  })

  it('publishes error with message on failure', async () => {
    const store = new TokenUsageStore(async () => { throw new Error('boom') })
    await store.load(7)
    const state = store.store.getSnapshot()
    expect(state.status).toBe('error')
    expect(state.error).toBe('boom')
  })

  it('ignores stale responses (latest wins)', async () => {
    let resolveSlow!: (value: StatsResponse) => void
    const slow = new Promise<StatsResponse>((resolve) => { resolveSlow = resolve })
    const store = new TokenUsageStore(async (days) => (days === 7 ? slow : { ...RESPONSE, days }))
    const first = store.load(7)   // slow
    await store.load(30)          // fast — wins
    resolveSlow(RESPONSE)
    await first
    const state = store.store.getSnapshot()
    expect(state.days).toBe(30)
    expect(state.data?.days).toBe(30)
    expect(state.status).toBe('ready')
  })

  it('refresh re-fetches the current days', async () => {
    const calls: number[] = []
    const store = new TokenUsageStore(async (days) => { calls.push(days); return { ...RESPONSE, days } })
    await store.load(30)
    await store.refresh()
    expect(calls).toEqual([30, 30])
  })

  it('serves a second load of the same window from cache without re-fetching', async () => {
    const calls: number[] = []
    const store = new TokenUsageStore(async (days) => { calls.push(days); return { ...RESPONSE, days } })
    await store.load(7)
    await store.load(7)
    expect(calls).toEqual([7])
    const state = store.store.getSnapshot()
    expect(state.status).toBe('ready')
    expect(state.data?.days).toBe(7)
  })

  it('a cached window renders instantly: no loading state on the switch', async () => {
    const store = new TokenUsageStore(async (days) => ({ ...RESPONSE, days }))
    await store.load(15)
    const switchPromise = store.load(15)
    // The cache hit must publish before any await crosses the microtask queue.
    expect(store.store.getSnapshot().status).toBe('ready')
    await switchPromise
  })

  it('prefetch warms a window without touching the visible snapshot', async () => {
    const calls: number[] = []
    const store = new TokenUsageStore(async (days) => { calls.push(days); return { ...RESPONSE, days } })
    await store.load(7)
    await store.prefetch(30)
    // Snapshot still describes the visible window…
    expect(store.store.getSnapshot().days).toBe(7)
    // …but switching is now served from cache without another fetch.
    await store.load(30)
    expect(calls).toEqual([7, 30])
  })

  it('a failed prefetch is silent and a later load retries', async () => {
    let failures = 1
    const store = new TokenUsageStore(async (days) => {
      if (days === 30 && failures > 0) { failures -= 1; throw new Error('boom') }
      return { ...RESPONSE, days }
    })
    await store.prefetch(30)
    expect(store.store.getSnapshot().status).toBe('idle')
    await store.load(30)
    expect(store.store.getSnapshot().status).toBe('ready')
  })

  it('refresh bypasses the cache and updates it', async () => {
    const calls: number[] = []
    let version = 1
    const store = new TokenUsageStore(async (days) => {
      calls.push(days)
      return { ...RESPONSE, days, generatedAt: version }
    })
    await store.load(7)
    version = 2
    await store.refresh()
    expect(calls).toEqual([7, 7])
    expect(store.store.getSnapshot().data?.generatedAt).toBe(2)
  })

  it('clearCache drops every window; the next load re-fetches', async () => {
    const calls: number[] = []
    const store = new TokenUsageStore(async (days) => { calls.push(days); return { ...RESPONSE, days } })
    await store.load(7)
    store.clearCache()
    await store.load(7)
    expect(calls).toEqual([7, 7])
  })

  it('concurrent loads of the same window share one in-flight fetch', async () => {
    const calls: number[] = []
    const store = new TokenUsageStore(async (days) => {
      calls.push(days)
      await new Promise(resolve => setTimeout(resolve, 5))
      return { ...RESPONSE, days }
    })
    await Promise.all([store.load(7), store.load(7), store.load(7)])
    expect(calls).toEqual([7])
  })
})
