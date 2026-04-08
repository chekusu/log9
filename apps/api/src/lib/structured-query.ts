import type { StructuredQuery } from '@log9/core'

const DURATION_MAP: Record<string, string> = {
  '1m': '1 minute',
  '5m': '5 minutes',
  '10m': '10 minutes',
  '30m': '30 minutes',
  '1h': '1 hour',
  '3h': '3 hours',
  '6h': '6 hours',
  '12h': '12 hours',
  '24h': '24 hours',
  '1d': '1 day',
  '7d': '7 days',
  '30d': '30 days',
}

export function buildStructuredQuery(q: StructuredQuery): string {
  const conditions: string[] = []

  if (q.project) {
    conditions.push(`project = '${esc(q.project)}'`)
  }

  if (q.level && q.level.length > 0) {
    const levels = q.level.map((l) => `'${esc(l)}'`).join(',')
    conditions.push(`level IN (${levels})`)
  }

  if (q.since) {
    const interval = DURATION_MAP[q.since]
    if (interval) {
      conditions.push(`timestamp > now() - interval '${interval}'`)
    }
  }

  if (q.until && q.until !== 'now') {
    const interval = DURATION_MAP[q.until]
    if (interval) {
      conditions.push(`timestamp < now() - interval '${interval}'`)
    }
  }

  if (q.message_like) {
    conditions.push(`message LIKE '${esc(q.message_like)}'`)
  }

  if (q.tags) {
    for (const [key, value] of Object.entries(q.tags)) {
      conditions.push(`tags @> '{"${esc(key)}": "${esc(value)}"}'::jsonb`)
    }
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  if (q.group_by) {
    const orderBy = q.order_by === 'count' ? 'count DESC' : `${esc(q.group_by)}`
    const limit = q.limit ?? 50
    return `SELECT ${esc(q.group_by)}, COUNT(*) as count FROM events ${where} GROUP BY ${esc(q.group_by)} ORDER BY ${orderBy} LIMIT ${limit}`
  }

  const orderBy = q.order_by === 'count' ? 'timestamp DESC' : 'timestamp DESC'
  const limit = q.limit ?? 100
  return `SELECT * FROM events ${where} ORDER BY ${orderBy} LIMIT ${limit}`
}

function esc(s: string): string {
  return s.replace(/'/g, "''")
}
