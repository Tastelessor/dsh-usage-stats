/** Hand-drawn SVG line chart: one series, zero dependencies. */
export interface LineChartProps {
  title: string
  points: readonly { label: string; value: number }[]
  format: (value: number) => string
  height?: number
}

const WIDTH = 560
const PAD = { top: 16, right: 16, bottom: 28, left: 48 }

/** Render a single-series SVG line chart with axis labels and gridlines. */
export function LineChart({ title, points, format, height = 200 }: LineChartProps): JSX.Element {
  const innerWidth = WIDTH - PAD.left - PAD.right
  const innerHeight = height - PAD.top - PAD.bottom
  const max = Math.max(1, ...points.map(p => p.value))
  const x = (i: number): number => PAD.left + (points.length === 1 ? innerWidth / 2 : (i / (points.length - 1)) * innerWidth)
  const y = (value: number): number => PAD.top + innerHeight - (value / max) * innerHeight
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ')
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
  return (
    <div className="line-chart" role="img" aria-label={title}>
      <div className="line-chart-title">{title}</div>
      <svg width={WIDTH} height={height} viewBox={`0 0 ${WIDTH} ${height}`}>
        {grid}
        {points.length > 0
          ? <path d={path} fill="none" stroke="var(--dsw-color-accent, #2563eb)" strokeWidth={2} />
          : <text x={WIDTH / 2} y={height / 2} textAnchor="middle" fontSize={12} fill="var(--dsw-color-text-muted, #6e7781)">—</text>}
        {points.map((p, i) => (
          <g key={p.label}>
            <circle cx={x(i)} cy={y(p.value)} r={2.5} fill="var(--dsw-color-accent, #2563eb)" />
            <title>{`${p.label}: ${format(p.value)}`}</title>
          </g>
        ))}
        {points.map((p, i) => (
          <text key={p.label} x={x(i)} y={height - 8} textAnchor="middle" fontSize={9} fill="var(--dsw-color-text-muted, #6e7781)">{p.label}</text>
        ))}
      </svg>
    </div>
  )
}
