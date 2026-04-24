import { afterEach, describe, expect, it, vi } from 'vitest'
import app from '../src/index'

vi.mock('../src/lib/db9', () => ({
  db9InsertEvents: vi.fn().mockResolvedValue(undefined),
  db9InsertSpans: vi.fn().mockResolvedValue(undefined),
  db9Query: vi.fn(),
}))

vi.mock('../src/lib/prompt-builder', () => ({
  buildQueryPrompt: vi.fn(),
}))

vi.mock('../src/lib/code-generator', () => ({
  generateSQL: vi.fn(),
}))

const db9 = await import('../src/lib/db9')
const prompts = await import('../src/lib/prompt-builder')
const codegen = await import('../src/lib/code-generator')

const env = {
  DB9_TOKEN: 'token',
  DB9_DATABASE_ID: 'db',
  ANTHROPIC_API_KEY: 'anthropic',
  LOG9_API_KEY: 'secret',
  LOADER: {},
}

function makeCtx() {
  return {
    waitUntil: vi.fn(),
    passThroughOnException: vi.fn(),
  }
}

function jsonRequest(path: string, body: unknown, apiKey = 'secret') {
  return new Request(`http://local${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-Log9-Key': apiKey,
    },
    body: JSON.stringify(body),
  })
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('api routes', () => {
  it('serves health and cors headers', async () => {
    const res = await app.fetch(new Request('http://local/health'), env, makeCtx())

    expect(res.status).toBe(200)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    await expect(res.json()).resolves.toMatchObject({ status: 'ok', service: 'log9' })
  })

  it('rejects unauthorized ingest and query requests', async () => {
    const ingestRes = await app.fetch(jsonRequest('/ingest/p1/sdk', {}, 'wrong'), env, makeCtx())
    const queryRes = await app.fetch(jsonRequest('/query', {}, 'wrong'), env, makeCtx())

    expect(ingestRes.status).toBe(401)
    expect(queryRes.status).toBe(401)
  })

  it('enqueues sdk events and spans', async () => {
    const ctx = makeCtx()

    const res = await app.fetch(
      jsonRequest('/ingest/app/sdk', {
        events: [{ project: 'x', level: 'info', message: 'hello', timestamp: '2026-01-01T00:00:00.000Z' }],
        spans: [{ project: 'x', trace_id: 't', name: 'span', started_at: '2026-01-01T00:00:00.000Z', duration: 12 }],
      }),
      env,
      ctx,
    )

    expect(res.status).toBe(202)
    await expect(res.json()).resolves.toEqual({ accepted: 2, persistence: 'deferred' })
    expect(db9.db9InsertEvents).toHaveBeenCalledWith(env, [
      { project: 'app', level: 'info', message: 'hello', timestamp: '2026-01-01T00:00:00.000Z' },
    ])
    expect(db9.db9InsertSpans).toHaveBeenCalledWith(env, [
      { project: 'app', trace_id: 't', name: 'span', started_at: '2026-01-01T00:00:00.000Z', duration: 12 },
    ])
    expect(ctx.waitUntil).toHaveBeenCalledTimes(1)
  })

  it('logs sdk background persistence failures while preserving the rejection', async () => {
    const ctx = makeCtx()
    const error = new Error('span insert failed')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(db9.db9InsertEvents).mockResolvedValueOnce(undefined)
    vi.mocked(db9.db9InsertSpans).mockRejectedValueOnce(error)

    const res = await app.fetch(
      jsonRequest('/ingest/app/sdk', {
        events: [{ level: 'info', message: 'hello', timestamp: '2026-01-01T00:00:00.000Z' }],
        spans: [{ trace_id: 't', name: 'span', started_at: '2026-01-01T00:00:00.000Z', duration: 12 }],
      }),
      env,
      ctx,
    )

    expect(res.status).toBe(202)
    const backgroundTask = vi.mocked(ctx.waitUntil).mock.calls[0]?.[0]
    await expect(backgroundTask).rejects.toThrow('span insert failed')
    expect(consoleError).toHaveBeenCalledWith('[ingest] background persistence failed for sdk', error)
  })

  it('enqueues twilio and custom payloads', async () => {
    const twilioCtx = makeCtx()
    const customCtx = makeCtx()

    const twilioRes = await app.fetch(
      jsonRequest('/ingest/voice/twilio', {
        CallSid: 'CA123',
        CallStatus: 'busy',
        From: '+100',
        To: '+200',
        Direction: 'outbound-api',
      }),
      env,
      twilioCtx,
    )
    const customRes = await app.fetch(
      jsonRequest('/ingest/frontend/custom', [
        { message: 'one' },
        { level: 'warn', message: 'two' },
      ]),
      env,
      customCtx,
    )

    expect(twilioRes.status).toBe(202)
    expect(customRes.status).toBe(202)
    expect(await twilioRes.json()).toEqual({ accepted: 1, persistence: 'deferred' })
    expect(await customRes.json()).toEqual({ accepted: 2, persistence: 'deferred' })
    expect(db9.db9InsertEvents).toHaveBeenNthCalledWith(
      1,
      env,
      [
        expect.objectContaining({
          project: 'voice',
          level: 'error',
          message: 'Call busy: +100 → +200',
        }),
      ],
    )
    expect(db9.db9InsertEvents).toHaveBeenNthCalledWith(2, env, [
      expect.objectContaining({ project: 'frontend', level: 'info', message: 'one' }),
      expect.objectContaining({ project: 'frontend', level: 'warn', message: 'two' }),
    ])
    expect(twilioCtx.waitUntil).toHaveBeenCalledTimes(1)
    expect(customCtx.waitUntil).toHaveBeenCalledTimes(1)
  })

  it('wraps a single custom payload into an event list', async () => {
    const ctx = makeCtx()

    const res = await app.fetch(jsonRequest('/ingest/frontend/custom', { message: 'solo' }), env, ctx)

    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ accepted: 1, persistence: 'deferred' })
    expect(db9.db9InsertEvents).toHaveBeenCalledWith(env, [expect.objectContaining({ message: 'solo' })])
  })

  it('runs nl queries through prompt building and sql generation', async () => {
    vi.mocked(prompts.buildQueryPrompt).mockResolvedValue({ system: 'system', user: 'user prompt' })
    vi.mocked(codegen.generateSQL).mockResolvedValue('SELECT * FROM events LIMIT 5')
    vi.mocked(db9.db9Query).mockResolvedValue({
      columns: [{ name: 'message', type: 'text' }],
      rows: [['ok']],
      row_count: 1,
    })

    const res = await app.fetch(jsonRequest('/query', { q: 'show me errors' }), env, makeCtx())

    expect(res.status).toBe(200)
    expect(prompts.buildQueryPrompt).toHaveBeenCalledWith(env, 'show me errors')
    expect(codegen.generateSQL).toHaveBeenCalledWith({
      system: 'system',
      user: 'user prompt',
      apiKey: 'anthropic',
    })
    await expect(res.json()).resolves.toEqual({
      sql: 'SELECT * FROM events LIMIT 5',
      columns: [{ name: 'message', type: 'text' }],
      rows: [['ok']],
      row_count: 1,
    })
  })

  it('renders html query results for structured requests', async () => {
    vi.mocked(db9.db9Query).mockResolvedValue({
      columns: [{ name: '<script>' }],
      rows: [[null], ['<&">']],
      row_count: 1,
    })

    const res = await app.fetch(
      jsonRequest('/query', { project: 'frontend', format: 'html', group_by: 'project' }),
      env,
      makeCtx(),
    )

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    const html = await res.text()
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('<em>null</em>')
    expect(html).toContain('&lt;&amp;&quot;&gt;')
    expect(html).toContain('1 row')
    expect(db9.db9Query).toHaveBeenCalledWith(
      env,
      'SELECT project, COUNT(*) as count FROM events WHERE project = \'frontend\' GROUP BY project ORDER BY project LIMIT 50',
    )
  })

  it('renders plural row labels for html responses', async () => {
    vi.mocked(db9.db9Query).mockResolvedValue({
      columns: [{ name: 'message' }],
      rows: [['one'], ['two']],
      row_count: 2,
    })

    const res = await app.fetch(jsonRequest('/query', { project: 'frontend', format: 'html' }), env, makeCtx())

    expect(await res.text()).toContain('2 rows')
  })

  it('rejects generated non-read queries', async () => {
    vi.mocked(prompts.buildQueryPrompt).mockResolvedValue({ system: 'system', user: 'user prompt' })
    vi.mocked(codegen.generateSQL).mockResolvedValue('DELETE FROM events')

    const res = await app.fetch(jsonRequest('/query', { q: 'drop everything' }), env, makeCtx())

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({
      error: 'Only SELECT/WITH queries are allowed',
      sql: 'DELETE FROM events',
    })
    expect(db9.db9Query).not.toHaveBeenCalled()
  })

  it('rejects multi-statement generated sql', async () => {
    vi.mocked(prompts.buildQueryPrompt).mockResolvedValue({ system: 'system', user: 'user prompt' })
    vi.mocked(codegen.generateSQL).mockResolvedValue('SELECT * FROM events; DELETE FROM events')

    const res = await app.fetch(jsonRequest('/query', { q: 'show and delete' }), env, makeCtx())

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({
      error: 'Only single-statement SELECT/WITH queries are allowed',
      sql: 'SELECT * FROM events; DELETE FROM events',
    })
  })

  it('allows WITH queries to pass through to db9', async () => {
    vi.mocked(prompts.buildQueryPrompt).mockResolvedValue({ system: 'system', user: 'user prompt' })
    vi.mocked(codegen.generateSQL).mockResolvedValue('WITH recent AS (SELECT 1) SELECT * FROM recent')
    vi.mocked(db9.db9Query).mockResolvedValue({
      columns: [{ name: 'value', type: 'int' }],
      rows: [[1]],
      row_count: 1,
    })

    const res = await app.fetch(jsonRequest('/query', { q: 'show recent' }), env, makeCtx())

    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({
      sql: 'WITH recent AS (SELECT 1) SELECT * FROM recent',
      columns: [{ name: 'value', type: 'int' }],
      rows: [[1]],
      row_count: 1,
    })
    expect(db9.db9Query).toHaveBeenCalledWith(env, 'WITH recent AS (SELECT 1) SELECT * FROM recent')
  })

  it('rejects write ctes generated by nl queries', async () => {
    vi.mocked(prompts.buildQueryPrompt).mockResolvedValue({ system: 'system', user: 'user prompt' })
    vi.mocked(codegen.generateSQL).mockResolvedValue('WITH doomed AS (DELETE FROM events RETURNING *) SELECT * FROM doomed')

    const res = await app.fetch(jsonRequest('/query', { q: 'delete with cte' }), env, makeCtx())

    expect(res.status).toBe(400)
    await expect(res.json()).resolves.toEqual({
      error: 'Only read-only SELECT/WITH queries are allowed',
      sql: 'WITH doomed AS (DELETE FROM events RETURNING *) SELECT * FROM doomed',
    })
    expect(db9.db9Query).not.toHaveBeenCalled()
  })

  it('rejects generated select-into and locking sql', async () => {
    vi.mocked(prompts.buildQueryPrompt).mockResolvedValue({ system: 'system', user: 'user prompt' })

    vi.mocked(codegen.generateSQL).mockResolvedValueOnce('SELECT * INTO temp doomed FROM events')
    const selectIntoRes = await app.fetch(jsonRequest('/query', { q: 'materialize events' }), env, makeCtx())

    expect(selectIntoRes.status).toBe(400)
    await expect(selectIntoRes.json()).resolves.toEqual({
      error: 'SELECT INTO is not allowed in read-only queries',
      sql: 'SELECT * INTO temp doomed FROM events',
    })

    vi.mocked(codegen.generateSQL).mockResolvedValueOnce('SELECT * FROM events FOR UPDATE')
    const lockingRes = await app.fetch(jsonRequest('/query', { q: 'lock rows' }), env, makeCtx())

    expect(lockingRes.status).toBe(400)
    await expect(lockingRes.json()).resolves.toEqual({
      error: 'Locking SELECT clauses are not allowed in read-only queries',
      sql: 'SELECT * FROM events FOR UPDATE',
    })
    expect(db9.db9Query).not.toHaveBeenCalled()
  })
})
