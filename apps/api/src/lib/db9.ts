import type { Bindings } from '../types'
import type { Log9Event, Log9Span } from '@log9/core'

const DB9_API = 'https://api.db9.ai/customer/databases'

export async function db9Query(env: Bindings, sql: string) {
  const res = await fetch(`${DB9_API}/${env.DB9_DATABASE_ID}/sql`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.DB9_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`db9 query failed (${res.status}): ${text}`)
  }
  return res.json() as Promise<{ columns: Array<{ name: string; type: string }>; rows: unknown[][]; row_count: number }>
}

export async function db9InsertEvents(env: Bindings, events: Log9Event[]): Promise<void> {
  if (events.length === 0) return
  const values = events.map((e) => {
    const id = e.id ?? crypto.randomUUID()
    return `(
      '${esc(id)}', '${esc(e.project)}', '${esc(e.level)}', '${esc(e.message)}',
      '${esc(e.timestamp)}', ${e.trace_id ? `'${esc(e.trace_id)}'` : 'NULL'},
      ${e.tags ? `'${esc(JSON.stringify(e.tags))}'::jsonb` : 'NULL'},
      ${e.extra ? `'${esc(JSON.stringify(e.extra))}'::jsonb` : 'NULL'},
      ${e.breadcrumbs ? `'${esc(JSON.stringify(e.breadcrumbs))}'::jsonb` : 'NULL'},
      ${e.stack_trace ? `'${esc(e.stack_trace)}'` : 'NULL'}
    )`
  })

  const sql = `INSERT INTO events (id, project, level, message, timestamp, trace_id, tags, extra, breadcrumbs, stack_trace) VALUES ${values.join(',')}`
  await db9Query(env, sql)
}

export async function db9InsertSpans(env: Bindings, spans: Log9Span[]): Promise<void> {
  if (spans.length === 0) return
  const values = spans.map((s) => {
    const id = s.id ?? crypto.randomUUID()
    return `(
      '${esc(id)}', '${esc(s.project)}', '${esc(s.trace_id)}', '${esc(s.name)}',
      '${esc(s.started_at)}', ${s.duration}, ${s.status ?? 'NULL'},
      ${s.tags ? `'${esc(JSON.stringify(s.tags))}'::jsonb` : 'NULL'}
    )`
  })

  const sql = `INSERT INTO spans (id, project, trace_id, name, started_at, duration, status, tags) VALUES ${values.join(',')}`
  await db9Query(env, sql)
}

function esc(s: string): string {
  return s.replace(/'/g, "''")
}
