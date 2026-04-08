import type { Log9Event, LogLevel } from '@log9/core'

interface CustomPayload {
  level?: LogLevel
  message: string
  tags?: Record<string, string>
  extra?: Record<string, unknown>
  timestamp?: string
}

export function normalizeCustom(project: string, body: unknown): Log9Event {
  const c = body as CustomPayload
  return {
    project,
    level: c.level ?? 'info',
    message: c.message ?? 'unknown',
    timestamp: c.timestamp ?? new Date().toISOString(),
    tags: c.tags,
    extra: c.extra,
  }
}
