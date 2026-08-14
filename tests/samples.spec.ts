/** SessionEvent → UsageSample extraction. */
import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { usageSamplesOf } from '../src/host/samples.ts'

const assistant = (time: number, model: string, usage?: object): SessionEvent => ({
  seq: 1,
  time,
  type: 'assistant/message',
  data: {
    turn: 0,
    step: 0,
    message: { id: `m-${time}`, role: 'assistant', source: { kind: 'model', provider: 'deepseek-official', model }, content: [] },
    ...(usage !== undefined ? { usage } : {}),
  },
} as SessionEvent)

describe('usageSamplesOf', () => {
  it('extracts usage with provider/model source', () => {
    const samples = usageSamplesOf([
      assistant(1000, 'deepseek-v4-flash', { inputTokens: 5, outputTokens: 1 }),
    ])
    expect(samples).toEqual([
      { time: 1000, provider: 'deepseek-official', model: 'deepseek-v4-flash',
        usage: { inputTokens: 5, outputTokens: 1 } },
    ])
  })

  it('skips events without usage and non-model sources', () => {
    const samples = usageSamplesOf([
      assistant(1000, 'deepseek-v4-flash'),
      { seq: 2, time: 2000, type: 'tool/call', data: { turn: 0, step: 0, callId: 'c', name: 'bash', arguments: '{}' } } as SessionEvent,
    ])
    expect(samples).toEqual([])
  })
})
