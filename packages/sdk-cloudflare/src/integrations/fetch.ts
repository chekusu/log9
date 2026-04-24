import type { Log9Client, Log9Span } from '@log9/core'

/**
 * Wraps a fetch handler to automatically log request/response as spans.
 */
export function withRequestLogging(
  client: Log9Client,
  handler: (request: Request, env: unknown, ctx: ExecutionContext) => Promise<Response>,
): (request: Request, env: unknown, ctx: ExecutionContext) => Promise<Response> {
  return async (request, env, ctx) => {
    const start = Date.now()
    const url = new URL(request.url)
    const traceId = request.headers.get('x-trace-id') ?? crypto.randomUUID()

    client.addBreadcrumb({
      category: 'http',
      message: `${request.method} ${url.pathname}`,
    })

    const finish = (status: number, opts?: { captureStatusEvent?: boolean; flush?: boolean }) => {
      const duration = Date.now() - start
      const span: Log9Span = {
        project: client.config.project,
        trace_id: traceId,
        name: `${request.method} ${url.pathname}`,
        started_at: new Date(start).toISOString(),
        duration,
        status,
        tags: {
          method: request.method,
          pathname: url.pathname,
        },
      }
      client.transport.pushSpan(span)

      if (opts?.captureStatusEvent !== false && status >= 500) {
        client.captureEvent('error', `${request.method} ${url.pathname} → ${status}`, { duration })
      } else if (opts?.captureStatusEvent !== false && status >= 400) {
        client.captureEvent('warn', `${request.method} ${url.pathname} → ${status}`, { duration })
      }

      if (opts?.flush !== false) {
        ctx.waitUntil(client.flush())
      }
    }

    try {
      const response = await handler(request, env, ctx)
      finish(response.status)
      return response
    } catch (err) {
      finish(500, { captureStatusEvent: false, flush: false })
      throw err
    }
  }
}
