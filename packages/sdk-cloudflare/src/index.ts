import { Log9Client } from '@log9/core'
import type { Log9Config } from '@log9/core'
import { withErrorCapture } from './integrations/error'
import { withRequestLogging } from './integrations/fetch'

export type { Log9Config } from '@log9/core'
export { Log9Client, getClient } from '@log9/core'

interface Log9Options {
  project: string
  endpoint: string
  apiKey: string
  debug?: boolean
}

type FetchHandler = (request: Request, env: any, ctx: ExecutionContext) => Promise<Response>

/**
 * Wrap a Cloudflare Worker with log9 auto-instrumentation.
 *
 * Usage:
 * ```typescript
 * import { withLog9 } from '@log9/cloudflare'
 *
 * export default withLog9({
 *   project: 'tuwa',
 *   endpoint: 'https://log9.ai/ingest',
 *   apiKey: env.LOG9_API_KEY,
 * }, {
 *   fetch(request, env, ctx) { ... }
 * })
 * ```
 */
export function withLog9(
  options: Log9Options | ((env: any) => Log9Options),
  worker: { fetch: FetchHandler },
): { fetch: FetchHandler } {
  return {
    fetch(request: Request, env: any, ctx: ExecutionContext) {
      const opts = typeof options === 'function' ? options(env) : options
      const config: Log9Config = {
        project: opts.project,
        endpoint: opts.endpoint,
        apiKey: opts.apiKey,
        debug: opts.debug,
      }
      const client = new Log9Client(config)

      let handler: FetchHandler = worker.fetch.bind(worker)
      handler = withErrorCapture(client, handler)
      handler = withRequestLogging(client, handler)

      return handler(request, env, ctx)
    },
  }
}
