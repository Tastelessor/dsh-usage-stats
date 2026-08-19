/**
 * Monthly token-usage heatmap, GitHub-contribution style: one cell per day of
 * the current month, columns aligned to ISO weekdays (Mon first), color depth
 * by relative quartile of the month's busiest day, and a hover tooltip with
 * the day's full breakdown. Cells after today render as future placeholders.
 */
import { useState } from 'react'
import type { DayBucket } from '../shared/types.ts'

export interface HeatmapProps {
  buckets: readonly DayBucket[]
  /** Reference instant (the response's `to`); the month grid derives from it. */
  to: number
  t: (key: string) => any
}

const formatTokens = (value: number): string => {
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}k`
  return String(value)
}

const pad = (n: number): string => String(n).padStart(2, '0')

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
  const year = now.getFullYear()
  const month = now.getMonth()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7 // Mon=0

  const byDate = new Map(buckets.filter(b => {
    const [y, m] = b.date.split('-').map(Number)
    return y === year && m === month + 1
  }).map(b => [b.date, b]))
  const todayKey = `${year}-${pad(month + 1)}-${pad(now.getDate())}`
  const max = Math.max(0, ...[...byDate.values()].map(b => b.tokens.total))

  const cells: JSX.Element[] = []
  for (let i = 0; i < firstWeekday; i++) cells.push(<div key={`blank-${i}`} className="hm-blank" />)
  for (let day = 1; day <= daysInMonth; day++) {
    const key = `${year}-${pad(month + 1)}-${pad(day)}`
    if (key > todayKey) {
      cells.push(<div key={key} className="hm-cell hm-future" data-date={key} />)
      continue
    }
    const bucket = byDate.get(key)
    const total = bucket?.tokens.total ?? 0
    const level = levelOf(total, max)
    const cellProps = bucket === undefined ? {} : {
      onMouseEnter: (event: React.MouseEvent<HTMLDivElement>) => setHovered(bucket),
      onMouseLeave: () => setHovered(null),
    }
    cells.push(
      <div key={key} className={`hm-cell hm-l${level}${key === todayKey ? ' hm-today' : ''}`}
        data-date={key} {...cellProps} />,
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
      <div className="heatmap-grid">
        {WEEK_LABELS.map(label => <div key={label} className="hm-weekday">{label}</div>)}
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