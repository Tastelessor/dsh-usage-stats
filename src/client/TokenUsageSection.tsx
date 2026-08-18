/** Settings → Token Usage page: range switch, summaries, charts, price table. */
import { useState } from 'react'
import type { TokenUsageStore, TokenUsageState } from './store.ts'
import { LineChart, type ChartSeries } from './LineChart.tsx'
import { PriceTable } from './PriceTable.tsx'
import type { Currency, TieredModelPrice, TokenTotals } from '../shared/types.ts'

export interface TokenUsageSectionProps {
  controller: TokenUsageStore
  useSnapshot: () => TokenUsageState
  t: (key: string) => any
  /** Persist edited prices for one currency (settings write + refresh). */
  onSavePrices: (currency: Currency, prices: Record<string, TieredModelPrice>) => Promise<void>
}

const RANGES = [7, 15, 30] as const

type SeriesKey = 'total' | 'input' | 'output' | 'cacheRead' | 'cacheWrite' | 'reasoning'

const formatTokens = (value: number): string => {
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}k`
  return String(value)
}

const SYMBOL: Record<Currency, string> = { CNY: '¥', USD: '$' }
const SERIES_COLORS: Record<Currency, string> = { CNY: '#2563eb', USD: '#16a34a' }

const formatMoney = (value: number | null, currency: Currency): string => value === null ? '—' : `${SYMBOL[currency]}${value.toFixed(2)}`

const formatPercent = (value: number): string => `${(value * 100).toFixed(1)}%`

/** One series extracted from the day buckets. */
function series(buckets: { date: string; tokens: TokenTotals }[], pick: (t: TokenTotals) => number): ChartSeries['points'] {
  return buckets.map(b => ({ label: b.date.slice(5), value: pick(b.tokens) }))
}

/** The full token-usage page body. */
export function TokenUsageSection({ controller, useSnapshot, t, onSavePrices }: TokenUsageSectionProps): JSX.Element {
  const snapshot = useSnapshot()
  const [seriesKey, setSeriesKey] = useState<SeriesKey>('total')

  if (snapshot.status === 'loading' || snapshot.status === 'idle') return <div>{t('loading')}</div>
  if (snapshot.status === 'error') return <div className="stats-error">{t('error')}: {snapshot.error}</div>

  const data = snapshot.data!
  const currency = data.currency
  const pick: Record<SeriesKey, (t: TokenTotals) => number> = {
    total: t => t.total,
    input: t => t.input,
    output: t => t.output,
    cacheRead: t => t.cacheRead,
    cacheWrite: t => t.cacheWrite,
    reasoning: t => t.reasoning,
  }
  const hasUsage = data.totals.tokens.total > 0
  const amountSeries: ChartSeries[] = [
    { name: 'CNY', color: SERIES_COLORS.CNY, points: data.buckets.map(b => ({ label: b.date.slice(5), value: b.amountCny ?? 0 })) },
    { name: 'USD', color: SERIES_COLORS.USD, points: data.buckets.map(b => ({ label: b.date.slice(5), value: b.amountUsd ?? 0 })) },
  ]

  return (
    <div className="token-usage">
      <div className="stats-toolbar">
        {RANGES.map(days => (
          <button key={days} className={snapshot.days === days ? 'range-btn active' : 'range-btn'}
            onClick={() => void controller.load(days)}>
            {t('rangeDays')(days)}
          </button>
        ))}
        <button className="range-btn" onClick={() => void controller.refresh()}>{t('refresh')}</button>
      </div>

      <div className="stats-summary">
        <div className="summary-card"><div className="summary-label">{t('summaryTokens')}</div><div className="summary-value">{formatTokens(data.totals.tokens.total)}</div></div>
        <div className="summary-card"><div className="summary-label">{t('summaryDailyAvg')}</div><div className="summary-value">{formatTokens(data.totals.avgDailyTokens)}</div></div>
        <div className="summary-card"><div className="summary-label">{t('summaryCacheHit')}</div><div className="summary-value">{formatPercent(data.totals.cacheHitRate)}</div></div>
        <div className="summary-card"><div className="summary-label">{t('summaryAmountCny')}</div><div className="summary-value">{formatMoney(data.totals.amountCny, 'CNY')}</div></div>
        <div className="summary-card"><div className="summary-label">{t('summaryAmountUsd')}</div><div className="summary-value">{formatMoney(data.totals.amountUsd, 'USD')}</div></div>
      </div>

      {!hasUsage
        ? <div className="stats-empty">{t('empty')}</div>
        : (
          <>
            <div className="series-switch">
              {(['total', 'input', 'output', 'cacheRead', 'cacheWrite', 'reasoning'] as const).map(key => (
                <button key={key} className={seriesKey === key ? 'series-btn active' : 'series-btn'}
                  onClick={() => setSeriesKey(key)}>
                  {t(`series${key[0].toUpperCase()}${key.slice(1)}`)}
                </button>
              ))}
            </div>
            <LineChart title={t('chartTokens')}
              series={[{ name: t('seriesToken'), color: SERIES_COLORS.CNY, points: series(data.buckets, pick[seriesKey]) }]}
              format={formatTokens} />
            <LineChart title={t('chartAmount')} series={amountSeries}
              format={v => v.toFixed(2)} />
          </>
        )}

      <PriceTable models={data.models} unpricedModels={data.unpricedModels} currency={currency} t={t}
        onSavePrices={onSavePrices} />
    </div>
  )
}
