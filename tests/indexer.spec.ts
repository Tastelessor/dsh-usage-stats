/** Index folding: day×tier×model cells, serialization round-trip, atomic save. */
import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  foldSamples, indexFromEvents, loadIndexFile, parseIndexFile, saveIndexFile,
  serializeEntries, mapLimit, UsageIndexer, type EntriesById, type SessionIndexEntry,
  type SessionSource,
} from '../src/host/indexer.ts'
import type { UsageSample } from '../src/host/aggregate.ts'
import type { SessionId } from '@deepseek-ai/dsh-session'

const MODEL = 'deepseek-v4-flash'
const KEY = `deepseek-official\u0000${MODEL}`
const sample = (time: number, usage: Record<string, number>): UsageSample => ({
  time, provider: 'deepseek-official', model: MODEL,
  usage: { inputTokens: 0, outputTokens: 0, ...usage },
})

// Beijing 09:30 → peak；Beijing 04:00 → offPeak
const PEAK = Date.UTC(2026, 7, 18, 1, 30, 0)
const OFF = Date.UTC(2026, 7, 17, 20, 0, 0)

describe('foldSamples', () => {
  it('accumulates into peak/offPeak cells per local day and model', () => {
    const entry: SessionIndexEntry = { mtimeMs: 1, days: new Map() }
    foldSamples(entry, [
      sample(PEAK, { inputTokens: 1_000_000, outputTokens: 500_000 }),
      sample(OFF, { inputTokens: 2_000_000, cacheReadTokens: 3_000_000 }),
    ])
    const day = entry.days.get('2026-08-18')!
    expect(day.peak.get(KEY)).toMatchObject({ input: 1_000_000, output: 500_000, total: 1_500_000 })
    expect(day.offPeak.get(KEY)).toMatchObject({ input: 2_000_000, cacheRead: 3_000_000, total: 5_000_000 })
    // 同一批样本折叠两次 = 同一份事件的两次积累（增量重读语义：不是幂等清零，而是事件确实出现了两次）
    foldSamples(entry, [
      sample(PEAK, { inputTokens: 1_000_000, outputTokens: 500_000 }),
      sample(OFF, { inputTokens: 2_000_000, cacheReadTokens: 3_000_000 }),
    ])
    expect(day.peak.get(KEY)).toMatchObject({ input: 2_000_000, output: 1_000_000, total: 3_000_000 })
    expect(day.offPeak.get(KEY)).toMatchObject({ input: 4_000_000, cacheRead: 6_000_000, total: 10_000_000 })
  })

  it('fills reasoning without double counting total', () => {
    const entry: SessionIndexEntry = { mtimeMs: 0, days: new Map() }
    foldSamples(entry, [sample(PEAK, { outputTokens: 1_000_000, reasoningTokens: 900_000 })])
    const cell = [...entry.days.values()][0]!.peak.get(KEY)!
    expect(cell.reasoning).toBe(900_000)
    expect(cell.total).toBe(1_000_000)
  })
})

describe('indexFromEvents', () => {
  it('extracts usage-bearing assistant/message events and folds them', () => {
    const entry = indexFromEvents([{
      type: 'assistant/message', seq: 0, time: PEAK,
      data: {
        usage: { inputTokens: 10, outputTokens: 5 },
        message: { source: { kind: 'model', provider: 'deepseek-official', model: MODEL } },
      },
    }] as never)
    const cell = entry.days.get('2026-08-18')?.peak.get(KEY)
    expect(cell).toMatchObject({ input: 10, output: 5, total: 15 })
  })
})

describe('serialization round-trip', () => {
  it('serialize → parse preserves cells, models, and mtime', () => {
    const entries: EntriesById = new Map()
    const entry: SessionIndexEntry = { mtimeMs: 42, days: new Map() }
    foldSamples(entry, [sample(PEAK, { inputTokens: 7 })])
    entries.set('s-1' as SessionId, entry)
    const parsed = parseIndexFile(JSON.stringify(serializeEntries(entries, 123)))
    const restored = parsed.get('s-1' as SessionId)!
    expect(restored.mtimeMs).toBe(42)
    expect(restored.days.get('2026-08-18')?.peak.get(KEY)?.input).toBe(7)
  })

  it('rejects a wrong version or malformed json', () => {
    expect(() => parseIndexFile('{"version":99,"writtenAt":0,"sessions":{}}')).toThrow()
    expect(() => parseIndexFile('not json')).toThrow()
  })
})

describe('load/saveIndexFile', () => {
  it('returns an empty map for a missing or corrupt file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-tu-index-'))
    try {
      expect((await loadIndexFile(join(dir, 'missing.json'))).size).toBe(0)
      await writeFile(join(dir, 'corrupt.json'), 'garbage')
      expect((await loadIndexFile(join(dir, 'corrupt.json'))).size).toBe(0)
    } finally { await rm(dir, { recursive: true, force: true }) }
  })

  it('writes atomically and round-trips through the real filesystem', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-tu-index-'))
    try {
      const file = join(dir, 'index.json')
      const entries: EntriesById = new Map()
      const entry: SessionIndexEntry = { mtimeMs: 9, days: new Map() }
      foldSamples(entry, [sample(OFF, { outputTokens: 3 })])
      entries.set('s-2' as SessionId, entry)
      await saveIndexFile(file, entries)
      expect(await readFile(file, 'utf8')).toContain('"version":1')
      const restored = await loadIndexFile(file)
      expect(restored.get('s-2' as SessionId)?.days.get('2026-08-18')?.offPeak.get(KEY)?.output).toBe(3)
      const leftovers = (await (await import('node:fs/promises')).readdir(dir)).filter(n => n.endsWith('.tmp'))
      expect(leftovers).toHaveLength(0)
    } finally { await rm(dir, { recursive: true, force: true }) }
  })
})

