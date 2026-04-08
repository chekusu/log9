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

    let status = 0
    try {
      const response = await handler(request, env, ctx)
      status = response.status
      return response
    } catch (err) {
      status = 500
      throw err
    } finally {
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

      if (status >= 500) {
        client.captureEvent('error', `${request.method} ${url.pathname} → ${status}`, { duration })
      } else if (status >= 400) {
        client.captureEvent('warn', `${request.method} ${url.pathname} → ${status}`, { duration })
      }

      ctx.waitUntil(client.flush())
    }
  }
}
