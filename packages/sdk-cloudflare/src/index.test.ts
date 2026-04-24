import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@log9/core', async () => {
  const actual = await vi.importActual<typeof import('../../core/src/index')>('../../core/src/index')
  return actual
})

import { Log9Client, withLog9 } from './index'
import { Transport } from '../../core/src/transport'
import { isCapturedError, markCapturedError } from './integrations/error-state'
import { withErrorCapture } from './integrations/error'
import { withRequestLogging } from './integrations/fetch'

type TestExecutionContext = {
  waitUntil: ReturnType<typeof vi.fn>
  passThroughOnException: ReturnType<typeof vi.fn>
  props: Record<string, unknown>
}

function createCtx() {
  return {
    waitUntil: vi.fn((promise?: Promise<unknown>) => promise),
    passThroughOnException: vi.fn(),
    props: {},
  } as unknown as TestExecutionContext
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('withErrorCapture', () => {
  it('captures exception metadata, flushes, and rethrows', async () => {
    const client = new Log9Client({
      project: 'proj',
      endpoint: 'https://log9.example',
      apiKey: 'key',
    })
    const captureException = vi.spyOn(client, 'captureException')
    const flush = vi.spyOn(client, 'flush').mockResolvedValue()
    const ctx = createCtx()
    const request = new Request('https://example.com/fail', { method: 'POST' })
    const error = new Error('boom')
    const handler = withErrorCapture(client, async () => {
      throw error
    })

    await expect(handler(request, {}, ctx)).rejects.toThrow(error)

    expect(captureException).toHaveBeenCalledWith(error, {
      tags: {
        url: request.url,
        method: request.method,
      },
    })
    expect(flush).toHaveBeenCalledOnce()
    expect(ctx.waitUntil).toHaveBeenCalledWith(flush.mock.results[0]?.value)
    expect(isCapturedError(error)).toBe(true)
  })

  it('does not capture or flush the same thrown error twice across nested wrappers', async () => {
    const client = new Log9Client({
      project: 'proj',
      endpoint: 'https://log9.example',
      apiKey: 'key',
    })
    const captureException = vi.spyOn(client, 'captureException')
    const flush = vi.spyOn(client, 'flush').mockResolvedValue()
    const ctx = createCtx()
    const request = new Request('https://example.com/fail', { method: 'GET' })
    const error = new Error('boom')
    const handler = withErrorCapture(client, withErrorCapture(client, async () => {
      throw error
    }))

    await expect(handler(request, {}, ctx)).rejects.toThrow(error)

    expect(captureException).toHaveBeenCalledOnce()
    expect(flush).toHaveBeenCalledOnce()
    expect(ctx.waitUntil).toHaveBeenCalledOnce()
  })

  it('tracks capture state only for Error instances', () => {
    const error = new Error('plain')

    expect(isCapturedError(error)).toBe(false)

    markCapturedError('boom')
    expect(isCapturedError('boom')).toBe(false)

    markCapturedError(error)
    expect(isCapturedError(error)).toBe(true)
  })
})

describe('withRequestLogging', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(Date, 'now').mockReturnValueOnce(1_000).mockReturnValueOnce(1_050)
    vi.stubGlobal('crypto', {
      randomUUID: vi.fn().mockReturnValue('generated-trace-id'),
    })
  })

  it('records spans for success responses and flushes via waitUntil', async () => {
    const client = new Log9Client({
      project: 'proj',
      endpoint: 'https://log9.example',
      apiKey: 'key',
    })
    const addBreadcrumb = vi.spyOn(client, 'addBreadcrumb')
    const pushSpan = vi.spyOn(client.transport, 'pushSpan').mockImplementation(() => {})
    const captureEvent = vi.spyOn(client, 'captureEvent')
    const flush = vi.spyOn(client, 'flush').mockResolvedValue()
    const ctx = createCtx()
    const request = new Request('https://example.com/users?id=1', {
      method: 'GET',
      headers: { 'x-trace-id': 'trace-123' },
    })
    const handler = withRequestLogging(client, async () => new Response(null, { status: 204 }))

    const response = await handler(request, {}, ctx)

    expect(response.status).toBe(204)
    expect(addBreadcrumb).toHaveBeenCalledWith({
      category: 'http',
      message: 'GET /users',
    })
    expect(pushSpan).toHaveBeenCalledWith(
      expect.objectContaining({
        project: 'proj',
        trace_id: 'trace-123',
        name: 'GET /users',
        duration: 50,
        status: 204,
        tags: {
          method: 'GET',
          pathname: '/users',
        },
      }),
    )
    expect(captureEvent).not.toHaveBeenCalled()
    expect(ctx.waitUntil).toHaveBeenCalledWith(flush.mock.results[0]?.value)
  })

  it('emits warn event for 4xx responses using generated trace ids', async () => {
    const client = new Log9Client({
      project: 'proj',
      endpoint: 'https://log9.example',
      apiKey: 'key',
    })
    const pushSpan = vi.spyOn(client.transport, 'pushSpan').mockImplementation(() => {})
    const captureEvent = vi.spyOn(client, 'captureEvent')
    const flush = vi.spyOn(client, 'flush').mockResolvedValue()
    const ctx = createCtx()
    const request = new Request('https://example.com/missing', { method: 'DELETE' })
    const handler = withRequestLogging(client, async () => new Response('missing', { status: 404 }))

    const response = await handler(request, {}, ctx)

    expect(response.status).toBe(404)
    expect(pushSpan).toHaveBeenCalledWith(
      expect.objectContaining({
        trace_id: 'generated-trace-id',
        status: 404,
      }),
    )
    expect(captureEvent).toHaveBeenCalledWith('warn', 'DELETE /missing → 404', { duration: 50 })
    expect(ctx.waitUntil).toHaveBeenCalledWith(flush.mock.results[0]?.value)
  })

  it('does not emit events for sub-400 responses', async () => {
    const client = new Log9Client({
      project: 'proj',
      endpoint: 'https://log9.example',
      apiKey: 'key',
    })
    const pushSpan = vi.spyOn(client.transport, 'pushSpan').mockImplementation(() => {})
    const captureEvent = vi.spyOn(client, 'captureEvent')
    const flush = vi.spyOn(client, 'flush').mockResolvedValue()
    const ctx = createCtx()
    const request = new Request('https://example.com/created', { method: 'POST' })
    const handler = withRequestLogging(client, async () => new Response('created', { status: 201 }))

    const response = await handler(request, {}, ctx)

    expect(response.status).toBe(201)
    expect(pushSpan).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'POST /created',
        status: 201,
      }),
    )
    expect(captureEvent).not.toHaveBeenCalled()
    expect(ctx.waitUntil).toHaveBeenCalledWith(flush.mock.results[0]?.value)
  })

  it('records only a span for thrown handler errors and rethrows without flushing', async () => {
    const client = new Log9Client({
      project: 'proj',
      endpoint: 'https://log9.example',
      apiKey: 'key',
    })
    const pushSpan = vi.spyOn(client.transport, 'pushSpan').mockImplementation(() => {})
    const captureEvent = vi.spyOn(client, 'captureEvent')
    const flush = vi.spyOn(client, 'flush').mockResolvedValue()
    const ctx = createCtx()
    const request = new Request('https://example.com/crash', { method: 'PUT' })
    const error = new Error('handler exploded')
    const handler = withRequestLogging(client, async () => {
      throw error
    })

    await expect(handler(request, {}, ctx)).rejects.toThrow(error)

    expect(pushSpan).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'PUT /crash',
        status: 500,
      }),
    )
    expect(captureEvent).not.toHaveBeenCalled()
    expect(flush).not.toHaveBeenCalled()
    expect(ctx.waitUntil).not.toHaveBeenCalled()
  })

  it('emits error events for returned 5xx responses without throwing', async () => {
    const client = new Log9Client({
      project: 'proj',
      endpoint: 'https://log9.example',
      apiKey: 'key',
    })
    const pushSpan = vi.spyOn(client.transport, 'pushSpan').mockImplementation(() => {})
    const captureEvent = vi.spyOn(client, 'captureEvent')
    const flush = vi.spyOn(client, 'flush').mockResolvedValue()
    const ctx = createCtx()
    const request = new Request('https://example.com/unavailable', { method: 'GET' })
    const handler = withRequestLogging(client, async () => new Response('down', { status: 503 }))

    const response = await handler(request, {}, ctx)

    expect(response.status).toBe(503)
    expect(pushSpan).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'GET /unavailable',
        status: 503,
      }),
    )
    expect(captureEvent).toHaveBeenCalledWith('error', 'GET /unavailable → 503', { duration: 50 })
    expect(ctx.waitUntil).toHaveBeenCalledWith(flush.mock.results[0]?.value)
  })

  it('surfaces synchronous flush failures from the finally block', async () => {
    const client = new Log9Client({
      project: 'proj',
      endpoint: 'https://log9.example',
      apiKey: 'key',
    })
    vi.spyOn(client.transport, 'pushSpan').mockImplementation(() => {})
    vi.spyOn(client, 'flush').mockImplementation(() => {
      throw new Error('flush failed')
    })
    const ctx = createCtx()
    const request = new Request('https://example.com/finally', { method: 'GET' })
    const handler = withRequestLogging(client, async () => new Response('ok', { status: 200 }))

    await expect(handler(request, {}, ctx)).rejects.toThrow('flush failed')
  })
})