describe('mapLimit', () => {
  it('runs with bounded concurrency and preserves order', async () => {
    let inFlight = 0
    let peak = 0
    const out = await mapLimit([1, 2, 3, 4, 5], 2, async (n) => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await new Promise(resolve => setTimeout(resolve, 5))
      inFlight -= 1
      return n * 2
    })
    expect(out).toEqual([2, 4, 6, 8, 10])
    expect(peak).toBe(2)
  })
})

const NOW = new Date('2026-08-19T10:00:00').getTime()
const EVENT = {
  type: 'assistant/message', seq: 0, time: Date.UTC(2026, 7, 18, 1, 0, 0),
  data: {
    usage: { inputTokens: 100, outputTokens: 0 },
    message: { source: { kind: 'model', provider: 'deepseek-official', model: MODEL } },
  },
} as never

/** 每个实例一个独立 tmp 目录，避免落盘文件跨用例串扰。 */
function makeIndexer(
  sources: SessionSource[],
  loadEvents: (s: SessionSource) => unknown[],
  opts: Partial<ConstructorParameters<typeof UsageIndexer>[0]> = {},
): UsageIndexer {
  return new UsageIndexer({
    listSessions: async () => sources,
    loadEvents: async (s) => loadEvents(s) as never,
    indexPath: () => join(mkdtempSync(join(tmpdir(), 'dsh-tu-idx-')), 'index.json'),
    now: () => NOW,
    ...opts,
  })
}

describe('UsageIndexer', () => {
  it('reloads only sessions whose mtime changed', async () => {
    const sources: SessionSource[] = [
      { id: 'p1' as never, createdAt: 0, live: false, mtimeMs: 10 },
      { id: 'p2' as never, createdAt: 0, live: false, mtimeMs: 20 },
    ]
    const readIds: string[] = []
    const indexer = makeIndexer(sources, (s) => { readIds.push(String(s.id)); return [EVENT] })
    await indexer.reconcile()
    expect(readIds).toEqual(['p1', 'p2'])
    // p1 未变；p2 的日志 mtime 20 → 30 → 只重读 p2
    sources[1] = { id: 'p2' as never, createdAt: 0, live: false, mtimeMs: 30 }
    await indexer.reconcile()
    expect(readIds).toEqual(['p1', 'p2', 'p2'])
  })

  it('reads live sessions fresh on every reconcile', async () => {
    let version = 1
    const indexer = makeIndexer(
      [{ id: 'live-1' as never, createdAt: 0, live: true }],
      () => [{
        type: 'assistant/message' as const, seq: 0, time: Date.UTC(2026, 7, 18, 1, 0, 0),
        data: {
          usage: { inputTokens: version * 100, outputTokens: 0 },
          message: { source: { kind: 'model', provider: 'deepseek-official', model: MODEL } },
        },
      }],
    )
    await indexer.reconcile()
    const first = [...indexer.entries.values()][0]!.days.get('2026-08-18')?.peak.get(KEY)?.input
    version = 2
    await indexer.reconcile()
    const second = [...indexer.entries.values()][0]!.days.get('2026-08-18')?.peak.get(KEY)?.input
    expect(first).toBe(100)
    expect(second).toBe(200)
  })

  it('drops sessions that no longer exist after a later reconcile', async () => {
    const sources: SessionSource[] = [{ id: 'gone' as never, createdAt: 0, live: false, mtimeMs: 1 }]
    const indexer = makeIndexer(sources, () => [EVENT])
    await indexer.reconcile()
    expect(indexer.entries.has('gone' as never)).toBe(true)
    sources.length = 0
    await indexer.reconcile()
    expect(indexer.entries.has('gone' as never)).toBe(false)
  })

  it('prunes days older than the horizon', async () => {
    const indexer = makeIndexer(
      [{ id: 'old' as never, createdAt: 0, live: false, mtimeMs: 1 }],
      () => [{
        type: 'assistant/message' as const, seq: 0, time: new Date('2026-03-01T12:00:00').getTime(),
        data: { usage: { inputTokens: 1, outputTokens: 0 }, message: { source: { kind: 'model', provider: 'p', model: 'm' } } },
      }],
    )
    await indexer.reconcile()
    // 3 个月窗口起点 06-01，水平线 = 06-01 − 45 天 = 04-17；03-01 早于水平线 → 剪掉
    expect([...indexer.entries.values()][0]!.days.size).toBe(0)
  })

  it('restores entries from a persisted file and keeps them without reload', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-tu-idx-'))
    const file = join(dir, 'index.json')
    const entries: EntriesById = new Map()
    const entry: SessionIndexEntry = { mtimeMs: 7, days: new Map() }
    foldSamples(entry, [sample(PEAK, { inputTokens: 42 })])
    entries.set('p-restored' as SessionId, entry)
    await saveIndexFile(file, entries)

    const readIds: string[] = []
    const indexer = makeIndexer(
      [{ id: 'p-restored' as never, createdAt: 0, live: false, mtimeMs: 7 }],
      (s) => { readIds.push(String(s.id)); return [] },
      { indexPath: () => file },
    )
    await indexer.reconcile()
    expect(readIds).toEqual([]) // mtime 一致 → 直接用落盘内容
    expect([...indexer.entries.values()][0]!.days.get('2026-08-18')?.peak.get(KEY)?.input).toBe(42)
  })
})