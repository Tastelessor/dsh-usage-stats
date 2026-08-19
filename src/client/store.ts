/**
 * Token-usage page store: fetches the single stats payload over the
 * plugin-owned route and publishes a uSES-safe snapshot. The fetcher is
 * injectable for tests; the default hits the same-origin endpoint.
 */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { StatsResponse } from '../shared/types.ts'

export type TokenUsageStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface TokenUsageState {
  status: TokenUsageStatus
  error: string | null
  data: StatsResponse | null
}

/** Default fetcher: same-origin GET of the single stats endpoint. */
export async function defaultFetcher(): Promise<StatsResponse> {
  const response = await fetch('/dsh-token-usage/stats', { credentials: 'same-origin' })
  if (!response.ok) throw new Error(`token usage fetch failed: HTTP ${response.status}`)
  return response.json() as Promise<StatsResponse>
}

/** How long a cached payload stays fresh before the next load re-fetches it. */
const CACHE_TTL_MS = 30_000

/** The page controller (one per settings surface). */
export class TokenUsageStore {
  readonly store: SnapshotStore<TokenUsageState> = createSnapshotStore<TokenUsageState>({
    status: 'idle',
    error: null,
    data: null,
  })

  /** Latest load wins; an older response never overwrites a newer one. */
  private generation = 0
  private inflight: Promise<StatsResponse> | null = null
  private cachedEntry: { at: number; data: StatsResponse } | null = null

  constructor(private readonly fetcher: () => Promise<StatsResponse> = defaultFetcher) {}

  /** Load the page payload; a fresh cache entry serves it without a network round. */
  async load(): Promise<void> {
    const generation = ++this.generation
    const cached = this.cached()
    if (cached !== undefined) {
      this.store.update((s) => { s.status = 'ready'; s.error = null; s.data = cached })
      return
    }
    this.store.update((s) => { s.status = 'loading'; s.error = null })
    try {
      const data = await this.fetch()
      if (generation !== this.generation) return
      this.cachedEntry = { at: Date.now(), data }
      this.store.update((s) => { s.status = 'ready'; s.error = null; s.data = data })
    } catch (error) {
      if (generation !== this.generation) return
      this.store.update((s) => {
        s.status = 'error'
        s.error = error instanceof Error ? error.message : String(error)
      })
    }
  }

  /** Re-fetch, bypassing the cache. */
  refresh(): Promise<void> {
    this.cachedEntry = null
    return this.load()
  }

  /** Drop the cached payload (after a price save, so edits are never served stale). */
  clearCache(): void {
    this.cachedEntry = null
  }

  private async fetch(): Promise<StatsResponse> {
    if (this.inflight !== null) return this.inflight
    const request = this.fetcher().finally(() => { this.inflight = null })
    this.inflight = request
    return request
  }

  private cached(): StatsResponse | undefined {
    const entry = this.cachedEntry
    if (entry === null) return undefined
    if (Date.now() - entry.at >= CACHE_TTL_MS) {
      this.cachedEntry = null
      return undefined
    }
    return entry.data
  }
}