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
  priceRestoreDefault: '恢复默认', priceRestoring: '恢复中…', priceRestoreFailed: '恢复失败，请重试',
  priceEditHint: '编辑输入框后点击保存；币种与时段分别保存',
  unpricedHint: (n: number) => `${n} 个已使用模型未配置单价`,
  periodToday: '当日', periodWeek: '本周', periodMonth: '本月',
  heatmapTitle: '本月 Token 用量', heatmapLess: '少', heatmapMore: '多',
  hmTotal: 'Token 总量', hmInputMiss: '输入（未命中缓存）', hmInputHit: '输入缓存（命中）',
  hmOutput: '输出', hmHitRate: '缓存命中率', hmAmount: '金额',
}[key] ?? key)

/** Minimal controller mock: the section's mount effect calls load(), the toolbar calls refresh(). */
const makeController = (overrides: Record<string, unknown> = {}) => ({
  load: () => Promise.resolve(),
  refresh: () => Promise.resolve(),
  clearCache: () => {},
  ...overrides,
})

const renderReady = (overrides: {
  onSavePrices?: (currency: Currency, prices: Record<string, TieredModelPrice>) => Promise<void>
  onRestoreDefaults?: (currency: Currency) => Promise<void>
  controller?: Record<string, unknown>
} = {}) => render(
  <TokenUsageSection controller={(overrides.controller ?? makeController()) as never}
    useSnapshot={() => ({ status: 'ready', error: null, data: RESPONSE })} t={t}
    onSavePrices={overrides.onSavePrices ?? (async () => {})}
    onRestoreDefaults={overrides.onRestoreDefaults ?? (async () => {})} />,
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
    const controller = makeController({ refresh: () => { refreshed = true; return Promise.resolve() } })
    render(<TokenUsageSection controller={controller as never}
      useSnapshot={() => ({ status: 'ready', error: null, data: RESPONSE })} t={t}
      onSavePrices={async () => {}} onRestoreDefaults={async () => {}} />)
    fireEvent.click(screen.getByText('刷新'))
    expect(refreshed).toBe(true)
  })

  it('restores defaults for the edited currency from the price actions', async () => {
    const restored: Currency[] = []
    renderReady({ onRestoreDefaults: async (currency) => { restored.push(currency) } })
    fireEvent.click(screen.getByText('$ USD'))
    fireEvent.click(screen.getByText('恢复默认'))
    expect(restored).toEqual(['USD'])
  })

  it('shows the empty state when there is no usage', () => {
    render(<TokenUsageSection controller={(makeController()) as never}
      useSnapshot={() => ({ status: 'ready', error: null, data: { ...RESPONSE, buckets: [] } })} t={t}
      onSavePrices={async () => {}} onRestoreDefaults={async () => {}} />)
    expect(screen.getByText('该时间段无用量数据')).toBeTruthy()
  })

  it('shows the error state with message', () => {
    render(<TokenUsageSection controller={(makeController()) as never}
      useSnapshot={() => ({ status: 'error', error: 'boom', data: null })} t={t}
      onSavePrices={async () => {}} onRestoreDefaults={async () => {}} />)
    expect(screen.getByText(/加载失败: boom/)).toBeTruthy()
  })
})

