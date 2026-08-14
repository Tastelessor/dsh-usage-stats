/**
 * Adapter from persisted session events to UsageSample values. Only
 * assistant/message events carrying usage count; the model source is read
 * from message.source (the session invariant guarantees kind: 'model' with a
 * provider/model pair).
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { UsageSample } from './aggregate.ts'

/** Extract in-window model-call samples from one session's raw event log. */
export function usageSamplesOf(events: readonly SessionEvent[]): UsageSample[] {
  const samples: UsageSample[] = []
  for (const event of events) {
    if (event.type !== 'assistant/message') continue
    const data = event.data
    if (data.usage === undefined) continue
    const source = data.message?.source
    if (source === undefined || source.kind !== 'model') continue
    if (typeof source.provider !== 'string' || typeof source.model !== 'string') continue
    samples.push({ time: event.time, provider: source.provider, model: source.model, usage: data.usage })
  }
  return samples
}
