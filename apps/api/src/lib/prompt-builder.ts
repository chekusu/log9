import { db9Query } from './db9'
import type { Bindings } from '../types'

const SYSTEM_PROMPT = `You are a SQL query generator for a log database running on PostgreSQL (db9.ai).
You generate ONLY a single SQL SELECT query — no explanations, no markdown fences.

TABLES:
{SCHEMA}

RULES:
- Output ONLY the SQL query, nothing else
- Only SELECT or WITH statements allowed
- Use TIMESTAMPTZ comparisons with now() and interval for time filters
- Use JSONB operators (@>, ->>, ?) for tags/extra filtering
- Always include ORDER BY and LIMIT (default LIMIT 100)
- For aggregations, use GROUP BY and COUNT/AVG/SUM as needed
- Column "timestamp" is TIMESTAMPTZ, use it for time-based queries
- Column "tags" and "extra" are JSONB
- The "project" column identifies which product the log belongs to

EXAMPLES:
- "tuwa errors last hour" → SELECT * FROM events WHERE project = 'tuwa' AND level = 'error' AND timestamp > now() - interval '1 hour' ORDER BY timestamp DESC LIMIT 100
- "error count by project today" → SELECT project, COUNT(*) as count FROM events WHERE level = 'error' AND timestamp > now() - interval '1 day' GROUP BY project ORDER BY count DESC LIMIT 50
- "slow requests over 1s" → SELECT * FROM spans WHERE duration > 1000 ORDER BY duration DESC LIMIT 100`

export async function buildQueryPrompt(env: Bindings, userQuery: string): Promise<{ system: string; user: string }> {
  let schema: string
  try {
    const result = await db9Query(env, `
      SELECT table_name, column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public'
      ORDER BY table_name, ordinal_position
    `)
    const tables: Record<string, string[]> = {}
    for (const row of result.rows) {
      const table = row[0] as string
      const column = row[1] as string
      const type = row[2] as string
      if (!tables[table]) tables[table] = []
      tables[table]!.push(`${column} (${type})`)
    }
    schema = Object.entries(tables)
      .map(([t, cols]) => `- ${t}: ${cols.join(', ')}`)
      .join('\n')
  } catch {
    schema = `- events: id (text), project (text), level (text), message (text), timestamp (timestamptz), trace_id (text), tags (jsonb), extra (jsonb), breadcrumbs (jsonb), stack_trace (text)
- spans: id (text), project (text), trace_id (text), name (text), started_at (timestamptz), duration (float), status (int), tags (jsonb)`
  }

  return {
    system: SYSTEM_PROMPT.replace('{SCHEMA}', schema),
    user: userQuery,
  }
}
