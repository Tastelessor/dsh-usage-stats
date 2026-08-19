// @vitest-environment jsdom
/** Interim section: today cards, combined amount, price table, empty/error states. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { TokenUsageSection } from '../src/client/TokenUsageSection.tsx'
import { Heatmap } from '../src/client/Heatmap.tsx'
import type { Currency, StatsResponse, TieredModelPrice, WindowSummary } from '../src/shared/types.ts'

afterEach(cleanup)

const TIERED_CNY: TieredModelPrice = {
  peak: { inputPerM: 2, cacheReadPerM: 0.2, outputPerM: 4, cacheWritePerM: 0.5 },
  offPeak: { inputPerM: 1, cacheReadPerM: 0.1, outputPerM: 2, cacheWritePerM: 0.5 },
}
const TIERED_USD: TieredModelPrice = {
  peak: { inputPerM: 0.4, cacheReadPerM: 0.04, outputPerM: 0.8, cacheWritePerM: 0.1 },
  offPeak: { inputPerM: 0.2, cacheReadPerM: 0.02, outputPerM: 0.4, cacheWritePerM: 0.1 },
}

const windowOf = (o: Partial<WindowSummary>): WindowSummary => ({
  tokens: { input: 1_000_000, output: 500_000, cacheRead: 0, cacheWrite: 0, reasoning: 0, total: 1_500_000 },
  amountCny: 2, amountUsd: 0.4, cacheHitRate: 0.5, avgDailyTokens: 750_000,
  ...o,
})

const RESPONSE: StatsResponse = {
  from: 0, to: 0, generatedAt: 0, currency: 'CNY',
  buckets: Array.from({ length: 19 }, (_, i) => ({
    date: `2026-08-${String(1 + i).padStart(2, '0')}`,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, total: 0 },
    amountCny: null, amountUsd: null,
  })),
  windows: { today: windowOf({}), week: windowOf({}), month: windowOf({}) },
  models: [{
    provider: 'deepseek-official', model: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash',
    cny: TIERED_CNY, usd: TIERED_USD,
  }],
  unpricedModels: [{ provider: 'openai', model: 'gpt-x' }],
}

const t = (key: string): any => ({
  loading: '加载中…', error: '加载失败', empty: '该时间段无用量数据', refresh: '刷新',
  summaryTokens: 'Token 总量', summaryDailyAvg: '日均 Token',
  summaryCacheHit: '平均缓存命中率', summaryAmount: '估算金额 (CNY / USD)',
  chartTokens: 'Token 用量', chartAmount: '金额开销（CNY / USD）', seriesToken: 'Token',
  priceTableTitle: '模型单价（M tokens）', priceModel: '模型', priceCacheRead: '输入命中缓存',
  priceInput: '输入未命中缓存', priceOutput: '输出', priceTierPeak: '高峰时段', priceTierOffPeak: '空闲时段',
  peakHint: '高峰时段为北京时间 9:00–12:00、14:00–18:00',
  priceNotConfigured: '未配置', priceSave: '保存单价', priceSaving: '保存中…', priceSaveFailed: '保存失败，请重试',
  priceEditHint: '编辑输入框后点击保存；币种与时段分别保存',
  unpricedHint: (n: number) => `${n} 个已使用模型未配置单价`,
  periodToday: '当日', periodWeek: '本周', periodMonth: '本月',
  heatmapTitle: '本月 Token 用量', heatmapLess: '少', heatmapMore: '多',
  hmTotal: 'Token 总量', hmInputMiss: '输入（未命中缓存）', hmInputHit: '输入缓存（命中）',
  hmOutput: '输出', hmHitRate: '缓存命中率', hmAmount: '金额',
}[key] ?? key)

const renderReady = (overrides: { onSavePrices?: (currency: Currency, prices: Record<string, TieredModelPrice>) => Promise<void> } = {}) => render(
  <TokenUsageSection controller={{} as never}
    useSnapshot={() => ({ status: 'ready', error: null, data: RESPONSE })} t={t}
    onSavePrices={overrides.onSavePrices ?? (async () => {})} />,
)

describe('TokenUsageSection (interim)', () => {
  it('shows today cards with combined dual-currency amount', () => {
    renderReady()
    expect(screen.getByText('Token 总量')).toBeTruthy()
    expect(screen.getByText('1.5M')).toBeTruthy()
    expect(screen.getByText('日均 Token')).toBeTruthy()
    expect(screen.getByText('平均缓存命中率')).toBeTruthy()
    expect(screen.getByText('50.0%')).toBeTruthy()
    expect(screen.getByText('¥2.00 / $0.40')).toBeTruthy()
    expect(screen.getByText('估算金额 (CNY / USD)')).toBeTruthy()
  })

  it('renders the price table with currency and tier toggles, defaulting to off-peak', () => {
    renderReady()
    expect(screen.getByText('DeepSeek-V4-Flash')).toBeTruthy()
    const inputs = screen.getAllByRole('spinbutton')
    expect(inputs.length).toBe(3)
    expect((inputs[0] as HTMLInputElement).value).toBe('0.1') // CNY off-peak cacheRead
    fireEvent.click(screen.getByText('$ USD'))
    expect((screen.getAllByRole('spinbutton')[0] as HTMLInputElement).value).toBe('0.02') // usd off-peak cacheRead
    fireEvent.click(screen.getByText('高峰时段'))
    expect((screen.getAllByRole('spinbutton')[0] as HTMLInputElement).value).toBe('0.04') // usd peak cacheRead
    expect(screen.getByText('gpt-x')).toBeTruthy()
    expect(screen.getByText('1 个已使用模型未配置单价')).toBeTruthy() // unpricedModels.length === 1
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

  it('triggers a refresh from the toolbar', () => {
    let refreshed = false
    const controller = { refresh: () => { refreshed = true; return Promise.resolve() } }
    render(<TokenUsageSection controller={controller as never}
      useSnapshot={() => ({ status: 'ready', error: null, data: RESPONSE })} t={t} onSavePrices={async () => {}} />)
    fireEvent.click(screen.getByText('刷新'))
    expect(refreshed).toBe(true)
  })

  it('shows the empty state when there is no usage', () => {
    render(<TokenUsageSection controller={{} as never}
      useSnapshot={() => ({ status: 'ready', error: null, data: { ...RESPONSE, buckets: [] } })} t={t} onSavePrices={async () => {}} />)
    expect(screen.getByText('该时间段无用量数据')).toBeTruthy()
  })

  it('shows the error state with message', () => {
    render(<TokenUsageSection controller={{} as never}
      useSnapshot={() => ({ status: 'error', error: 'boom', data: null })} t={t} onSavePrices={async () => {}} />)
    expect(screen.getByText(/加载失败: boom/)).toBeTruthy()
  })
})

describe('Heatmap', () => {
  const buckets = Array.from({ length: 19 }, (_, i) => ({
    date: `2026-08-${String(1 + i).padStart(2, '0')}`,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, total: i === 18 ? 1_000_000 : i === 0 ? 600_000 : i === 1 ? 300_000 : i === 2 ? 100_000 : 0 },
    amountCny: i === 18 ? 5 : null,
    amountUsd: i === 18 ? 1 : null,
  }))
  const to = new Date('2026-08-19T12:00:00').getTime()

  it('renders one cell per day of the month plus weekday-aligned lead blanks', () => {
    render(<Heatmap buckets={buckets} to={to} t={t} />)
    expect(document.querySelectorAll('.hm-cell').length).toBe(31)  // 含未来日格
    expect(document.querySelectorAll('.hm-blank').length).toBe(5)  // 8-01(周六) 前的 5 个空位
    expect(document.querySelectorAll('.hm-future').length).toBe(12) // 8-20..8-31
  })

  it('colors the busiest day at the top quartile and leaves future days empty', () => {
    render(<Heatmap buckets={buckets} to={to} t={t} />)
    const today = document.querySelector('[data-date="2026-08-19"]') as HTMLElement
    expect(today.classList.contains('hm-l4')).toBe(true) // 唯一有量日 = 当月最大
    const future = document.querySelector('[data-date="2026-08-20"]') as HTMLElement
    expect(future.classList.contains('hm-future')).toBe(true)
    expect(future.classList.contains('hm-l4')).toBe(false)
  })

  it('places relative-quartile bins into their respective color levels', () => {
    render(<Heatmap buckets={buckets} to={to} t={t} />)
    // max = 1_000_000 (08-19); ratios: 0.6 → l3, 0.3 → l2, 0.1 → l1
    expect((document.querySelector('[data-date="2026-08-01"]') as HTMLElement).classList.contains('hm-l3')).toBe(true)
    expect((document.querySelector('[data-date="2026-08-02"]') as HTMLElement).classList.contains('hm-l2')).toBe(true)
    expect((document.querySelector('[data-date="2026-08-03"]') as HTMLElement).classList.contains('hm-l1')).toBe(true)
  })

  it('shows a tooltip with the day breakdown on hover', () => {
    render(<Heatmap buckets={buckets} to={to} t={t} />)
    const cell = document.querySelector('[data-date="2026-08-19"]') as HTMLElement
    fireEvent.mouseEnter(cell)
    expect(screen.getByText('2026-08-19')).toBeTruthy()             // 浮窗标题
    expect(screen.getByText(/Token 总量: 1\.0M/)).toBeTruthy()
    expect(screen.getByText(/缓存命中率: 0\.0%/)).toBeTruthy()
    expect(screen.getByText(/金额: ¥5\.00 \/ \$1\.00/)).toBeTruthy()
  })
})

describe('TokenUsageSection (final)', () => {
  it('switches the period buttons without refetching (pure client state)', () => {
    let refreshed = 0
    const controller = { refresh: () => { refreshed += 1; return Promise.resolve() } }
    render(<TokenUsageSection controller={controller as never}
      useSnapshot={() => ({ status: 'ready', error: null, data: {
        ...RESPONSE,
        windows: {
          today: windowOf({ tokens: { input: 11, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, total: 11 }, avgDailyTokens: 2.2 }),
          week: windowOf({ tokens: { input: 7000, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, total: 7000 }, avgDailyTokens: 7000 / 3 }),
          month: windowOf({ tokens: { input: 300000, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, total: 300000 }, avgDailyTokens: 300000 / 19 }),
        },
      } })} t={t} onSavePrices={async () => {}} />)
    expect(screen.getByText('11')).toBeTruthy()       // today total
    fireEvent.click(screen.getByText('本周'))
    expect(screen.getByText('7.0k')).toBeTruthy()     // week total
    fireEvent.click(screen.getByText('本月'))
    expect(screen.getByText('300.0k')).toBeTruthy()   // month total
    expect(refreshed).toBe(0)
  })
})