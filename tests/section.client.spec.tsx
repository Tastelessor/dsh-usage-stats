// @vitest-environment jsdom
/** Page renders charts, price table, empty state, and range switching. */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { UsageStatsSection } from '../src/client/UsageStatsSection.tsx'
import type { StatsResponse } from '../src/shared/types.ts'

// vitest globals are off here, so RTL's auto-cleanup never registers; the
// spec renders repeatedly, and getByText requires unique matches.
afterEach(cleanup)

const RESPONSE: StatsResponse = {
  days: 7, from: 0, to: 0, generatedAt: 0, currency: 'CNY',
  buckets: Array.from({ length: 7 }, (_, i) => ({
    date: `2026-08-${String(8 + i).padStart(2, '0')}`,
    tokens: { input: i === 6 ? 1_000_000 : 0, output: 500_000, cacheRead: 0, cacheWrite: 0, reasoning: 0, total: 1_500_000 },
    amount: 2,
  })),
  totals: { tokens: { input: 1_000_000, output: 3_500_000, cacheRead: 0, cacheWrite: 0, reasoning: 0, total: 4_500_000 }, amount: 14 },
  models: [{ provider: 'deepseek-official', model: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash', inputPerM: 1, cacheReadPerM: 0.1, outputPerM: 2, cacheWritePerM: 0.5, priced: true }],
  unpricedModels: [{ provider: 'openai', model: 'gpt-x' }],
}

const t = (key: string): any => ({
  loading: '加载中…', error: '加载失败', empty: '该时间段无用量数据', refresh: '刷新',
  rangeDays: (n: number) => `过去 ${n} 天`, summaryTokens: 'Token 总量', summaryAmount: '估算金额',
  chartTokens: 'Token 用量', chartAmount: '金额开销', priceTableTitle: '模型单价（M tokens）',
  priceModel: '模型', priceCacheRead: '输入命中缓存', priceInput: '输入未命中缓存', priceOutput: '输出',
  priceNotConfigured: '未配置', unpricedHint: (n: number) => `${n} 个已使用模型未配置单价`,
  seriesTotal: '总量', seriesInput: '输入', seriesOutput: '输出', seriesCacheRead: '缓存命中',
  seriesCacheWrite: '缓存写入', seriesReasoning: '推理',
}[key] ?? key)

const renderReady = () => render(<UsageStatsSection controller={{} as never}
  useSnapshot={() => ({ status: 'ready', error: null, days: 7, data: RESPONSE })} t={t} />)

describe('UsageStatsSection', () => {
  it('shows summary totals and both chart titles', () => {
    renderReady()
    expect(screen.getByText('Token 总量')).toBeTruthy()
    expect(screen.getByText('4.5M')).toBeTruthy()
    expect(screen.getByText('Token 用量')).toBeTruthy()
    expect(screen.getByText('金额开销')).toBeTruthy()
  })

  it('renders the price table with configured and unpriced rows', () => {
    renderReady()
    expect(screen.getByText('DeepSeek-V4-Flash')).toBeTruthy()
    expect(screen.getByText('¥0.1')).toBeTruthy()   // cacheReadPerM（CNY 默认符号）
    expect(screen.getByText('¥1')).toBeTruthy()     // inputPerM
    expect(screen.getByText('¥2')).toBeTruthy()     // outputPerM
    expect(screen.getByText('gpt-x')).toBeTruthy()
    expect(screen.getByText('1 个已使用模型未配置单价')).toBeTruthy()
  })

  it('shows the empty state when there is no usage', () => {
    render(<UsageStatsSection controller={{} as never}
      useSnapshot={() => ({ status: 'ready', error: null, days: 7,
        data: { ...RESPONSE, buckets: [], totals: { tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, total: 0 }, amount: null } } })}
      t={t} />)
    expect(screen.getByText('该时间段无用量数据')).toBeTruthy()
  })

  it('calls load with the selected range', () => {
    let loaded: number[] = []
    const controller = { load: (days: number) => { loaded.push(days); return Promise.resolve() }, refresh: () => Promise.resolve() }
    render(<UsageStatsSection controller={controller as never}
      useSnapshot={() => ({ status: 'ready', error: null, days: 7, data: RESPONSE })} t={t} />)
    fireEvent.click(screen.getByText('过去 15 天'))
    expect(loaded).toEqual([15])
  })

  it('shows the error state with message', () => {
    render(<UsageStatsSection controller={{} as never}
      useSnapshot={() => ({ status: 'error', error: 'boom', days: 7, data: null })} t={t} />)
    expect(screen.getByText(/加载失败: boom/)).toBeTruthy()
  })
})
