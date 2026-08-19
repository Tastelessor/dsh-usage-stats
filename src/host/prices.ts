/**
 * Amount estimation from token usage and one model's per-million price.
 * reasoningTokens is a subset of outputTokens and is never added again.
 *
 * Official DeepSeek pricing (2026-08-17+) is time-of-day tiered: peak hours
 * are Beijing time 09:00–12:00 and 14:00–18:00, off-peak is half of peak.
 * Every bucket's amount is resolved from the event's own timestamp, so a
 * 9:01 call is billed at the peak rate and a 2:00 call at the off-peak rate.
 * Beijing time is fixed UTC+8 (no DST), so the hour is derived from UTC
 * directly — never from the host's local timezone.
 */

import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import type { ModelPrice, Tier, TieredModelPrice } from '../shared/types.ts'
import type { TokenTotals } from '../shared/types.ts'

/** Beijing (UTC+8) hour of an instant; the official peak windows are Beijing-time. */
export function beijingHour(ms: number): number {
  return (new Date(ms).getUTCHours() + 8) % 24
}

/** Official peak windows: 09:00–12:00 and 14:00–18:00 Beijing time (start-inclusive). */
export function tierOf(ms: number): Tier {
  const hour = beijingHour(ms)
  return (hour >= 9 && hour < 12) || (hour >= 14 && hour < 18) ? 'peak' : 'offPeak'
}

export interface AmountBreakdown {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  total: number
}

/** Per-bucket and total amount for one call, resolved to the time's tier. */
export function amountBreakdown(usage: TokenUsage, price: TieredModelPrice, timeMs: number): AmountBreakdown {
  const tier: ModelPrice = price[tierOf(timeMs)]
  const input = (usage.inputTokens / 1e6) * tier.inputPerM
  const output = (usage.outputTokens / 1e6) * tier.outputPerM
  const cacheRead = ((usage.cacheReadTokens ?? 0) / 1e6) * tier.cacheReadPerM
  const cacheWrite = ((usage.cacheWriteTokens ?? 0) / 1e6) * tier.cacheWritePerM
  return { input, output, cacheRead, cacheWrite, total: input + output + cacheRead + cacheWrite }
}

/** Total estimated amount for one call, resolved to the time's tier. */
export function amountOf(usage: TokenUsage, price: TieredModelPrice, timeMs: number): number {
  return amountBreakdown(usage, price, timeMs).total
}

/**
 * Total estimated amount from aggregated per-tier token totals. The caller
 * picks the tier's ModelPrice; amounts scale linearly, so summing tokens
 * first and multiplying once is equivalent to per-event billing.
 */
export function amountOfTotals(
  tokens: Pick<TokenTotals, 'input' | 'output' | 'cacheRead' | 'cacheWrite'>,
  price: ModelPrice,
): number {
  return (tokens.input / 1e6) * price.inputPerM
    + (tokens.cacheRead / 1e6) * price.cacheReadPerM
    + (tokens.cacheWrite / 1e6) * price.cacheWritePerM
    + (tokens.output / 1e6) * price.outputPerM
}