/**
 * HTTP handler for GET /dsh-token-usage/stats?days=7|15|30. Composes the
 * page payload: aggregated buckets + totals (CNY and USD), the llm model
 * catalog joined with both currencies' prices, and unpriced-but-used models.
 *
 * Session reads are the hot path: the handler resolves lightweight sources
 * first (headers + a file-mtime hint), skips persisted sessions whose log has
 * not been touched inside the window, and loads the remaining logs with a
 * bounded worker pool. Per-session read failures are contained (skipped);
 * one bad session never fails the page.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { LlmModelInfo, LlmProviderInfo } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { Currency, ModelPriceRow, StatsResponse, TieredModelPrice } from '../shared/types.ts'
import { aggregateUsage, windowStartMs } from './aggregate.ts'
import { usageSamplesOf } from './samples.ts'
import { mapLimit } from './indexer.ts'

export { mapLimit }

/** One candidate session resolved without loading its log. */
export interface SessionSource {
  id: SessionId
  createdAt: number
  /** Whether the session currently exists live (in-memory); live sources are never mtime-pruned. */
  live: boolean
  /**
   * Persisted log file mtime, when the persistence backend can resolve an
   * artifact path. A persisted source whose mtime predates the window start
   * cannot contain in-window events and is skipped without a log read.
   */
  mtimeMs?: number
}

/** Everything the route needs from the host; faked directly in tests. */
export interface StatsDeps {
  /** Resolve all candidate sessions (headers + live flag + mtime hint). */
  listSessions(): Promise<readonly SessionSource[]>
  /** Load one candidate's complete raw event log; a throw skips the session. */
  loadEvents(source: SessionSource): Promise<readonly SessionEvent[]>
  listProviders(): readonly LlmProviderInfo[]
  listModels(provider: string): Promise<readonly LlmModelInfo[]>
  pricesCny(): Readonly<Record<string, TieredModelPrice>>
  pricesUsd(): Readonly<Record<string, TieredModelPrice>>
  currency(): Currency
  now?(): number
  /** Max concurrent session log loads; default 8. */
  concurrency?(): number
  /** Optional TTL cache keyed by window length; returns the cached JSON payload or undefined. */
  cache?: {
    get(days: number): string | undefined
    set(days: number, payload: string): void
  }
}

const DAY_CHOICES = new Set([7, 15, 30])
const DEFAULT_CONCURRENCY = 8

const RESPONSE_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
} as const

/** Parse ?days= into one of 7/15/30; anything else (including absent) → 7. */
export function parseDays(raw: string | null): number {
  if (raw === null) return 7
  const value = Number(raw)
  return DAY_CHOICES.has(value) ? value : 7
}

/** Join the llm catalog with both currency price tables into display rows. */
export function modelRows(
  providers: readonly LlmProviderInfo[],
  listModels: (provider: string) => Promise<readonly LlmModelInfo[]>,
  pricesCny: Readonly<Record<string, TieredModelPrice>>,
  pricesUsd: Readonly<Record<string, TieredModelPrice>>,
): Promise<ModelPriceRow[]> {
  return Promise.all(providers.map(async (provider) => {
    let models: readonly LlmModelInfo[]
    try {
      models = await listModels(provider.id)
    } catch {
      models = []
    }
    return models.map((model) => ({
      provider: provider.id,
      model: model.id,
      name: model.name,
      cny: pricesCny[model.id] ?? null,
      usd: pricesUsd[model.id] ?? null,
    }))
  })).then(rows => rows.flat())
}

/** Build the handler bound to one deps snapshot. */
export function createStatsHandler(deps: StatsDeps): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    if (req.method !== 'GET') {
      res.writeHead(405, {
        allow: 'GET',
        'content-type': 'text/plain; charset=utf-8',
      })
      res.end()
      return
    }
    let url: URL
    try {
      url = new URL(req.url ?? '/', 'http://dsh.internal')
    } catch {
      res.writeHead(400)
      res.end()
      return
    }
    const days = parseDays(url.searchParams.get('days'))

    const cached = deps.cache?.get(days)
    if (cached !== undefined) {
      res.writeHead(200, RESPONSE_HEADERS)
      res.end(cached)
      return
    }

    const now = deps.now?.() ?? Date.now()
    const fromMs = windowStartMs(now, days)
    let sources: readonly SessionSource[]
    try {
      sources = await deps.listSessions()
    } catch {
      sources = []
    }
    const candidates = sources.filter(source =>
      source.createdAt <= now
      && (source.live || source.mtimeMs === undefined || source.mtimeMs >= fromMs))

    const concurrency = deps.concurrency?.() ?? DEFAULT_CONCURRENCY
    const loaded = await mapLimit(candidates, concurrency, async (source) => {
      try {
        return usageSamplesOf(await deps.loadEvents(source))
      } catch {
        return [] // one broken session must not fail the page
      }
    })

    const pricesCny = deps.pricesCny()
    const pricesUsd = deps.pricesUsd()
    const aggregation = aggregateUsage(loaded.flat(), { cny: pricesCny, usd: pricesUsd }, days, now)
    const providers = deps.listProviders()
    const models = await modelRows(providers, deps.listModels, pricesCny, pricesUsd)

    const body: StatsResponse = {
      days,
      from: fromMs,
      to: now,
      generatedAt: now,
      currency: deps.currency(),
      buckets: aggregation.buckets,
      totals: aggregation.totals,
      models,
      unpricedModels: aggregation.unpricedModels,
    }
    const payload = JSON.stringify(body)
    deps.cache?.set(days, payload)
    res.writeHead(200, RESPONSE_HEADERS)
    res.end(payload)
  }
}
