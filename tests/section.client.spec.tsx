// @vitest-environment jsdom
/** Page renders charts, price table, empty state, range switching, tooltips, tiered editing. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { TokenUsageSection } from '../src/client/TokenUsageSection.tsx'
import { LineChart } from '../src/client/LineChart.tsx'
import type { Currency, StatsResponse, TieredModelPrice } from '../src/shared/types.ts'

// vitest globals are off here, so RTL's auto-cleanup never registers; the
// spec renders repeatedly, and getByText requires unique matches.
afterEach(cleanup)

const TIERED_CNY: TieredModelPrice = {
  peak: { inputPerM: 2, cacheReadPerM: 0.2, outputPerM: 4, cacheWritePerM: 0.5 },
  offPeak: { inputPerM: 1, cacheReadPerM: 0.1, outputPerM: 2, cacheWritePerM: 0.5 },
}
const TIERED_USD: TieredModelPrice = {
  peak: { inputPerM: 0.4, cacheReadPerM: 0.04, outputPerM: 0.8, cacheWritePerM: 0.1 },
  offPeak: { inputPerM: 0.2, cacheReadPerM: 0.02, outputPerM: 0.4, cacheWritePerM: 0.1 },
}

const RESPONSE: StatsResponse = {
  days: 7, from: 0, to: 0, generatedAt: 0, currency: 'CNY',
  buckets: Array.from({ length: 7 }, (_, i) => ({
    date: `2026-08-${String(8 + i).padStart(2, '0')}`,
    tokens: { input: i === 6 ? 1_000_000 : 0, output: 500_000, cacheRead: 0, cacheWrite: 0, reasoning: 0, total: 1_500_000 },
    amountCny: i === 6 ? 2 : null,
    amountUsd: i === 6 ? 0.4 : null,
  })),
  totals: {
    tokens: { input: 1_000_000, output: 3_500_000, cacheRead: 0, cacheWrite: 0, reasoning: 0, total: 4_500_000 },
    amountCny: 14,
    amountUsd: 2.8,
    avgDailyTokens: 4_500_000 / 7,
    cacheHitRate: 0.5,
  },
  models: [{
    provider: 'deepseek-official', model: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash',
    cny: TIERED_CNY,
    usd: TIERED_USD,
  }],
  unpricedModels: [{ provider: 'openai', model: 'gpt-x' }],
}

const t = (key: string): any => ({
  loading: '加载中…', error: '加载失败', empty: '该时间段无用量数据', refresh: '刷新',
  rangeDays: (n: number) => `过去 ${n} 天`, summaryTokens: 'Token 总量', summaryDailyAvg: '日均 Token',
  summaryCacheHit: '平均缓存命中率', summaryAmountCny: '估算金额 (CNY)', summaryAmountUsd: '估算金额 (USD)',
  chartTokens: 'Token 用量', chartAmount: '金额开销（CNY / USD）', seriesToken: 'Token',
  priceTableTitle: '模型单价（M tokens）',
  priceModel: '模型', priceCacheRead: '输入命中缓存', priceInput: '输入未命中缓存', priceOutput: '输出',
  priceTierPeak: '高峰时段', priceTierOffPeak: '空闲时段',
  peakHint: '高峰时段为北京时间 9:00–12:00、14:00–18:00',
  priceNotConfigured: '未配置', priceSave: '保存单价', priceSaving: '保存中…', priceSaveFailed: '保存失败，请重试',
  priceEditHint: '编辑输入框后点击保存；币种与时段分别保存',
  unpricedHint: (n: number) => `${n} 个已使用模型未配置单价`,
  seriesTotal: '总量', seriesInput: '输入', seriesOutput: '输出', seriesCacheRead: '缓存命中',
  seriesCacheWrite: '缓存写入', seriesReasoning: '推理',
}[key] ?? key)

const renderReady = (overrides: { onSavePrices?: (currency: Currency, prices: Record<string, TieredModelPrice>) => Promise<void> } = {}) => render(
  <TokenUsageSection controller={{} as never}
    useSnapshot={() => ({ status: 'ready', error: null, days: 7, data: RESPONSE })} t={t}
    onSavePrices={overrides.onSavePrices ?? (async () => {})} />,
)

describe('TokenUsageSection', () => {
  it('shows summary cards: totals, daily average, cache hit rate, both currencies', () => {
    renderReady()
    expect(screen.getByText('Token 总量')).toBeTruthy()
    expect(screen.getByText('4.5M')).toBeTruthy()
    expect(screen.getByText('日均 Token')).toBeTruthy()
    expect(screen.getByText('平均缓存命中率')).toBeTruthy()
    expect(screen.getByText('50.0%')).toBeTruthy()
    expect(screen.getByText('¥14.00')).toBeTruthy()
    expect(screen.getByText('$2.80')).toBeTruthy()
    expect(screen.getByText('Token 用量')).toBeTruthy()
    expect(screen.getByText('金额开销（CNY / USD）')).toBeTruthy()
  })

  it('renders the price table with currency and tier toggles, defaulting to off-peak', () => {
    renderReady()
    expect(screen.getByText('DeepSeek-V4-Flash')).toBeTruthy()
    const inputs = screen.getAllByRole('spinbutton')
    expect(inputs.length).toBe(3) // cacheRead/input/output for one model
    expect((inputs[0] as HTMLInputElement).value).toBe('0.1') // off-peak cacheRead
    expect((inputs[1] as HTMLInputElement).value).toBe('1')   // off-peak input
    expect((inputs[2] as HTMLInputElement).value).toBe('2')   // off-peak output
    expect(screen.getByText('¥ CNY')).toBeTruthy()
    expect(screen.getByText('$ USD')).toBeTruthy()
    expect(screen.getByText('高峰时段')).toBeTruthy()
    expect(screen.getByText('空闲时段')).toBeTruthy()
    expect(screen.getByText('gpt-x')).toBeTruthy()
    expect(screen.getByText('1 个已使用模型未配置单价')).toBeTruthy()
  })

  it('switches the price table to the peak tier', () => {
    renderReady()
    fireEvent.click(screen.getByText('高峰时段'))
    const inputs = screen.getAllByRole('spinbutton')
    expect((inputs[0] as HTMLInputElement).value).toBe('0.2') // peak cacheRead
    expect((inputs[1] as HTMLInputElement).value).toBe('2')   // peak input
    expect((inputs[2] as HTMLInputElement).value).toBe('4')   // peak output
  })

  it('switches the price-table currency to USD', () => {
    renderReady()
    fireEvent.click(screen.getByText('$ USD'))
    const inputs = screen.getAllByRole('spinbutton')
    expect((inputs[0] as HTMLInputElement).value).toBe('0.02') // usd off-peak cacheRead
    expect((inputs[2] as HTMLInputElement).value).toBe('0.4')  // usd off-peak output
  })

  it('persists an edited off-peak price as a full tiered object, leaving the peak tier intact', async () => {
    let saved: unknown
    renderReady({ onSavePrices: async (currency, prices) => { saved = { currency, prices } } })
    const inputs = screen.getAllByRole('spinbutton')
    fireEvent.change(inputs[0], { target: { value: '0.33' } })
    fireEvent.click(screen.getByText('保存单价'))
    expect(saved).toEqual({
      currency: 'CNY',
      prices: {
        'deepseek-v4-flash': {
          peak: TIERED_CNY.peak,
          offPeak: { ...TIERED_CNY.offPeak, cacheReadPerM: 0.33 },
        },
      },
    })
  })

  it('saves an edited peak-tier price without touching the off-peak tier', async () => {
    let saved: unknown
    renderReady({ onSavePrices: async (currency, prices) => { saved = { currency, prices } } })
    fireEvent.click(screen.getByText('高峰时段'))
    const inputs = screen.getAllByRole('spinbutton')
    fireEvent.change(inputs[2], { target: { value: '9' } })
    fireEvent.click(screen.getByText('保存单价'))
    const savedPrices = (saved as { prices: Record<string, TieredModelPrice> }).prices
    expect(savedPrices['deepseek-v4-flash'].peak.outputPerM).toBe(9)
    expect(savedPrices['deepseek-v4-flash'].offPeak).toEqual(TIERED_CNY.offPeak)
  })

  it('shows the empty state when there is no usage', () => {
    render(<TokenUsageSection controller={{} as never}
      useSnapshot={() => ({ status: 'ready', error: null, days: 7,
        data: { ...RESPONSE, buckets: [], totals: { ...RESPONSE.totals, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, total: 0 }, amountCny: null, amountUsd: null, avgDailyTokens: 0 } } })}
      t={t} onSavePrices={async () => {}} />)
    expect(screen.getByText('该时间段无用量数据')).toBeTruthy()
  })

  it('calls load with the selected range', () => {
    let loaded: number[] = []
    const controller = { load: (days: number) => { loaded.push(days); return Promise.resolve() }, refresh: () => Promise.resolve() }
    render(<TokenUsageSection controller={controller as never}
      useSnapshot={() => ({ status: 'ready', error: null, days: 7, data: RESPONSE })} t={t} onSavePrices={async () => {}} />)
    fireEvent.click(screen.getByText('过去 15 天'))
    expect(loaded).toEqual([15])
  })

  it('shows the error state with message', () => {
    render(<TokenUsageSection controller={{} as never}
      useSnapshot={() => ({ status: 'error', error: 'boom', days: 7, data: null })} t={t} onSavePrices={async () => {}} />)
    expect(screen.getByText(/加载失败: boom/)).toBeTruthy()
  })
})

describe('LineChart', () => {
  it('renders multiple series and a hover tooltip with exact values', () => {
    render(
      <LineChart title="spend" format={(v: number) => v.toFixed(2)}
        series={[
          { name: 'CNY', color: '#111', points: [{ label: '08-13', value: 2 }, { label: '08-14', value: 4 }] },
          { name: 'USD', color: '#222', points: [{ label: '08-13', value: 0.4 }, { label: '08-14', value: 0.8 }] },
        ]} />,
    )
    const svg = document.querySelector('.line-chart svg') as SVGSVGElement
    fireEvent.mouseMove(svg, { clientX: 0, clientY: 0 })
    // jsdom reports zero rects: the pointer maps to index 0, values 2 and 0.4.
    expect(screen.getAllByText('08-13').length).toBeGreaterThan(0)
    expect(screen.getByText('CNY: 2.00')).toBeTruthy()
    expect(screen.getByText('USD: 0.40')).toBeTruthy()
  })

  it('renders a placeholder for an empty chart', () => {
    render(<LineChart title="empty" format={(v: number) => String(v)} series={[]} />)
    expect(screen.getByText('—')).toBeTruthy()
  })
})