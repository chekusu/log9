import { Hono } from 'hono'
import type { Env } from '../types'
import { db9Query } from '../lib/db9'
import { buildQueryPrompt } from '../lib/prompt-builder'
import { generateSQL } from '../lib/code-generator'
import { buildStructuredQuery } from '../lib/structured-query'
import { assertReadOnlySql } from '../lib/sql-guard'
import type { NLQuery, StructuredQuery } from '@log9/core'

const query = new Hono<Env>()

query.use('*', async (c, next) => {
  const key = c.req.header('X-Log9-Key')
  if (!key || key !== c.env.LOG9_API_KEY) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  await next()
})

function isNLQuery(body: unknown): body is NLQuery {
  return typeof body === 'object' && body !== null && 'q' in body && typeof (body as NLQuery).q === 'string'
}

query.post('/', async (c) => {
  const body = await c.req.json()
  let sql: string

  if (isNLQuery(body)) {
    const { system, user } = await buildQueryPrompt(c.env, body.q)
    sql = await generateSQL({
      system,
      user,
      apiKey: c.env.ANTHROPIC_API_KEY,
    })
  } else {
    sql = buildStructuredQuery(body as StructuredQuery)
  }

  try {
    sql = assertReadOnlySql(sql)
  } catch (error) {
    return c.json({ error: (error as Error).message, sql }, 400)
  }

  const result = await db9Query(c.env, sql)

  const format = (body as { format?: string }).format ?? 'json'
  if (format === 'html') {
    return c.html(renderResultTable(sql, result))
  }

  return c.json({ sql, ...result })
})

function renderResultTable(sql: string, result: { columns: Array<{ name: string }>; rows: unknown[][]; row_count: number }): string {
  const headers = result.columns.map((col) => `<th>${escHtml(col.name)}</th>`).join('')
  const rows = result.rows
    .map(
      (row) =>
        `<tr>${row.map((cell) => `<td>${cell === null ? '<em>null</em>' : escHtml(String(cell))}</td>`).join('')}</tr>`,
    )
    .join('')

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>log9 query</title>
<style>
  body { font-family: system-ui, sans-serif; padding: 24px; background: #0d1117; color: #c9d1d9; }
  pre { background: #161b22; padding: 12px; border-radius: 6px; overflow-x: auto; color: #79c0ff; }
  table { border-collapse: collapse; width: 100%; margin-top: 16px; }
  th { background: #161b22; text-align: left; padding: 8px 12px; border-bottom: 1px solid #30363d; }
  td { padding: 8px 12px; border-bottom: 1px solid #21262d; max-width: 400px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  tr:hover td { background: #161b22; }
  .meta { color: #8b949e; font-size: 14px; margin-top: 8px; }
</style></head><body>
<h2>log9 query</h2>
<pre>${escHtml(sql)}</pre>
<p class="meta">${result.row_count} row${result.row_count === 1 ? '' : 's'}</p>
<table><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table>
</body></html>`
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export default query
