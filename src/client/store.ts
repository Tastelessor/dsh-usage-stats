/**
 * Usage-stats page store: fetches the host aggregation JSON over the
 * plugin-owned route and publishes a uSES-safe snapshot. The fetcher is
 * injectable for tests; the default hits the same-origin endpoint.
 */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { StatsResponse } from '../shared/types.ts'

export type UsageStatsStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface UsageStatsState {
  status: UsageStatsStatus
  error: string | null
  days: number
  data: StatsResponse | null
}

/** Default fetcher: same-origin GET, throws on non-2xx. */
export async function defaultFetcher(days: number): Promise<StatsResponse> {
  const response = await fetch(`/dsh-usage-stats/stats?days=${days}`, { credentials: 'same-origin' })
  if (!response.ok) throw new Error(`usage stats fetch failed: HTTP ${response.status}`)
  return response.json() as Promise<StatsResponse>
}

/** The page controller (one per settings surface). */
export class UsageStatsStore {
  readonly store: SnapshotStore<UsageStatsState> = createSnapshotStore<UsageStatsState>({
    status: 'idle',
    error: null,
    days: 7,
    data: null,
  })

  /** Latest load wins; an older response never overwrites a newer one. */
  private generation = 0

  constructor(private readonly fetcher: (days: number) => Promise<StatsResponse> = defaultFetcher) {}

  /** Fetch the given range; the snapshot carries the outcome. */
  async load(days: number): Promise<void> {
    const generation = ++this.generation
    this.store.update((s) => { s.status = 'loading'; s.error = null; s.days = days })
    try {
      const data = await this.fetcher(days)
      if (generation !== this.generation) return
      this.store.update((s) => { s.status = 'ready'; s.error = null; s.data = data })
    } catch (error) {
      if (generation !== this.generation) return
      this.store.update((s) => {
        s.status = 'error'
        s.error = error instanceof Error ? error.message : String(error)
      })
    }
  }

  /** Re-fetch the currently selected range. */
  refresh(): Promise<void> {
    return this.load(this.store.getSnapshot().days)
  }
}