describe('withLog9', () => {
  it('builds a client from env-derived options and composes error plus request instrumentation', async () => {
    const ctx = createCtx()
    const worker = {
      fetch: vi.fn(async () => new Response('created', { status: 201 })),
    }
    const wrapped = withLog9(
      (env: { LOG9_PROJECT: string; LOG9_DEBUG: boolean }) => ({
        project: env.LOG9_PROJECT,
        endpoint: 'https://log9.example',
        apiKey: 'secret',
        debug: env.LOG9_DEBUG,
      }),
      worker,
    )

    const flushSpy = vi.spyOn(Log9Client.prototype, 'flush').mockResolvedValue()
    const addBreadcrumbSpy = vi.spyOn(Log9Client.prototype, 'addBreadcrumb')
    const pushSpanSpy = vi.spyOn(Transport.prototype, 'pushSpan').mockImplementation(() => {})

    const response = await wrapped.fetch(
      new Request('https://example.com/items', { method: 'PATCH' }),
      { LOG9_PROJECT: 'edge-project', LOG9_DEBUG: true },
      ctx,
    )

    expect(response.status).toBe(201)
    expect(worker.fetch).toHaveBeenCalledOnce()
    const workerCall = worker.fetch.mock.calls[0] as unknown[] | undefined
    expect(workerCall?.[1]).toEqual({ LOG9_PROJECT: 'edge-project', LOG9_DEBUG: true })
    expect(addBreadcrumbSpy).toHaveBeenCalledWith({
      category: 'http',
      message: 'PATCH /items',
    })
    expect(pushSpanSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        project: 'edge-project',
        name: 'PATCH /items',
        status: 201,
      }),
    )
    expect(flushSpy).toHaveBeenCalled()
    expect(ctx.waitUntil).toHaveBeenCalled()
  })

  it('accepts static options and captures worker exceptions once before rethrowing', async () => {
    const ctx = createCtx()
    const error = new Error('worker failed')
    const worker = {
      fetch: vi.fn(async () => {
        throw error
      }),
    }
    const wrapped = withLog9(
      {
        project: 'static-project',
        endpoint: 'https://log9.example',
        apiKey: 'secret',
      },
      worker,
    )
    const captureException = vi.spyOn(Log9Client.prototype, 'captureException')
    const captureEvent = vi.spyOn(Log9Client.prototype, 'captureEvent')
    const pushSpanSpy = vi.spyOn(Transport.prototype, 'pushSpan').mockImplementation(() => {})
    const flushSpy = vi.spyOn(Log9Client.prototype, 'flush').mockResolvedValue()

    await expect(
      wrapped.fetch(new Request('https://example.com/broken', { method: 'GET' }), {}, ctx),
    ).rejects.toThrow(error)

    expect(captureException).toHaveBeenCalledWith(error, {
      tags: {
        url: 'https://example.com/broken',
        method: 'GET',
      },
    })
    expect(pushSpanSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        project: 'static-project',
        name: 'GET /broken',
        status: 500,
      }),
    )
    expect(captureEvent).not.toHaveBeenCalled()
    expect(captureException).toHaveBeenCalledOnce()
    expect(flushSpy).toHaveBeenCalledOnce()
    expect(ctx.waitUntil).toHaveBeenCalledOnce()
    expect(pushSpanSpy).toHaveBeenCalledOnce()
  })
})
