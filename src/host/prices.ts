/**
 * Amount estimation from token usage and one model's per-million price.
 * reasoningTokens is a subset of outputTokens and is never added again.
 */

import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import type { ModelPrice } from '../shared/types.ts'

export interface AmountBreakdown {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  total: number
}

/** Per-bucket and total amount for one call, USD. */
export function amountBreakdown(usage: TokenUsage, price: ModelPrice): AmountBreakdown {
  const input = (usage.inputTokens / 1e6) * price.inputPerM
  const output = (usage.outputTokens / 1e6) * price.outputPerM
  const cacheRead = ((usage.cacheReadTokens ?? 0) / 1e6) * price.cacheReadPerM
  const cacheWrite = ((usage.cacheWriteTokens ?? 0) / 1e6) * price.cacheWritePerM
  return { input, output, cacheRead, cacheWrite, total: input + output + cacheRead + cacheWrite }
}

/** Total estimated amount for one call, USD. */
export function amountOf(usage: TokenUsage, price: ModelPrice): number {
  return amountBreakdown(usage, price).total
}
