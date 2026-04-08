import type { Log9Event } from '@log9/core'

interface TwilioStatusCallback {
  CallSid: string
  CallStatus: string
  From: string
  To: string
  Direction: string
  [key: string]: unknown
}

export function normalizeTwilio(project: string, body: unknown): Log9Event {
  const t = body as TwilioStatusCallback
  return {
    project,
    level: t.CallStatus === 'failed' || t.CallStatus === 'busy' || t.CallStatus === 'no-answer' ? 'error' : 'info',
    message: `Call ${t.CallStatus}: ${t.From} → ${t.To}`,
    timestamp: new Date().toISOString(),
    tags: {
      service: 'twilio',
      call_sid: t.CallSid ?? '',
      status: t.CallStatus ?? '',
      direction: t.Direction ?? '',
    },
    extra: t as Record<string, unknown>,
  }
}
