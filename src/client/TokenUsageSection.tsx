/** Settings → Token Usage: period-switchable summary cards, monthly heatmap, price table. */
import { useEffect, useState } from 'react'
import type { TokenUsageStore, TokenUsageState } from './store.ts'
import { Heatmap } from './Heatmap.tsx'
import { PriceTable } from './PriceTable.tsx'
import type { Currency, TieredModelPrice, WindowPeriod, WindowSummary } from '../shared/types.ts'

export interface TokenUsageSectionProps {
  controller: TokenUsageStore
  useSnapshot: () => TokenUsageState
  t: (key: string) => any
  onSavePrices: (currency: Currency, prices: Record<string, TieredModelPrice>) => Promise<void>
  onRestoreDefaults: (currency: Currency) => Promise<void>
}

const PERIODS: WindowPeriod[] = ['today', 'week', 'month']

const formatTokens = (value: number): string => {
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}k`
  return String(value)
}

const formatPercent = (value: number): string => `${(value * 100).toFixed(1)}%`

const formatMoney = (value: number | null, symbol: '¥' | '$'): string => value === null ? '—' : `${symbol}${value.toFixed(2)}`

function Cards({ summary, t }: { summary: WindowSummary; t: (key: string) => any }): JSX.Element {
  return (
    <div className="stats-summary">
      <div className="summary-card">
        <div className="summary-label">{t('summaryTokens')}</div>
        <div className="summary-value">{formatTokens(summary.tokens.total)}</div>
      </div>
      <div className="summary-card">
        <div className="summary-label">{t('summaryDailyAvg')}</div>
        <div className="summary-value">{formatTokens(summary.avgDailyTokens)}</div>
      </div>
      <div className="summary-card">
        <div className="summary-label">{t('summaryCacheHit')}</div>
        <div className="summary-value">{formatPercent(summary.cacheHitRate)}</div>
      </div>
      <div className="summary-card">
        <div className="summary-label">{t('summaryAmount')}</div>
        <div className="summary-value">{formatMoney(summary.amountCny, '¥')} / {formatMoney(summary.amountUsd, '$')}</div>
      </div>
    </div>
  )
}

/** The full token-usage page body. */
export function TokenUsageSection({ controller, useSnapshot, t, onSavePrices, onRestoreDefaults }: TokenUsageSectionProps): JSX.Element {
  const snapshot = useSnapshot()
  const [period, setPeriod] = useState<WindowPeriod>('today')

  // Auto-refresh on entry: every time the section is shown it re-loads the
  // page payload (the store's 30s cache keeps back-to-back visits cheap), so
  // the statistics stay current without needing a manual refresh click.
  useEffect(() => {
    void controller.load()
  }, [controller])

  if (snapshot.status === 'loading' || snapshot.status === 'idle') return <div>{t('loading')}</div>
  if (snapshot.status === 'error') return <div className="stats-error">{t('error')}: {snapshot.error}</div>

  const data = snapshot.data!
  const hasUsage = data.buckets.some(b => b.tokens.total > 0)

  return (
    <div className="token-usage">
      <div className="stats-toolbar">
        {PERIODS.map(p => (
          <button key={p} className={period === p ? 'range-btn active' : 'range-btn'}
            onClick={() => setPeriod(p)}>
            {t(`period${p[0].toUpperCase()}${p.slice(1)}`)}
          </button>
        ))}
        <button className="range-btn" onClick={() => void controller.refresh()}>{t('refresh')}</button>
      </div>

      <Cards summary={data.windows[period]} t={t} />

      {!hasUsage
        ? <div className="stats-empty">{t('empty')}</div>
        : <Heatmap buckets={data.buckets} to={data.to} t={t} />}

      <PriceTable models={data.models} unpricedModels={data.unpricedModels} currency={data.currency} t={t}
        onSavePrices={onSavePrices} onRestoreDefaults={onRestoreDefaults} />
    </div>
  )
}