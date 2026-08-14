/** Settings → Usage Stats page: range switch, summaries, charts, price table. */
import { useState } from 'react'
import type { UsageStatsStore, UsageStatsState } from './store.ts'
import { LineChart } from './LineChart.tsx'
import { PriceTable } from './PriceTable.tsx'
import type { TokenTotals } from '../shared/types.ts'
import type { Currency } from '../shared/types.ts'

export interface UsageStatsSectionProps {
  controller: UsageStatsStore
  useSnapshot: () => UsageStatsState
  t: (key: string) => any
}

const RANGES = [7, 15, 30] as const

const formatTokens = (value: number): string => {
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}k`
  return String(value)
}

const SYMBOL: Record<Currency, string> = { CNY: '¥', USD: '$' }

const formatMoney = (value: number | null, currency: Currency): string => value === null ? '—' : `${SYMBOL[currency]}${value.toFixed(2)}`

/** One series extracted from the day buckets. */
function series(buckets: { date: string; tokens: TokenTotals }[], pick: (t: TokenTotals) => number) {
  return buckets.map(b => ({ label: b.date.slice(5), value: pick(b.tokens) }))
}

/** The full usage-stats page body. */
export function UsageStatsSection({ controller, useSnapshot, t }: UsageStatsSectionProps): JSX.Element {
  const snapshot = useSnapshot()
  const [seriesKey, setSeriesKey] = useState<'total' | 'input' | 'output' | 'cacheRead' | 'cacheWrite' | 'reasoning'>('total')

  if (snapshot.status === 'loading' || snapshot.status === 'idle') return <div>{t('loading')}</div>
  if (snapshot.status === 'error') return <div className="stats-error">{t('error')}: {snapshot.error}</div>

  const data = snapshot.data!
  const currency = data.currency
  const pick: Record<string, (t: TokenTotals) => number> = {
    total: t => t.total,
    input: t => t.input,
    output: t => t.output,
    cacheRead: t => t.cacheRead,
    cacheWrite: t => t.cacheWrite,
    reasoning: t => t.reasoning,
  }
  const hasUsage = data.totals.tokens.total > 0

  return (
    <div className="usage-stats">
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
        <div className="summary-card"><div className="summary-label">{t('summaryAmount')}</div><div className="summary-value">{formatMoney(data.totals.amount, currency)}</div></div>
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
            <LineChart title={t('chartTokens')} points={series(data.buckets, pick[seriesKey])} format={formatTokens} />
            <LineChart title={t('chartAmount')}
              points={data.buckets.map(b => ({ label: b.date.slice(5), value: b.amount ?? 0 }))}
              format={v => `${SYMBOL[currency]}${v.toFixed(2)}`} />
          </>
        )}

      <PriceTable models={data.models} unpricedModels={data.unpricedModels} currency={currency} t={t} />
    </div>
  )
}