describe('Heatmap (3-month week strip)', () => {
  const dayKeyOf = (ms: number): string => {
    const d = new Date(ms)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  const mkBuckets = () => {
    const start = new Date(2026, 5, 1).getTime() // 2026-06-01 00:00 local
    return Array.from({ length: 80 }, (_, i) => ({
      date: dayKeyOf(start + i * 86_400_000),
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, total: 0 },
      amountCny: null as number | null,
      amountUsd: null as number | null,
    }))
  }
  const withTotals = (buckets: ReturnType<typeof mkBuckets>, date: string, total: number, cny: number | null = null, usd: number | null = null) => {
    const target = buckets.find(b => b.date === date)!
    target.tokens.total = total
    target.amountCny = cny
    target.amountUsd = usd
  }
  const to = new Date('2026-08-19T12:00:00').getTime()

  it('renders one cell per day of the 3-month strip with month captions and weekday labels', () => {
    render(<Heatmap buckets={mkBuckets()} to={to} t={t} />)
    expect(document.querySelectorAll('.hm-cell').length).toBe(80) // 06-01..08-19
    expect(screen.getByText('2026-06')).toBeTruthy()
    expect(screen.getByText('2026-07')).toBeTruthy()
    expect(screen.getByText('2026-08')).toBeTruthy()
    for (const label of ['一', '二', '三', '四', '五', '六', '日']) {
      expect(screen.getByText(label)).toBeTruthy()
    }
    expect(document.querySelectorAll('.hm-future').length).toBe(0) // 周带没有未来占位格
    expect(document.querySelectorAll('.hm-blank').length).toBe(0)
  })

  it('colors the busiest day at the top quartile and marks today', () => {
    const buckets = mkBuckets()
    withTotals(buckets, '2026-08-19', 1_000_000, 5, 1)
    render(<Heatmap buckets={buckets} to={to} t={t} />)
    const today = document.querySelector('[data-date="2026-08-19"]') as HTMLElement
    expect(today.classList.contains('hm-l4')).toBe(true)
    expect(today.classList.contains('hm-today')).toBe(true)
  })

  it('places relative-quartile bins into their respective color levels across all 3 months', () => {
    const buckets = mkBuckets()
    withTotals(buckets, '2026-08-19', 1_000_000)
    withTotals(buckets, '2026-08-01', 600_000)
    withTotals(buckets, '2026-08-02', 300_000)
    withTotals(buckets, '2026-06-15', 100_000)
    render(<Heatmap buckets={buckets} to={to} t={t} />)
    // max = 1_000_000；0.6 → l3，0.3 → l2，0.1 → l1
    expect((document.querySelector('[data-date="2026-08-01"]') as HTMLElement).classList.contains('hm-l3')).toBe(true)
    expect((document.querySelector('[data-date="2026-08-02"]') as HTMLElement).classList.contains('hm-l2')).toBe(true)
    expect((document.querySelector('[data-date="2026-06-15"]') as HTMLElement).classList.contains('hm-l1')).toBe(true)
  })

  it('shows a tooltip with the day breakdown on hover', () => {
    const buckets = mkBuckets()
    withTotals(buckets, '2026-08-19', 1_000_000, 5, 1)
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
  it('auto-reloads once on mount so entering the section refreshes the statistics', () => {
    const loads: number[] = []
    render(<TokenUsageSection controller={{ ...makeController(), load: () => { loads.push(1); return Promise.resolve() } } as never}
      useSnapshot={() => ({ status: 'ready', error: null, data: RESPONSE })} t={t}
      onSavePrices={async () => {}} onRestoreDefaults={async () => {}} />)
    expect(loads).toEqual([1])
  })

  it('switches the period buttons without refetching (pure client state)', () => {
    let refreshed = 0
    const controller = makeController({ refresh: () => { refreshed += 1; return Promise.resolve() } })
    render(<TokenUsageSection controller={controller as never}
      useSnapshot={() => ({ status: 'ready', error: null, data: {
        ...RESPONSE,
        windows: {
          today: windowOf({ tokens: { input: 11, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, total: 11 }, avgDailyTokens: 2.2 }),
          week: windowOf({ tokens: { input: 7000, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, total: 7000 }, avgDailyTokens: 7000 / 3 }),
          month: windowOf({ tokens: { input: 300000, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, total: 300000 }, avgDailyTokens: 300000 / 19 }),
        },
      } })} t={t} onSavePrices={async () => {}} onRestoreDefaults={async () => {}} />)
    expect(screen.getByText('11')).toBeTruthy()       // today total
    fireEvent.click(screen.getByText('本周'))
    expect(screen.getByText('7.0k')).toBeTruthy()     // week total
    fireEvent.click(screen.getByText('本月'))
    expect(screen.getByText('300.0k')).toBeTruthy()   // month total
    expect(refreshed).toBe(0)
  })
})