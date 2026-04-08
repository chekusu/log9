import type { Log9Event, Log9Span } from '@log9/core'

interface SdkPayload {
  events?: Log9Event[]
  spans?: Log9Span[]
}

export function normalizeSdk(project: string, body: unknown): { events: Log9Event[]; spans: Log9Span[] } {
  const payload = body as SdkPayload
  const events = (payload.events ?? []).map((e) => ({ ...e, project }))
  const spans = (payload.spans ?? []).map((s) => ({ ...s, project }))
  return { events, spans }
}
