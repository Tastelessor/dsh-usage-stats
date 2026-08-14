/**
 * Token-usage page store: fetches the host aggregation JSON over the
 * plugin-owned route and publishes a uSES-safe snapshot. The fetcher is
 * injectable for tests; the default hits the same-origin endpoint.
 *
 * Range switches ride a short-lived per-window cache: the page prefetches
 * every window at activation, so switching 7/15/30 days is instant instead of
 * another cold aggregation, and an explicit refresh (or a price save) busts
 * the cache so edited prices show up immediately.
 */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { StatsResponse } from '../shared/types.ts'

export type TokenUsageStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface TokenUsageState {
  status: TokenUsageStatus
  error: string | null
  days: number
  data: StatsResponse | null
}

/** Default fetcher: same-origin GET, throws on non-2xx. */
export async function defaultFetcher(days: number): Promise<StatsResponse> {
  const response = await fetch(`/dsh-token-usage/stats?days=${days}`, { credentials: 'same-origin' })
  if (!response.ok) throw new Error(`token usage fetch failed: HTTP ${response.status}`)
  return response.json() as Promise<StatsResponse>
}

/** How long a cached window stays fresh before the next load re-fetches it. */
const CACHE_TTL_MS = 30_000

/** The page controller (one per settings surface). */
export class TokenUsageStore {
  readonly store: SnapshotStore<TokenUsageState> = createSnapshotStore<TokenUsageState>({
    status: 'idle',
    error: null,
    days: 7,
    data: null,
  })

  /** Latest load wins; an older response never overwrites a newer one. */
  private generation = 0

  /** One in-flight fetch per window: concurrent loads share it, never duplicate. */
  private readonly inflight = new Map<number, Promise<StatsResponse>>()

  /** Fresh per-window responses; served instantly on range switches. */
  private readonly cache = new Map<number, { at: number; data: StatsResponse }>()

  constructor(private readonly fetcher: (days: number) => Promise<StatsResponse> = defaultFetcher) {}

  /** Load the given range; a fresh cache entry serves it without a network round. */
  async load(days: number, options: { force?: boolean } = {}): Promise<void> {
    const generation = ++this.generation
    if (options.force !== true) {
      const cached = this.cached(days)
      if (cached !== undefined) {
        this.store.update((s) => { s.status = 'ready'; s.error = null; s.days = days; s.data = cached })
        return
      }
    }
    this.store.update((s) => { s.status = 'loading'; s.error = null; s.days = days })
    try {
      const data = await this.fetch(days)
      if (generation !== this.generation) return
      this.cache.set(days, { at: Date.now(), data })
      this.store.update((s) => { s.status = 'ready'; s.error = null; s.data = data })
    } catch (error) {
      if (generation !== this.generation) return
      this.store.update((s) => {
        s.status = 'error'
        s.error = error instanceof Error ? error.message : String(error)
      })
    }
  }

  /** Re-fetch the currently selected range, bypassing the cache. */
  refresh(): Promise<void> {
    return this.load(this.store.getSnapshot().days, { force: true })
  }

  /** Warm one window into the cache without touching the visible snapshot; failures are silent. */
  async prefetch(days: number): Promise<void> {
    if (this.cached(days) !== undefined) return
    try {
      const data = await this.fetch(days)
      this.cache.set(days, { at: Date.now(), data })
    } catch {
      // Background warming must never fail the page; a later explicit load retries.
    }
  }

  /** Drop every cached window (after a price save, so edits are never served stale). */
  clearCache(): void {
    this.cache.clear()
  }

  /** Fetch one window once: concurrent callers share the same in-flight promise. */
  private async fetch(days: number): Promise<StatsResponse> {
    const existing = this.inflight.get(days)
    if (existing !== undefined) return existing
    const request = this.fetcher(days).finally(() => { this.inflight.delete(days) })
    this.inflight.set(days, request)
    return request
  }

  private cached(days: number): StatsResponse | undefined {
    const entry = this.cache.get(days)
    if (entry === undefined) return undefined
    if (Date.now() - entry.at >= CACHE_TTL_MS) {
      this.cache.delete(days)
      return undefined
    }
    return entry.data
  }
}
