import { describe, expect, it } from 'vitest'
import { buildStructuredQuery } from '../src/lib/structured-query'

describe('buildStructuredQuery', () => {
  it('builds a filtered event query with escaped values', () => {
    const sql = buildStructuredQuery({
      project: "proj'o",
      level: ['error', 'warn'],
      since: '1h',
      until: '30m',
      message_like: "%can't%",
      tags: { service: "api'o" },
      limit: 25,
    })

    expect(sql).toContain("project = 'proj''o'")
    expect(sql).toContain("level IN ('error','warn')")
    expect(sql).toContain("timestamp > now() - interval '1 hour'")
    expect(sql).toContain("timestamp < now() - interval '30 minutes'")
    expect(sql).toContain("message LIKE '%can''t%'")
    expect(sql).toContain(`tags @> '{"service": "api''o"}'::jsonb`)
    expect(sql).toContain('ORDER BY timestamp DESC LIMIT 25')
  })

  it('builds grouped queries and ignores unsupported intervals', () => {
    const sql = buildStructuredQuery({
      group_by: 'project',
      order_by: 'count',
      since: 'unsupported',
      until: 'now',
      limit: 10,
    })

    expect(sql).toBe('SELECT project, COUNT(*) as count FROM events  GROUP BY project ORDER BY count DESC LIMIT 10')
  })

  it('falls back to an unfiltered default query', () => {
    expect(buildStructuredQuery({})).toBe('SELECT * FROM events  ORDER BY timestamp DESC LIMIT 100')
  })

  it('keeps timestamp ordering for non-grouped count requests', () => {
    expect(buildStructuredQuery({ order_by: 'count', limit: 5 })).toBe(
      'SELECT * FROM events  ORDER BY timestamp DESC LIMIT 5',
    )
  })

  it('ignores empty level arrays and unsupported until values', () => {
    expect(
      buildStructuredQuery({
        project: 'frontend',
        level: [],
        until: 'unsupported',
      }),
    ).toBe("SELECT * FROM events WHERE project = 'frontend' ORDER BY timestamp DESC LIMIT 100")
  })
})
