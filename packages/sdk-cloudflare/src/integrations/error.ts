import type { Log9Client } from '@log9/core'

/**
 * Wraps a fetch handler to automatically capture uncaught exceptions.
 */
export function withErrorCapture(
  client: Log9Client,
  handler: (request: Request, env: unknown, ctx: ExecutionContext) => Promise<Response>,
): (request: Request, env: unknown, ctx: ExecutionContext) => Promise<Response> {
  return async (request, env, ctx) => {
    try {
      return await handler(request, env, ctx)
    } catch (err) {
      client.captureException(err, {
        tags: {
          url: request.url,
          method: request.method,
        },
      })
      ctx.waitUntil(client.flush())
      throw err
    }
  }
}
