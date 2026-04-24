import { afterEach, describe, expect, it, vi } from 'vitest'
import { Db9Gateway } from '../src/entrypoints/db9-gateway'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Db9Gateway', () => {
  it('rejects non-read queries before calling db9', async () => {
    const gateway = new Db9Gateway({ DB9_TOKEN: 'token', DB9_DATABASE_ID: 'db' })

    await expect(gateway.query('DELETE FROM events')).rejects.toThrow('Only SELECT/WITH queries are allowed')
  })

  it('rejects multi-statement and write cte queries', async () => {
    const gateway = new Db9Gateway({ DB9_TOKEN: 'token', DB9_DATABASE_ID: 'db' })

    await expect(gateway.query('SELECT 1; DELETE FROM events')).rejects.toThrow(
      'Only single-statement SELECT/WITH queries are allowed',
    )
    await expect(gateway.query('WITH doomed AS (DELETE FROM events RETURNING *) SELECT * FROM doomed')).rejects.toThrow(
      'Only read-only SELECT/WITH queries are allowed',
    )
  })

  it('rejects select-into and locking read queries', async () => {
    const gateway = new Db9Gateway({ DB9_TOKEN: 'token', DB9_DATABASE_ID: 'db' })

    await expect(gateway.query('SELECT * INTO temp doomed FROM events')).rejects.toThrow(
      'SELECT INTO is not allowed in read-only queries',
    )
    await expect(gateway.query('SELECT * FROM events FOR SHARE')).rejects.toThrow(
      'Locking SELECT clauses are not allowed in read-only queries',
    )
  })

  it('executes trimmed read queries against db9', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ rows: [['ok']] }),
    } as unknown as Response)
    const gateway = new Db9Gateway({ DB9_TOKEN: 'token', DB9_DATABASE_ID: 'db' })

    await expect(gateway.query('  SELECT 1  ')).resolves.toEqual({ rows: [['ok']] })

    expect(fetchMock).toHaveBeenCalledWith('https://api.db9.ai/customer/databases/db/sql', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: 'SELECT 1' }),
    })
  })

  it('allows leading comments and mixed-case read queries after trimming', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ rows: [[1]] }),
    } as unknown as Response)
    const gateway = new Db9Gateway({ DB9_TOKEN: 'token', DB9_DATABASE_ID: 'db' })

    await expect(gateway.query(' /* comment */\n SeLeCt 1;  ')).resolves.toEqual({ rows: [[1]] })

    const init = fetchMock.mock.calls[0]?.[1]
    expect(init).toBeDefined()
    expect(JSON.parse(String(init?.body))).toEqual({ query: '/* comment */\n SeLeCt 1' })
  })

  it('preserves safe semicolons inside literals while trimming the statement terminator', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ rows: [['ok']] }),
    } as unknown as Response)
    const gateway = new Db9Gateway({ DB9_TOKEN: 'token', DB9_DATABASE_ID: 'db' })

    await expect(gateway.query("SELECT ';' AS literal;")).resolves.toEqual({ rows: [['ok']] })

    const init = fetchMock.mock.calls[0]?.[1]
    expect(JSON.parse(String(init?.body))).toEqual({ query: "SELECT ';' AS literal" })
  })

  it('surfaces db9 failures', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 400,
      text: vi.fn().mockResolvedValue('bad query'),
    } as unknown as Response)
    const gateway = new Db9Gateway({ DB9_TOKEN: 'token', DB9_DATABASE_ID: 'db' })

    await expect(gateway.query('WITH cte AS (SELECT 1) SELECT * FROM cte')).rejects.toThrow(
      'db9 query failed (400): bad query',
    )
  })
})
