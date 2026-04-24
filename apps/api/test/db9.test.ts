import { afterEach, describe, expect, it, vi } from 'vitest'
import { db9InsertEvents, db9InsertSpans, db9Query } from '../src/lib/db9'
import type { Bindings } from '../src/types'

const env: Bindings = {
  DB9_TOKEN: 'token',
  DB9_DATABASE_ID: 'db',
  ANTHROPIC_API_KEY: 'anthropic',
  LOG9_API_KEY: 'log9',
  LOADER: {},
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('db9 library', () => {
  it('queries db9 successfully', async () => {
    const json = vi.fn().mockResolvedValue({ rows: [], columns: [], row_count: 0 })
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }))
    fetchMock.mockResolvedValue({
      ok: true,
      json,
    } as unknown as Response)

    const result = await db9Query(env, 'SELECT 1')

    expect(result).toEqual({ rows: [], columns: [], row_count: 0 })
    expect(fetchMock).toHaveBeenCalledWith('https://api.db9.ai/customer/databases/db/sql', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: 'SELECT 1' }),
    })
  })

  it('surfaces db9 query errors', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 503,
      text: vi.fn().mockResolvedValue('down'),
    } as unknown as Response)

    await expect(db9Query(env, 'SELECT 1')).rejects.toThrow('db9 query failed (503): down')
  })

  it('skips inserts when there is nothing to write', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')

    await db9InsertEvents(env, [])
    await db9InsertSpans(env, [])

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('inserts events with escaped fields and generated ids', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({}),
    } as unknown as Response)
    vi.stubGlobal('crypto', {
      ...crypto,
      randomUUID: vi.fn().mockReturnValue('generated-event-id'),
    })

    await db9InsertEvents(env, [
      {
        project: "proj'o",
        level: 'error',
        message: "bad 'quote'",
        timestamp: '2026-01-01T00:00:00.000Z',
        trace_id: "trace'o",
        tags: { region: "o'hare" },
        extra: { count: 1 },
        breadcrumbs: [{ timestamp: '2026-01-01T00:00:00.000Z', category: 'ui', message: 'clicked' }],
        stack_trace: "boom'stack",
      },
      {
        id: 'known-event-id',
        project: 'plain',
        level: 'info',
        message: 'plain',
        timestamp: '2026-01-01T00:00:01.000Z',
      },
    ])

    const init = fetchMock.mock.calls[0]?.[1]
    expect(init).toBeDefined()
    const body = JSON.parse(String(init?.body)) as { query: string }
    expect(body.query).toContain("'generated-event-id'")
    expect(body.query).toContain("'known-event-id'")
    expect(body.query).toContain("proj''o")
    expect(body.query).toContain("bad ''quote''")
    expect(body.query).toContain("trace''o")
    expect(body.query).toContain(`"region":"o''hare"`)
    expect(body.query).toContain("boom''stack")
    expect(body.query).toContain('NULL')
  })

  it('inserts spans with explicit and null status values', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({}),
    } as unknown as Response)
    vi.stubGlobal('crypto', {
      ...crypto,
      randomUUID: vi.fn().mockReturnValue('generated-span-id'),
    })

    await db9InsertSpans(env, [
      {
        project: 'api',
        trace_id: 'trace',
        name: "rpc'o",
        started_at: '2026-01-01T00:00:00.000Z',
        duration: 42,
        tags: { route: '/query' },
      },
      {
        id: 'known-id',
        project: 'api',
        trace_id: 'trace-2',
        name: 'rpc',
        started_at: '2026-01-01T00:00:01.000Z',
        duration: 4,
        status: 500,
      },
    ])

    const init = fetchMock.mock.calls[0]?.[1]
    const body = JSON.parse(String(init?.body)) as { query: string }
    expect(body.query).toContain("'generated-span-id'")
    expect(body.query).toContain("'known-id'")
    expect(body.query).toContain("rpc''o")
    expect(body.query).toContain('NULL')
    expect(body.query).toContain(', 500,')
  })

  it('preserves an explicit zero span status', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({}),
    } as unknown as Response)

    await db9InsertSpans(env, [
      {
        project: 'api',
        trace_id: 'trace',
        name: 'rpc',
        started_at: '2026-01-01T00:00:00.000Z',
        duration: 1,
        status: 0,
      },
    ])

    const init = fetchMock.mock.calls[0]?.[1]
    const body = JSON.parse(String(init?.body)) as { query: string }
    expect(body.query).toContain(', 0,')
  })
})
