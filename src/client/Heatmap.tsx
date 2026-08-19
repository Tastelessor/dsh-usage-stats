/**
 * Token-usage heatmap, GitHub-contribution style, over the last 3 calendar
 * months: one column per week (Mon-first), one row per weekday with labels on
 * the left, month captions spanning their weeks above the strip. Color depth
 * is the relative quartile of the window's busiest day, and each cell has a
 * hover tooltip with the day's full breakdown. Cell size is uniform across
 * all three months by construction: every column is an equal 1fr track, so a
 * wider month range yields consistently sized cells instead of a few giant
 * month-only squares.
 */
import { useState } from 'react'
import type { DayBucket } from '../shared/types.ts'

export interface HeatmapProps {
  buckets: readonly DayBucket[]
  /** Reference instant (the response's `to`); the 3-month grid derives from it. */
  to: number
  t: (key: string) => any
}

const DAY_MS = 86_400_000

const formatTokens = (value: number): string => {
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}k`
  return String(value)
}

const pad = (n: number): string => String(n).padStart(2, '0')

/** Local calendar date key, 'YYYY-MM-DD' (mirrors the host aggregation). */
const dayKey = (ms: number): string => {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Local midnight of an instant. */
const dayStart = (ms: number): number => {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** 1..4 relative quartile level, or 0 for no usage. */
function levelOf(total: number, max: number): number {
  if (total <= 0 || max <= 0) return 0
  const ratio = total / max
  if (ratio > 0.75) return 4
  if (ratio > 0.5) return 3
  if (ratio > 0.25) return 2
  return 1
}

const WEEK_LABELS = ['一', '二', '三', '四', '五', '六', '日']

export function Heatmap({ buckets, to, t }: HeatmapProps): JSX.Element {
  const [hovered, setHovered] = useState<DayBucket | null>(null)

  const now = new Date(to)
  // The 3 calendar months ending with the reference month (JS Date rolls
  // negative months across the year boundary automatically).
  const start = new Date(now.getFullYear(), now.getMonth() - 2, 1)
  const firstMs = dayStart(start.getTime())
  const lastMs = dayStart(now.getTime())
  const totalDays = Math.round((lastMs - firstMs) / DAY_MS) + 1
  const firstWeekday = (start.getDay() + 6) % 7 // Mon=0
  const weeks = Math.ceil((firstWeekday + totalDays) / 7)

  const byDate = new Map(buckets.map(b => [b.date, b]))
  const todayKey = dayKey(now.getTime())
  const max = Math.max(0, ...[...byDate.values()].map(b => b.tokens.total))

  const months = [0, 1, 2].map(offset => {
    const monthStart = new Date(now.getFullYear(), now.getMonth() - 2 + offset, 1)
    const y = monthStart.getFullYear()
    const m = monthStart.getMonth()
    const daysInMonth = new Date(y, m + 1, 0).getDate()
    const firstDayIndex = Math.round((monthStart.getTime() - firstMs) / DAY_MS)
    const lastDayIndex = Math.min(firstDayIndex + daysInMonth - 1, totalDays - 1)
    return {
      label: `${y}-${pad(m + 1)}`,
      colStart: Math.floor((firstWeekday + firstDayIndex) / 7),
      colEnd: Math.floor((firstWeekday + lastDayIndex) / 7),
    }
  })

  const cells: JSX.Element[] = []
  for (let d = 0; d < totalDays; d++) {
    const ms = firstMs + d * DAY_MS
    const key = dayKey(ms)
    const bucket = byDate.get(key)
    const total = bucket?.tokens.total ?? 0
    const level = levelOf(total, max)
    const weekday = (firstWeekday + d) % 7
    const col = Math.floor((firstWeekday + d) / 7)
    const cellProps = bucket === undefined ? {} : {
      onMouseEnter: (event: React.MouseEvent<HTMLDivElement>) => setHovered(bucket),
      onMouseLeave: () => setHovered(null),
    }
    cells.push(
      <div key={key} className={`hm-cell hm-l${level}${key === todayKey ? ' hm-today' : ''}`}
        data-date={key} style={{ gridRow: weekday + 2, gridColumn: col + 2 }} {...cellProps} />,
    )
  }

  const hitRate = (b: DayBucket): number => {
    const prompt = b.tokens.input + b.tokens.cacheRead + b.tokens.cacheWrite
    return prompt > 0 ? b.tokens.cacheRead / prompt : 0
  }
  const money = (b: DayBucket): string =>
    `${b.amountCny === null ? '—' : `¥${b.amountCny.toFixed(2)}`} / ${b.amountUsd === null ? '—' : `$${b.amountUsd.toFixed(2)}`}`

  return (
    <div className="heatmap-wrap">
      <div className="heatmap-head">
        <span className="heatmap-title">{t('heatmapTitle')}</span>
        <span className="heatmap-legend">
          <span>{t('heatmapLess')}</span>
          {[1, 2, 3, 4].map(l => <span key={l} className={`hm-swatch hm-l${l}`} />)}
          <span>{t('heatmapMore')}</span>
        </span>
      </div>
      <div className="heatmap-grid" style={{ gridTemplateColumns: `14px repeat(${weeks}, 1fr)` }}>
        {months.map((m, i) => (
          <div key={m.label} className="hm-month-label"
            style={{ gridRow: 1, gridColumn: `${m.colStart + 2} / ${m.colEnd + 3}` }}>
            {m.label}
          </div>
        ))}
        {WEEK_LABELS.map((label, i) => (
          <div key={label} className="hm-weekday" style={{ gridRow: i + 2, gridColumn: 1 }}>{label}</div>
        ))}
        {cells}
      </div>
      {hovered !== null && (
        <div className="hm-tooltip">
          <div className="hm-tooltip-title">{hovered.date}</div>
          <div className="hm-tooltip-row">{t('hmTotal')}: {formatTokens(hovered.tokens.total)}</div>
          <div className="hm-tooltip-row">{t('hmInputMiss')}: {formatTokens(hovered.tokens.input)}</div>
          <div className="hm-tooltip-row">{t('hmInputHit')}: {formatTokens(hovered.tokens.cacheRead)}</div>
          <div className="hm-tooltip-row">{t('hmOutput')}: {formatTokens(hovered.tokens.output)}</div>
          <div className="hm-tooltip-row">{t('hmHitRate')}: {(hitRate(hovered) * 100).toFixed(1)}%</div>
          <div className="hm-tooltip-row">{t('hmAmount')}: {money(hovered)}</div>
        </div>
      )}
    </div>
  )
}