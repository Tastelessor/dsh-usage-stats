/**
 * dsh-token-usage host half: aggregates token usage from persisted session
 * logs and serves it as JSON over a plugin-owned HTTP route.
 *
 * Session reads avoid the sessionQuery replay-validation path: live sessions
 * are read straight from the in-memory store (frozen events), and persisted
 * sessions are pruned by log file mtime before a direct persistence read.
 * @module dsh-token-usage/host
 */

import type { Context } from '@deepseek-ai/cordis'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { stat } from 'node:fs/promises'
import { installSettingsSection, type SettingsPathOp, type SettingsProvider } from '@deepseek-ai/dsh-settings'
// Type-only: loads the cordis Context augmentation for ctx.sessionQuery and
// the host SessionStore contract for ctx.sessions (the client-runtime
// ISessions face shadows `sessions` in this mixed program, so the live store
// access is narrowed explicitly below).
import type {} from '@deepseek-ai/dsh-session-query'
import type { SessionStore } from '@deepseek-ai/dsh-session'
// Loads the '@deepseek-ai/cordis' Context augmentation that types ctx.webServer.
import type {} from '@deepseek-ai/dsh-host-webserver'
import { ConfigSchema, NS, resolveCurrency, resolvePriceTables, type Config } from './config.ts'
import { UsageIndexer, type SessionSource } from './indexer.ts'
import { createStatsHandler } from './stats-route.ts'
import { createPricesHandler, mergePrices } from './prices-route.ts'
import type { Currency, TieredModelPrice } from '../shared/types.ts'

export const name = 'dsh-token-usage'

/** Host services this plugin depends on (sessions rides sessionQuery's own inject). */
export const inject = ['llm', 'sessionQuery', 'webServer', 'sessions']

export function apply(ctx: Context, config: Config): void {
  // Resolved-config source: starts as the composition entry; the settings
  // wiring swaps it to the live scope while a settings service is mounted.
  let current: () => Config = () => config
  installSettingsSection(ctx, NS, ConfigSchema, config, {
    setSource: (source) => {
      current = source
    },
    onChange: () => {},
  })
  const llm = ctx.llm
  const sessionQuery = ctx.sessionQuery
  const priceTables = (): ReturnType<typeof resolvePriceTables> => resolvePriceTables(current())

  // Short-lived response cache: repeat views are instant, and any settings
  // write for this namespace drops it immediately.
  const CACHE_TTL_MS = 30_000
  let cacheLatest: { at: number; payload: string } | undefined
  ctx.on('settings/updated', (ns) => {
    if (ns === NS) cacheLatest = undefined
  })

  // Price write-back: the browser posts the edited currency's overlay here
  // (the api-proxy refuses external-plugin namespaces to web clients), and we
  // merge it over the resolved config and persist through the settings seam
  // in-process. Non-catalog models and the untouched currency survive because
  // the merge starts from the resolved models dict, not the browser's view.
  const writePrices = async (currency: Currency, prices: Record<string, TieredModelPrice>): Promise<void> => {
    const settings = ctx.get('settings') as SettingsProvider | undefined
    if (settings === undefined) throw new Error('settings service is unavailable')
    const models = mergePrices(current().models, currency, prices)
    const op: SettingsPathOp = { op: 'set', path: ['models'], value: models }
    await settings.mutate(NS, [op])
    // Our own write invalidates the aggregation cache immediately; the
    // settings/updated listener would also do it, but being explicit here
    // keeps the next fetch correct even if the event fan-out is delayed.
    cacheLatest = undefined
  }

  const dshHomePath = ctx.get('dshHomePath') as ((...segments: string[]) => string) | undefined
  const indexFile = (): string => dshHomePath !== undefined
    ? join(dshHomePath('dsh-token-usage'), 'index.json')
    : join(homedir(), '.dsh', 'dsh-token-usage', 'index.json')

  const listSessions = async (): Promise<readonly SessionSource[]> => {
    const records = await sessionQuery.listSessions()
    const persistence = ctx.get('sessionPersistence')
    const sources: SessionSource[] = []
    for (const record of records) {
      let mtimeMs: number | undefined
      if (!record.live && persistence !== undefined) {
        try {
          const location = persistence.locate(record.header)
          if (location !== undefined) {
            const identity = await stat(location.path)
            mtimeMs = identity.mtimeMs
          }
        } catch {
          // pruning unavailable for this session; fall back to reading it
        }
      }
      sources.push({ id: record.header.id, createdAt: record.header.createdAt, live: record.live, mtimeMs })
    }
    return sources
  }
  const loadEvents = async (source: SessionSource) => {
    const live = (ctx.sessions as unknown as SessionStore).get(source.id)
    if (live !== undefined) return live.events
    const persistence = ctx.get('sessionPersistence')
    if (persistence !== undefined) return (await persistence.inspect(source.id)).events
    return (await sessionQuery.readSession(source.id)).events
  }
  const indexer = new UsageIndexer({ listSessions, loadEvents, indexPath: indexFile })
  // Clear the indexer's persist timer when the plugin fiber unloads.
  ctx.effect(() => () => indexer.dispose(), 'dsh-token-usage: indexer dispose')

  const statsHandler = createStatsHandler({
    indexer,
    listProviders: () => llm.listProviders(),
    listModels: (provider) => llm.listModels(provider),
    pricesCny: () => priceTables().cny,
    pricesUsd: () => priceTables().usd,
    currency: () => resolveCurrency(current()),
    cache: {
      get: () => {
        if (cacheLatest === undefined || Date.now() - cacheLatest.at >= CACHE_TTL_MS) return undefined
        return cacheLatest.payload
      },
      set: (payload) => { cacheLatest = { at: Date.now(), payload } },
    },
  })
  const pricesHandler = createPricesHandler({ writePrices })

  // One prefix route dispatches the two plugin-owned endpoints: the stats
  // aggregation (GET) and the price write-back (POST).
  const route = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    let url: URL
    try {
      url = new URL(req.url ?? '/', 'http://dsh.internal')
    } catch {
      res.writeHead(400)
      res.end()
      return
    }
    if (req.method === 'GET' && url.pathname === '/dsh-token-usage/stats') return statsHandler(req, res)
    if (req.method === 'POST' && url.pathname === '/dsh-token-usage/prices') return pricesHandler(req, res)
    res.writeHead(404)
    res.end()
  }
  ctx.effect(
    () => ctx.webServer.register({ kind: 'prefix', path: '/dsh-token-usage', handler: route }),
    'dsh-token-usage: stats and prices routes',
  )
  ctx.logger.info('dsh-token-usage: host half loaded')
}
