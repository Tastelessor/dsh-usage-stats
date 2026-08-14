/** Hand-drawn SVG line chart: one or more series, hover tooltip, zero dependencies. */
import { useState } from 'react'

export interface ChartSeries {
  /** Series name shown in the legend and tooltip. */
  name: string
  color: string
  points: readonly { label: string; value: number }[]
}

export interface LineChartProps {
  title: string
  series: readonly ChartSeries[]
  format: (value: number) => string
  height?: number
}

const WIDTH = 560
const PAD = { top: 16, right: 16, bottom: 28, left: 48 }

interface HoverState {
  index: number
  /** SVG-space x of the pointer. */
  x: number
  /** SVG-space y of the hovered point. */
  y: number
}

/** Render a multi-series SVG line chart with axis labels, gridlines and a hover tooltip. */
export function LineChart({ title, series, format, height = 200 }: LineChartProps): JSX.Element {
  const [hover, setHover] = useState<HoverState | null>(null)
  const innerWidth = WIDTH - PAD.left - PAD.right
  const innerHeight = height - PAD.top - PAD.bottom
  const count = series[0]?.points.length ?? 0
  const max = Math.max(1, ...series.flatMap(s => s.points.map(p => p.value)))
  const x = (i: number): number => PAD.left + (count <= 1 ? innerWidth / 2 : (i / (count - 1)) * innerWidth)
  const y = (value: number): number => PAD.top + innerHeight - (value / max) * innerHeight
  const grid = [0, 0.5, 1].map((fraction) => {
    const gy = PAD.top + innerHeight - fraction * innerHeight
    const value = max * fraction
    return (
      <g key={fraction}>
        <line x1={PAD.left} y1={gy} x2={WIDTH - PAD.right} y2={gy} stroke="var(--dsw-color-border, #d0d7de)" strokeWidth={1} strokeDasharray="2 3" />
        <text x={PAD.left - 6} y={gy + 3} textAnchor="end" fontSize={10} fill="var(--dsw-color-text-muted, #6e7781)">{format(value)}</text>
      </g>
    )
  })

  const handleMove = (event: React.MouseEvent<SVGSVGElement>): void => {
    if (count === 0) return
    const rect = event.currentTarget.getBoundingClientRect()
    const px = event.clientX - rect.left
    const step = count <= 1 ? 0 : innerWidth / (count - 1)
    const rawIndex = step === 0 ? 0 : Math.round((px - PAD.left) / step)
    const index = Math.max(0, Math.min(count - 1, rawIndex))
    const values = series.map(s => s.points[index]?.value ?? 0)
    const pointY = Math.min(...values.map(v => y(v)))
    setHover({ index, x: px, y: pointY })
  }

  return (
    <div className="line-chart" role="img" aria-label={title}>
      <div className="line-chart-title">{title}</div>
      {series.length > 1 && (
        <div className="chart-legend">
          {series.map(s => (
            <span key={s.name} className="chart-legend-item">
              <span className="chart-legend-dot" style={{ background: s.color }} />
              {s.name}
            </span>
          ))}
        </div>
      )}
      <div className="chart-body">
        <svg width={WIDTH} height={height} viewBox={`0 0 ${WIDTH} ${height}`}
          onMouseMove={handleMove}
          onMouseLeave={() => setHover(null)}
          style={{ cursor: count > 0 ? 'crosshair' : 'default' }}>
          {grid}
          {count > 0
            ? series.map(s => (
              <path key={s.name} d={s.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ')}
                fill="none" stroke={s.color} strokeWidth={2} />
            ))
            : <text x={WIDTH / 2} y={height / 2} textAnchor="middle" fontSize={12} fill="var(--dsw-color-text-muted, #6e7781)">—</text>}
          {count > 0 && series.map(s => s.points.map((p, i) => (
            <circle key={`${s.name}/${p.label}`} cx={x(i)} cy={y(p.value)} r={2.5} fill={s.color}>
              <title>{`${p.label} ${s.name}: ${format(p.value)}`}</title>
            </circle>
          )))}
          {count > 0 && series[0]?.points.map((p, i) => (
            <text key={p.label} x={x(i)} y={height - 8} textAnchor="middle" fontSize={9} fill="var(--dsw-color-text-muted, #6e7781)">{p.label}</text>
          ))}
          {hover !== null && (
            <g pointerEvents="none">
              <line x1={x(hover.index)} y1={PAD.top} x2={x(hover.index)} y2={PAD.top + innerHeight}
                stroke="var(--dsw-color-border, #d0d7de)" strokeWidth={1} strokeDasharray="2 3" />
              {series.map(s => (
                <circle key={s.name} cx={x(hover.index)} cy={y(s.points[hover.index]?.value ?? 0)} r={4} fill={s.color} stroke="#fff" strokeWidth={1.5} />
              ))}
            </g>
          )}
        </svg>
        {hover !== null && (
          <div className="chart-tooltip" style={{ left: Math.max(PAD.left, Math.min(WIDTH - PAD.right, hover.x)), top: Math.max(PAD.top, hover.y - 10) }}>
            <div className="chart-tooltip-date">{series[0]?.points[hover.index]?.label}</div>
            {series.map(s => (
              <div key={s.name} className="chart-tooltip-row">
                <span className="chart-tooltip-dot" style={{ background: s.color }} />
                {s.name}: {format(s.points[hover.index]?.value ?? 0)}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
