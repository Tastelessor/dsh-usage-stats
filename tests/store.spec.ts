// @vitest-environment jsdom
/** Store state machine: loading → ready/error, latest-wins, refresh. */
import { describe, expect, it } from 'vitest'
import { UsageStatsStore } from '../src/client/store.ts'
import type { StatsResponse } from '../src/shared/types.ts'

const RESPONSE: StatsResponse = {
  days: 7, from: 0, to: 0, generatedAt: 0, currency: 'CNY',
  buckets: [], totals: { tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, total: 0 }, amount: null },
  models: [], unpricedModels: [],
}

describe('UsageStatsStore', () => {
  it('publishes ready with data on success', async () => {
    const store = new UsageStatsStore(async (days) => ({ ...RESPONSE, days }))
    await store.load(15)
    const state = store.store.getSnapshot()
    expect(state.status).toBe('ready')
    expect(state.days).toBe(15)
    expect(state.data?.days).toBe(15)
  })

  it('publishes error with message on failure', async () => {
    const store = new UsageStatsStore(async () => { throw new Error('boom') })
    await store.load(7)
    const state = store.store.getSnapshot()
    expect(state.status).toBe('error')
    expect(state.error).toBe('boom')
  })

  it('ignores stale responses (latest wins)', async () => {
    let resolveSlow!: (value: StatsResponse) => void
    const slow = new Promise<StatsResponse>((resolve) => { resolveSlow = resolve })
    const store = new UsageStatsStore(async (days) => (days === 7 ? slow : { ...RESPONSE, days }))
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
    const store = new UsageStatsStore(async (days) => { calls.push(days); return { ...RESPONSE, days } })
    await store.load(30)
    await store.refresh()
    expect(calls).toEqual([30, 30])
  })
})
