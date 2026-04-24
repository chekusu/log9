import { describe, expect, it, vi } from 'vitest'
import { normalizeSdk } from '../src/adapters/sdk'
import { normalizeTwilio } from '../src/adapters/twilio'
import { normalizeCustom } from '../src/adapters/custom'

describe('adapters', () => {
  it('normalizes sdk payloads onto the target project', () => {
    const payload = {
      events: [{ project: 'old', level: 'info', message: 'event', timestamp: '2026-01-01T00:00:00.000Z' }],
      spans: [{ project: 'old', trace_id: 'trace', name: 'http', started_at: '2026-01-01T00:00:00.000Z', duration: 12 }],
    }

    expect(normalizeSdk('api', payload)).toEqual({
      events: [{ project: 'api', level: 'info', message: 'event', timestamp: '2026-01-01T00:00:00.000Z' }],
      spans: [{ project: 'api', trace_id: 'trace', name: 'http', started_at: '2026-01-01T00:00:00.000Z', duration: 12 }],
    })
  })

  it('defaults missing sdk arrays to empty lists', () => {
    expect(normalizeSdk('api', {})).toEqual({ events: [], spans: [] })
  })

  it('maps twilio failures to error events and preserves payload details', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-02-03T04:05:06.000Z'))

    const event = normalizeTwilio('voice', {
      CallSid: 'CA123',
      CallStatus: 'failed',
      From: '+100',
      To: '+200',
      Direction: 'outbound-api',
      foo: 'bar',
    })

    expect(event).toEqual({
      project: 'voice',
      level: 'error',
      message: 'Call failed: +100 → +200',
      timestamp: '2026-02-03T04:05:06.000Z',
      tags: { service: 'twilio', call_sid: 'CA123', status: 'failed', direction: 'outbound-api' },
      extra: {
        CallSid: 'CA123',
        CallStatus: 'failed',
        From: '+100',
        To: '+200',
        Direction: 'outbound-api',
        foo: 'bar',
      },
    })

    vi.useRealTimers()
  })

  it('treats no-answer twilio statuses as errors', () => {
    const event = normalizeTwilio('voice', {
      CallStatus: 'no-answer',
      From: '+100',
      To: '+200',
    })

    expect(event.level).toBe('error')
    expect(event.message).toBe('Call no-answer: +100 → +200')
  })

  it('maps non-error twilio statuses to info and fills missing tag fields', () => {
    const event = normalizeTwilio('voice', { CallStatus: 'completed', From: '+100', To: '+200' })

    expect(event.level).toBe('info')
    expect(event.tags).toEqual({ service: 'twilio', call_sid: '', status: 'completed', direction: '' })
  })

  it('fills missing twilio status fields with empty strings', () => {
    const event = normalizeTwilio('voice', { From: '+100', To: '+200' })

    expect(event.tags).toEqual({ service: 'twilio', call_sid: '', status: '', direction: '' })
  })

  it('normalizes custom payload defaults', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-04T05:06:07.000Z'))

    expect(normalizeCustom('frontend', {})).toEqual({
      project: 'frontend',
      level: 'info',
      message: 'unknown',
      timestamp: '2026-03-04T05:06:07.000Z',
      tags: undefined,
      extra: undefined,
    })

    expect(
      normalizeCustom('frontend', {
        level: 'warn',
        message: 'oops',
        tags: { area: 'billing' },
        extra: { retryable: true },
        timestamp: '2026-03-01T00:00:00.000Z',
      }),
    ).toEqual({
      project: 'frontend',
      level: 'warn',
      message: 'oops',
      timestamp: '2026-03-01T00:00:00.000Z',
      tags: { area: 'billing' },
      extra: { retryable: true },
    })

    vi.useRealTimers()
  })
})
