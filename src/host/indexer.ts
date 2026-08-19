/**
 * Incremental per-session usage index. Folds model-call samples into
 * day × tier(peak/offPeak) × model cells so a query aggregates in-memory
 * buckets instead of re-parsing session logs. Persisted sessions are only
 * re-read when their log mtime changes; the index itself is snapshot to a
 * JSON file (atomic tmp+rename) for restart reuse.
 *
 * The model key inside a cell is the composite `provider\u0000model` so
 * unpriced-model reporting keeps both halves.
 */

import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type { Tier, TokenTotals } from '../shared/types.ts'
import { localDayKey } from './aggregate.ts'
import type { UsageSample } from './aggregate.ts'
import { tierOf } from './prices.ts'
import { usageSamplesOf } from './samples.ts'

/** Composite key: `provider\u0000model`. */
export function modelKey(provider: string, model: string): string {
  return `${provider}\u0000${model}`
}

/** One day's token totals per tier, per model. */
export interface DayCell {
  peak: Map<string, TokenTotals>
  offPeak: Map<string, TokenTotals>
}

/** One session's index entry; `mtimeMs` is the persisted log's mtime (undefined for live). */
export interface SessionIndexEntry {
  mtimeMs: number | undefined
  days: Map<string, DayCell>
}

export type EntriesById = Map<SessionId, SessionIndexEntry>

export function emptyTotals(): TokenTotals {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, total: 0 }
}

function rowTarget(cell: DayCell, tier: Tier, key: string): TokenTotals {
  const map = tier === 'peak' ? cell.peak : cell.offPeak
  let totals = map.get(key)
  if (totals === undefined) {
    totals = emptyTotals()
    map.set(key, totals)
  }
  return totals
}

/** Fold one model-call sample into its day × tier × model cell. */
export function foldSample(entry: SessionIndexEntry, sample: UsageSample): void {
  const date = localDayKey(sample.time)
  let cell = entry.days.get(date)
  if (cell === undefined) {
    cell = { peak: new Map(), offPeak: new Map() }
    entry.days.set(date, cell)
  }
  const usage = sample.usage
  const t = rowTarget(cell, tierOf(sample.time), modelKey(sample.provider, sample.model))
  t.input += usage.inputTokens
  t.output += usage.outputTokens
  t.cacheRead += usage.cacheReadTokens ?? 0
  t.cacheWrite += usage.cacheWriteTokens ?? 0
  t.reasoning += usage.reasoningTokens ?? 0
  t.total += usage.inputTokens + usage.outputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
}

/** Fold a batch of samples into an existing entry (mutating, returns it). */
export function foldSamples(entry: SessionIndexEntry, samples: readonly UsageSample[]): SessionIndexEntry {
  for (const sample of samples) foldSample(entry, sample)
  return entry
}

/** Fold raw session events (usage-bearing assistant/message only) into a fresh entry. */
export function indexFromEvents(events: readonly SessionEvent[]): SessionIndexEntry {
  return foldSamples({ mtimeMs: undefined, days: new Map() }, usageSamplesOf(events))
}

/** On-disk snapshot shape (plain JSON-serializable; Maps flattened to Records). */
export interface IndexFileShape {
  version: 1
  writtenAt: number
  sessions: Record<string, {
    mtimeMs: number | null
    days: Record<string, { peak: Record<string, TokenTotals>; offPeak: Record<string, TokenTotals> }>
  }>
}

export const INDEX_VERSION = 1 as const

export function serializeEntries(entries: EntriesById, writtenAt: number): IndexFileShape {
  const sessions: IndexFileShape['sessions'] = {}
  for (const [id, entry] of entries) {
    const days: IndexFileShape['sessions'][string]['days'] = {}
    for (const [date, cell] of entry.days) {
      days[date] = { peak: Object.fromEntries(cell.peak), offPeak: Object.fromEntries(cell.offPeak) }
    }
    sessions[id] = { mtimeMs: entry.mtimeMs ?? null, days }
  }
  return { version: INDEX_VERSION, writtenAt, sessions }
}

/** Parse a snapshot; throws on wrong version or malformed JSON. */
export function parseIndexFile(text: string): EntriesById {
  const raw = JSON.parse(text) as IndexFileShape
  if (raw.version !== INDEX_VERSION) throw new Error(`index version mismatch: ${raw.version}`)
  const entries: EntriesById = new Map()
  for (const [id, session] of Object.entries(raw.sessions ?? {})) {
    const days = new Map<string, DayCell>()
    for (const [date, cell] of Object.entries(session.days ?? {})) {
      days.set(date, { peak: new Map(Object.entries(cell.peak ?? {})), offPeak: new Map(Object.entries(cell.offPeak ?? {})) })
    }
    entries.set(id as SessionId, { mtimeMs: session.mtimeMs ?? undefined, days })
  }
  return entries
}

/** Load a snapshot; missing or unreadable file yields an empty index (never throws). */
export async function loadIndexFile(filePath: string): Promise<EntriesById> {
  try {
    return parseIndexFile(await readFile(filePath, 'utf8'))
  } catch {
    return new Map()
  }
}

/** Atomic write: mkdir -p, temp file, rename over the target. */
export async function saveIndexFile(filePath: string, entries: EntriesById): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`
  try {
    await writeFile(tmp, JSON.stringify(serializeEntries(entries, Date.now())))
    await rename(tmp, filePath)
  } catch (error) {
    await unlink(tmp).catch(() => {})
    throw error
  }
}

/** Run fn over items with at most `limit` in flight, preserving order. */
export function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0
  const workerCount = Math.max(1, Math.min(limit, items.length))
  const workers = Array.from({ length: workerCount }, async () => {
    for (;;) {
      const index = cursor
      cursor += 1
      if (index >= items.length) return
      results[index] = await fn(items[index] as T)
    }
  })
  return Promise.all(workers).then(() => results)
}