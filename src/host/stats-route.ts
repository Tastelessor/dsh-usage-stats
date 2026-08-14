/**
 * HTTP handler for GET /dsh-usage-stats/stats?days=7|15|30. Composes the
 * page payload: aggregated buckets + totals, the llm model catalog joined
 * with prices, and unpriced-but-used models. Per-session read failures are
 * contained (logged by the caller); one bad session never fails the page.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { LlmModelInfo, LlmProviderInfo } from '@deepseek-ai/dsh-llm'
import type { SessionLogSnapshot, SessionRecord } from '@deepseek-ai/dsh-session-query'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { ModelPrice, ModelPriceRow, StatsResponse } from '../shared/types.ts'
import type { Currency } from '../shared/types.ts'
import { aggregateUsage } from './aggregate.ts'
import { usageSamplesOf } from './samples.ts'

/** Everything the route needs from the host; faked directly in tests. */
export interface StatsDeps {
  listSessions(): Promise<readonly SessionRecord[]>
  readSession(sessionId: SessionId): Promise<SessionLogSnapshot>
  listProviders(): readonly LlmProviderInfo[]
  listModels(provider: string): Promise<readonly LlmModelInfo[]>
  prices(): Readonly<Record<string, ModelPrice>>
  currency(): Currency
  now?(): number
}

const DAY_CHOICES = new Set([7, 15, 30])

/** Parse ?days= into one of 7/15/30; anything else (including absent) → 7. */
export function parseDays(raw: string | null): number {
  if (raw === null) return 7
  const value = Number(raw)
  return DAY_CHOICES.has(value) ? value : 7
}

/** Join the llm catalog with the price table into display rows. */
export function modelRows(
  providers: readonly LlmProviderInfo[],
  listModels: (provider: string) => Promise<readonly LlmModelInfo[]>,
  prices: Readonly<Record<string, ModelPrice>>,
): Promise<ModelPriceRow[]> {
  return Promise.all(providers.map(async (provider) => {
    let models: readonly LlmModelInfo[]
    try {
      models = await listModels(provider.id)
    } catch {
      models = []
    }
    return models.map((model) => {
      const price = prices[model.id]
      return {
        provider: provider.id,
        model: model.id,
        name: model.name,
        inputPerM: price?.inputPerM ?? null,
        cacheReadPerM: price?.cacheReadPerM ?? null,
        outputPerM: price?.outputPerM ?? null,
        cacheWritePerM: price?.cacheWritePerM ?? null,
        priced: price !== undefined,
      }
    })
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

    const now = deps.now?.() ?? Date.now()
    const samples: ReturnType<typeof usageSamplesOf> = []
    let sessions: readonly SessionRecord[]
    try {
      sessions = await deps.listSessions()
    } catch {
      sessions = []
    }
    for (const record of sessions) {
      if (record.header.createdAt > now) continue // cannot contain in-range events
      try {
        const log = await deps.readSession(record.header.id)
        samples.push(...usageSamplesOf(log.events))
      } catch {
        continue // one broken session must not fail the page
      }
    }

    const prices = deps.prices()
    const aggregation = aggregateUsage(samples, prices, days, now)
    const providers = deps.listProviders()
    const models = await modelRows(providers, deps.listModels, prices)
    const from = aggregation.buckets[0] === undefined
      ? now
      : new Date(`${aggregation.buckets[0].date}T00:00:00`).getTime()

    const body: StatsResponse = {
      days,
      from,
      to: now,
      generatedAt: now,
      currency: deps.currency(),
      buckets: aggregation.buckets,
      totals: aggregation.totals,
      models,
      unpricedModels: aggregation.unpricedModels,
    }
    const payload = JSON.stringify(body)
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    })
    res.end(payload)
  }
}
