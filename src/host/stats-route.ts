/**
 * HTTP handler for GET /dsh-token-usage/stats. Composes the page payload from
 * the incremental UsageIndexer (mtime-reconciled, in-memory day buckets):
 * zero-filled day buckets over [min(month 1st, week Monday) .. now], the
 * today/week/month window summaries, and the llm catalog joined with both
 * currencies' prices.
 *
 * Session reads happen inside the indexer; per-session failures are contained
 * there (a broken log never fails the page). A whole-page response cache
 * (30s, injected) absorbs repeat views; a settings write clears it.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { LlmModelInfo, LlmProviderInfo } from '@deepseek-ai/dsh-llm'
import type { Currency, ModelPriceRow, StatsResponse, TieredModelPrice } from '../shared/types.ts'
import { aggregateEntries, rangeFromMs } from './aggregate.ts'
import type { UsageIndexer } from './indexer.ts'

export { mapLimit } from './indexer.ts'
export type { SessionSource } from './indexer.ts'

/** Everything the route needs from the host; faked directly in tests. */
export interface StatsDeps {
  indexer: UsageIndexer
  listProviders(): readonly LlmProviderInfo[]
  listModels(provider: string): Promise<readonly LlmModelInfo[]>
  pricesCny(): Readonly<Record<string, TieredModelPrice>>
  pricesUsd(): Readonly<Record<string, TieredModelPrice>>
  currency(): Currency
  now?(): number
  /** Optional whole-page cache; a hit skips the entire pipeline. */
  cache?: {
    get(): string | undefined
    set(payload: string): void
  }
}

const RESPONSE_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
} as const

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
      res.writeHead(405, { allow: 'GET', 'content-type': 'text/plain; charset=utf-8' })
      res.end()
      return
    }
    const cached = deps.cache?.get()
    if (cached !== undefined) {
      res.writeHead(200, RESPONSE_HEADERS)
      res.end(cached)
      return
    }

    const now = deps.now?.() ?? Date.now()
    const fromMs = rangeFromMs(now)
    await deps.indexer.reconcile()

    const pricesCny = deps.pricesCny()
    const pricesUsd = deps.pricesUsd()
    const aggregation = aggregateEntries(deps.indexer.entries, { cny: pricesCny, usd: pricesUsd }, fromMs, now, now)
    const models = await modelRows(deps.listProviders(), deps.listModels, pricesCny, pricesUsd)

    const body: StatsResponse = {
      from: fromMs,
      to: now,
      generatedAt: now,
      currency: deps.currency(),
      buckets: aggregation.buckets,
      windows: aggregation.windows,
      models,
      unpricedModels: aggregation.unpricedModels,
    }
    const payload = JSON.stringify(body)
    deps.cache?.set(payload)
    deps.indexer.persist()
    res.writeHead(200, RESPONSE_HEADERS)
    res.end(payload)
  }
}