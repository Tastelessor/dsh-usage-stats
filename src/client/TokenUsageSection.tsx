/** Settings → Token Usage page (interim): today cards + charts + price table. */
import type { TokenUsageStore, TokenUsageState } from './store.ts'
import { LineChart, type ChartSeries } from './LineChart.tsx'
import { PriceTable } from './PriceTable.tsx'
import type { Currency, TieredModelPrice } from '../shared/types.ts'

export interface TokenUsageSectionProps {
  controller: TokenUsageStore
  useSnapshot: () => TokenUsageState
  t: (key: string) => any
  onSavePrices: (currency: Currency, prices: Record<string, TieredModelPrice>) => Promise<void>
}

const formatTokens = (value: number): string => {
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}k`
  return String(value)
}

const formatPercent = (value: number): string => `${(value * 100).toFixed(1)}%`

const SYMBOL: Record<Currency, string> = { CNY: '¥', USD: '$' }
const SERIES_COLORS: Record<Currency, string> = { CNY: '#2563eb', USD: '#16a34a' }

const formatMoney = (value: number | null, currency: Currency): string => value === null ? '—' : `${SYMBOL[currency]}${value.toFixed(2)}`

/** The interim page body: today cards + charts from buckets + price table. */
export function TokenUsageSection({ controller, useSnapshot, t, onSavePrices }: TokenUsageSectionProps): JSX.Element {
  const snapshot = useSnapshot()

  if (snapshot.status === 'loading' || snapshot.status === 'idle') return <div>{t('loading')}</div>
  if (snapshot.status === 'error') return <div className="stats-error">{t('error')}: {snapshot.error}</div>

  const data = snapshot.data!
  const today = data.windows.today
  const hasUsage = data.buckets.some(b => b.tokens.total > 0)
  const amountSeries: ChartSeries[] = [
    { name: 'CNY', color: SERIES_COLORS.CNY, points: data.buckets.map(b => ({ label: b.date.slice(5), value: b.amountCny ?? 0 })) },
    { name: 'USD', color: SERIES_COLORS.USD, points: data.buckets.map(b => ({ label: b.date.slice(5), value: b.amountUsd ?? 0 })) },
  ]

  return (
    <div className="token-usage">
      <div className="stats-toolbar">
        <button className="range-btn" onClick={() => void controller.refresh()}>{t('refresh')}</button>
      </div>

      <div className="stats-summary">
        <div className="summary-card"><div className="summary-label">{t('summaryTokens')}</div><div className="summary-value">{formatTokens(today.tokens.total)}</div></div>
        <div className="summary-card"><div className="summary-label">{t('summaryDailyAvg')}</div><div className="summary-value">{formatTokens(today.avgDailyTokens)}</div></div>
        <div className="summary-card"><div className="summary-label">{t('summaryCacheHit')}</div><div className="summary-value">{formatPercent(today.cacheHitRate)}</div></div>
        <div className="summary-card"><div className="summary-label">{t('summaryAmount')}</div><div className="summary-value">{formatMoney(today.amountCny, 'CNY')} / {formatMoney(today.amountUsd, 'USD')}</div></div>
      </div>

      {!hasUsage
        ? <div className="stats-empty">{t('empty')}</div>
        : (
          <>
            <LineChart title={t('chartTokens')}
              series={[{ name: t('seriesToken'), color: SERIES_COLORS.CNY, points: data.buckets.map(b => ({ label: b.date.slice(5), value: b.tokens.total })) }]}
              format={formatTokens} />
            <LineChart title={t('chartAmount')} series={amountSeries} format={v => v.toFixed(2)} />
          </>
        )}

      <PriceTable models={data.models} unpricedModels={data.unpricedModels} currency={data.currency} t={t}
        onSavePrices={onSavePrices} />
    </div>
  )
}