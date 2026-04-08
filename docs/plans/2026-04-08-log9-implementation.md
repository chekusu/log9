# log9.ai Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build log9.ai — an AI-native centralized observability platform with SDK log collection, webhook ingestion, natural language + structured query, and wanman agent integration.

**Architecture:** Monorepo with three packages (@log9/core, @log9/cloudflare, @log9/node) and one Cloudflare Worker app (ingest + query). All logs flow through the Worker into db9. Agent skill files plug into wanman runtime. Query Worker serves both humans (NL→SQL) and agents (structured→SQL).

**Tech Stack:** TypeScript 5.7 ESM, pnpm + Turborepo, Cloudflare Workers + Hono, db9.ai (Postgres), Claude Haiku (NL query generation)

**Design doc:** `docs/plans/2026-04-07-log9-design.md`

**Port allocation:** 3150 (main), 3151 (API) — per ~/.claude/CLAUDE.md

---

## Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `turbo.json`
- Create: `tsconfig.base.json`
- Create: `.gitignore`

**Step 1: Initialize git repo**

```bash
cd ~/Codes/log9.ai
git init
```

**Step 2: Create root package.json**

```json
{
  "name": "log9",
  "version": "0.0.1",
  "private": true,
  "description": "AI-native centralized observability platform",
  "scripts": {
    "dev": "turbo dev",
    "build": "turbo build",
    "test": "turbo test",
    "typecheck": "turbo typecheck",
    "clean": "turbo clean && rm -rf node_modules"
  },
  "devDependencies": {
    "@types/node": "^20.11.0",
    "turbo": "^2.0.0",
    "typescript": "^5.7.0"
  },
  "packageManager": "pnpm@10.28.0",
  "engines": {
    "node": ">=20.0.0"
  }
}
```

**Step 3: Create pnpm-workspace.yaml**

```yaml
packages:
  - "packages/*"
  - "apps/*"
```

**Step 4: Create turbo.json**

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "test": {
      "dependsOn": ["^build"]
    },
    "typecheck": {
      "dependsOn": ["^build"]
    },
    "clean": {
      "cache": false
    }
  }
}
```

**Step 5: Create tsconfig.base.json**

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "forceConsistentCasingInFileNames": true,
    "noUncheckedIndexedAccess": true
  },
  "exclude": ["node_modules", "dist"]
}
```

**Step 6: Create .gitignore**

```
node_modules
dist
.turbo
.wrangler
*.log
.env
.env.*
.dev.vars
```

**Step 7: Install dependencies**

Run: `cd ~/Codes/log9.ai && pnpm install`

**Step 8: Commit**

```bash
git add -A
git commit -m "chore: init monorepo scaffolding"
```

---

## Task 2: @log9/core — Types & Transport

**Files:**
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/core/src/types.ts`
- Create: `packages/core/src/transport.ts`
- Create: `packages/core/src/event-builder.ts`
- Create: `packages/core/src/index.ts`

**Step 1: Create packages/core/package.json**

```json
{
  "name": "@log9/core",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch",
    "typecheck": "tsc --noEmit",
    "clean": "rm -rf dist"
  },
  "devDependencies": {
    "tsup": "^8.0.0",
    "typescript": "^5.7.0"
  }
}
```

**Step 2: Create packages/core/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
```

**Step 3: Create packages/core/src/types.ts**

Core event types that all SDKs and the Worker share:

```typescript
/** Log level */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal'

/** A single log event */
export interface Log9Event {
  id?: string
  project: string
  level: LogLevel
  message: string
  timestamp: string
  trace_id?: string
  tags?: Record<string, string>
  extra?: Record<string, unknown>
  breadcrumbs?: Breadcrumb[]
  stack_trace?: string
}

/** A performance span */
export interface Log9Span {
  id?: string
  project: string
  trace_id: string
  name: string
  started_at: string
  duration: number
  status?: number
  tags?: Record<string, string>
}

/** Breadcrumb entry */
export interface Breadcrumb {
  timestamp: string
  category: string
  message: string
  level?: LogLevel
  data?: Record<string, unknown>
}

/** SDK configuration */
export interface Log9Config {
  project: string
  endpoint: string
  apiKey: string
  /** Max events before flushing (default: 25) */
  batchSize?: number
  /** Max ms before flushing (default: 5000) */
  flushInterval?: number
  /** Enable debug logging (default: false) */
  debug?: boolean
}

/** Structured query (agent mode) */
export interface StructuredQuery {
  project?: string
  level?: LogLevel[]
  since?: string
  until?: string
  message_like?: string
  tags?: Record<string, string>
  group_by?: string
  order_by?: 'count' | 'timestamp'
  limit?: number
  format?: 'json' | 'html'
}

/** NL query (human mode) */
export interface NLQuery {
  q: string
  format?: 'json' | 'html'
}

/** Query request — either NL or structured */
export type QueryRequest = NLQuery | StructuredQuery
```

**Step 4: Create packages/core/src/transport.ts**

```typescript
import type { Log9Config, Log9Event, Log9Span } from './types'

export class Transport {
  private config: Log9Config
  private eventBuffer: Log9Event[] = []
  private spanBuffer: Log9Span[] = []
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(config: Log9Config) {
    this.config = config
  }

  pushEvent(event: Log9Event): void {
    this.eventBuffer.push(event)
    if (this.eventBuffer.length >= (this.config.batchSize ?? 25)) {
      this.flush()
    } else {
      this.scheduleFlush()
    }
  }

  pushSpan(span: Log9Span): void {
    this.spanBuffer.push(span)
    if (this.spanBuffer.length >= (this.config.batchSize ?? 25)) {
      this.flush()
    } else {
      this.scheduleFlush()
    }
  }

  private scheduleFlush(): void {
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.flush()
    }, this.config.flushInterval ?? 5000)
  }

  flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }

    const events = this.eventBuffer.splice(0)
    const spans = this.spanBuffer.splice(0)

    const promises: Promise<void>[] = []

    if (events.length > 0) {
      promises.push(this.send('sdk', { events }))
    }
    if (spans.length > 0) {
      promises.push(this.send('sdk', { spans }))
    }

    return Promise.all(promises).then(() => {})
  }

  private async send(type: string, body: unknown): Promise<void> {
    const url = `${this.config.endpoint}/${this.config.project}/${type}`
    try {
      await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Log9-Key': this.config.apiKey,
        },
        body: JSON.stringify(body),
      })
    } catch (err) {
      if (this.config.debug) {
        console.error('[log9] transport error:', err)
      }
    }
  }
}
```

**Step 5: Create packages/core/src/event-builder.ts**

```typescript
import type { Log9Event, Log9Config, Breadcrumb, LogLevel } from './types'
import { Transport } from './transport'

let globalInstance: Log9Client | null = null

export class Log9Client {
  readonly config: Log9Config
  readonly transport: Transport
  private breadcrumbs: Breadcrumb[] = []

  constructor(config: Log9Config) {
    this.config = config
    this.transport = new Transport(config)
  }

  addBreadcrumb(crumb: Omit<Breadcrumb, 'timestamp'>): void {
    this.breadcrumbs.push({
      ...crumb,
      timestamp: new Date().toISOString(),
    })
    // Keep last 50
    if (this.breadcrumbs.length > 50) {
      this.breadcrumbs = this.breadcrumbs.slice(-50)
    }
  }

  captureEvent(level: LogLevel, message: string, extra?: Record<string, unknown>, tags?: Record<string, string>): void {
    const event: Log9Event = {
      project: this.config.project,
      level,
      message,
      timestamp: new Date().toISOString(),
      tags,
      extra,
      breadcrumbs: this.breadcrumbs.length > 0 ? [...this.breadcrumbs] : undefined,
    }
    this.transport.pushEvent(event)
  }

  captureException(error: unknown, context?: { tags?: Record<string, string>; extra?: Record<string, unknown> }): void {
    const err = error instanceof Error ? error : new Error(String(error))
    const event: Log9Event = {
      project: this.config.project,
      level: 'error',
      message: err.message,
      timestamp: new Date().toISOString(),
      tags: context?.tags,
      extra: context?.extra,
      stack_trace: err.stack,
      breadcrumbs: this.breadcrumbs.length > 0 ? [...this.breadcrumbs] : undefined,
    }
    this.transport.pushEvent(event)
  }

  debug(message: string, extra?: Record<string, unknown>): void { this.captureEvent('debug', message, extra) }
  info(message: string, extra?: Record<string, unknown>): void { this.captureEvent('info', message, extra) }
  warn(message: string, extra?: Record<string, unknown>): void { this.captureEvent('warn', message, extra) }
  error(message: string, extra?: Record<string, unknown>): void { this.captureEvent('error', message, extra) }

  flush(): Promise<void> {
    return this.transport.flush()
  }
}

export function init(config: Log9Config): Log9Client {
  globalInstance = new Log9Client(config)
  return globalInstance
}

export function getClient(): Log9Client | null {
  return globalInstance
}
```

**Step 6: Create packages/core/src/index.ts**

```typescript
export type {
  LogLevel,
  Log9Event,
  Log9Span,
  Breadcrumb,
  Log9Config,
  StructuredQuery,
  NLQuery,
  QueryRequest,
} from './types'

export { Transport } from './transport'
export { Log9Client, init, getClient } from './event-builder'
```

**Step 7: Install deps and build**

Run: `cd ~/Codes/log9.ai && pnpm install && pnpm --filter @log9/core build`

**Step 8: Typecheck**

Run: `pnpm --filter @log9/core typecheck`
Expected: No errors

**Step 9: Commit**

```bash
git add packages/core
git commit -m "feat: add @log9/core — types, transport, event builder"
```

---

## Task 3: @log9/cloudflare — Workers SDK

**Files:**
- Create: `packages/sdk-cloudflare/package.json`
- Create: `packages/sdk-cloudflare/tsconfig.json`
- Create: `packages/sdk-cloudflare/src/index.ts`
- Create: `packages/sdk-cloudflare/src/integrations/fetch.ts`
- Create: `packages/sdk-cloudflare/src/integrations/error.ts`

**Step 1: Create packages/sdk-cloudflare/package.json**

```json
{
  "name": "@log9/cloudflare",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsup",
    "dev": "tsup --watch",
    "typecheck": "tsc --noEmit",
    "clean": "rm -rf dist"
  },
  "dependencies": {
    "@log9/core": "workspace:*"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20260305.0",
    "tsup": "^8.0.0",
    "typescript": "^5.7.0"
  }
}
```

**Step 2: Create packages/sdk-cloudflare/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "types": ["@cloudflare/workers-types"]
  },
  "include": ["src/**/*"]
}
```

**Step 3: Create packages/sdk-cloudflare/src/integrations/error.ts**

Auto-captures uncaught errors in a Worker fetch handler:

```typescript
import type { Log9Client } from '@log9/core'

/**
 * Wraps a fetch handler to automatically capture uncaught exceptions.
 */
export function withErrorCapture<E, C extends ExecutionContext>(
  client: Log9Client,
  handler: ExportedHandlerFetchHandler<E, C>,
): ExportedHandlerFetchHandler<E, C> {
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
      // Flush before re-throwing so the error event is sent
      ctx.waitUntil(client.flush())
      throw err
    }
  }
}
```

**Step 4: Create packages/sdk-cloudflare/src/integrations/fetch.ts**

Auto-logs every request/response:

```typescript
import type { Log9Client, Log9Span } from '@log9/core'

/**
 * Wraps a fetch handler to automatically log request/response as spans.
 */
export function withRequestLogging<E, C extends ExecutionContext>(
  client: Log9Client,
  handler: ExportedHandlerFetchHandler<E, C>,
): ExportedHandlerFetchHandler<E, C> {
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

      // Log errors and slow requests as events too
      if (status >= 500) {
        client.captureEvent('error', `${request.method} ${url.pathname} → ${status}`, { duration })
      } else if (status >= 400) {
        client.captureEvent('warn', `${request.method} ${url.pathname} → ${status}`, { duration })
      }

      ctx.waitUntil(client.flush())
    }
  }
}
```

**Step 5: Create packages/sdk-cloudflare/src/index.ts**

The main `withLog9()` wrapper:

```typescript
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
 *   fetch(request, env, ctx) {
 *     // your code
 *   }
 * })
 * ```
 */
export function withLog9<E extends Record<string, unknown>>(
  options: Log9Options | ((env: E) => Log9Options),
  worker: ExportedHandler<E>,
): ExportedHandler<E> {
  return {
    fetch(request, env, ctx) {
      const opts = typeof options === 'function' ? options(env) : options
      const config: Log9Config = {
        project: opts.project,
        endpoint: opts.endpoint,
        apiKey: opts.apiKey,
        debug: opts.debug,
      }
      const client = new Log9Client(config)

      let handler = worker.fetch!
      handler = withErrorCapture(client, handler)
      handler = withRequestLogging(client, handler)

      return handler(request, env, ctx)
    },
  }
}
```

**Step 6: Install deps and build**

Run: `cd ~/Codes/log9.ai && pnpm install && pnpm --filter @log9/cloudflare build`

**Step 7: Typecheck**

Run: `pnpm --filter @log9/cloudflare typecheck`
Expected: No errors

**Step 8: Commit**

```bash
git add packages/sdk-cloudflare
git commit -m "feat: add @log9/cloudflare — Workers SDK with auto error capture & request logging"
```

---

## Task 4: Log Worker — Scaffolding & Ingest Routes

**Files:**
- Create: `apps/api/package.json`
- Create: `apps/api/tsconfig.json`
- Create: `apps/api/wrangler.json`
- Create: `apps/api/src/types.ts`
- Create: `apps/api/src/lib/db9.ts`
- Create: `apps/api/src/adapters/sdk.ts`
- Create: `apps/api/src/adapters/twilio.ts`
- Create: `apps/api/src/adapters/custom.ts`
- Create: `apps/api/src/routes/ingest.ts`
- Create: `apps/api/src/index.ts`

**Step 1: Create apps/api/package.json**

```json
{
  "name": "@log9/api",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev --port 3151",
    "build": "wrangler build",
    "deploy": "wrangler deploy",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@log9/core": "workspace:*",
    "hono": "^4.7.0"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20260305.0",
    "typescript": "^5.7.0",
    "wrangler": "^4.80.0"
  }
}
```

**Step 2: Create apps/api/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "types": ["@cloudflare/workers-types"]
  },
  "include": ["src/**/*.ts"]
}
```

**Step 3: Create apps/api/wrangler.json**

```json
{
  "$schema": "https://json.schemastore.org/wrangler",
  "name": "log9-api",
  "compatibility_date": "2026-04-01",
  "compatibility_flags": ["nodejs_compat"],
  "main": "src/index.ts",
  "worker_loaders": [
    {
      "binding": "LOADER"
    }
  ]
}
```

Note: DB9_TOKEN, DB9_DATABASE_ID, ANTHROPIC_API_KEY, LOG9_API_KEY are secrets — set via `wrangler secret put`.

**Step 4: Create apps/api/src/types.ts**

```typescript
import type { Context } from 'hono'

export type Bindings = {
  DB9_TOKEN: string
  DB9_DATABASE_ID: string
  ANTHROPIC_API_KEY: string
  LOG9_API_KEY: string
  LOADER: {
    get(key: string, factory: () => Promise<WorkerConfig>): Promise<WorkerHandle>
  }
}

interface WorkerConfig {
  compatibilityDate: string
  mainModule: string
  modules: Record<string, string>
  env?: Record<string, string>
}

interface WorkerHandle {
  getEntrypoint(): { fetch(request: Request): Promise<Response> }
}

export type Env = { Bindings: Bindings }
export type AppContext = Context<Env>
```

**Step 5: Create apps/api/src/lib/db9.ts**

```typescript
import type { Bindings } from '../types'
import type { Log9Event, Log9Span } from '@log9/core'

const DB9_API = 'https://api.db9.ai/customer/databases'

export async function db9Query(env: Bindings, sql: string) {
  const res = await fetch(`${DB9_API}/${env.DB9_DATABASE_ID}/sql`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.DB9_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`db9 query failed (${res.status}): ${text}`)
  }
  return res.json() as Promise<{ columns: Array<{ name: string; type: string }>; rows: unknown[][]; row_count: number }>
}

export async function db9InsertEvents(env: Bindings, events: Log9Event[]): Promise<void> {
  if (events.length === 0) return
  const values = events.map((e) => {
    const id = e.id ?? crypto.randomUUID()
    return `(
      '${esc(id)}', '${esc(e.project)}', '${esc(e.level)}', '${esc(e.message)}',
      '${esc(e.timestamp)}', ${e.trace_id ? `'${esc(e.trace_id)}'` : 'NULL'},
      ${e.tags ? `'${esc(JSON.stringify(e.tags))}'::jsonb` : 'NULL'},
      ${e.extra ? `'${esc(JSON.stringify(e.extra))}'::jsonb` : 'NULL'},
      ${e.breadcrumbs ? `'${esc(JSON.stringify(e.breadcrumbs))}'::jsonb` : 'NULL'},
      ${e.stack_trace ? `'${esc(e.stack_trace)}'` : 'NULL'}
    )`
  })

  const sql = `INSERT INTO events (id, project, level, message, timestamp, trace_id, tags, extra, breadcrumbs, stack_trace) VALUES ${values.join(',')}`
  await db9Query(env, sql)
}

export async function db9InsertSpans(env: Bindings, spans: Log9Span[]): Promise<void> {
  if (spans.length === 0) return
  const values = spans.map((s) => {
    const id = s.id ?? crypto.randomUUID()
    return `(
      '${esc(id)}', '${esc(s.project)}', '${esc(s.trace_id)}', '${esc(s.name)}',
      '${esc(s.started_at)}', ${s.duration}, ${s.status ?? 'NULL'},
      ${s.tags ? `'${esc(JSON.stringify(s.tags))}'::jsonb` : 'NULL'}
    )`
  })

  const sql = `INSERT INTO spans (id, project, trace_id, name, started_at, duration, status, tags) VALUES ${values.join(',')}`
  await db9Query(env, sql)
}

/** Escape single quotes for SQL strings */
function esc(s: string): string {
  return s.replace(/'/g, "''")
}
```

**Step 6: Create apps/api/src/adapters/sdk.ts**

```typescript
import type { Log9Event, Log9Span } from '@log9/core'

interface SdkPayload {
  events?: Log9Event[]
  spans?: Log9Span[]
}

export function normalizeSdk(project: string, body: unknown): { events: Log9Event[]; spans: Log9Span[] } {
  const payload = body as SdkPayload
  const events = (payload.events ?? []).map((e) => ({ ...e, project }))
  const spans = (payload.spans ?? []).map((s) => ({ ...s, project }))
  return { events, spans }
}
```

**Step 7: Create apps/api/src/adapters/twilio.ts**

```typescript
import type { Log9Event } from '@log9/core'

interface TwilioStatusCallback {
  CallSid: string
  CallStatus: string
  From: string
  To: string
  Direction: string
  [key: string]: unknown
}

export function normalizeTwilio(project: string, body: unknown): Log9Event {
  const t = body as TwilioStatusCallback
  return {
    project,
    level: t.CallStatus === 'failed' || t.CallStatus === 'busy' || t.CallStatus === 'no-answer' ? 'error' : 'info',
    message: `Call ${t.CallStatus}: ${t.From} → ${t.To}`,
    timestamp: new Date().toISOString(),
    tags: {
      service: 'twilio',
      call_sid: t.CallSid ?? '',
      status: t.CallStatus ?? '',
      direction: t.Direction ?? '',
    },
    extra: t as Record<string, unknown>,
  }
}
```

**Step 8: Create apps/api/src/adapters/custom.ts**

```typescript
import type { Log9Event, LogLevel } from '@log9/core'

interface CustomPayload {
  level?: LogLevel
  message: string
  tags?: Record<string, string>
  extra?: Record<string, unknown>
  timestamp?: string
}

export function normalizeCustom(project: string, body: unknown): Log9Event {
  const c = body as CustomPayload
  return {
    project,
    level: c.level ?? 'info',
    message: c.message ?? 'unknown',
    timestamp: c.timestamp ?? new Date().toISOString(),
    tags: c.tags,
    extra: c.extra,
  }
}
```

**Step 9: Create apps/api/src/routes/ingest.ts**

```typescript
import { Hono } from 'hono'
import type { Env } from '../types'
import { db9InsertEvents, db9InsertSpans } from '../lib/db9'
import { normalizeSdk } from '../adapters/sdk'
import { normalizeTwilio } from '../adapters/twilio'
import { normalizeCustom } from '../adapters/custom'

const ingest = new Hono<Env>()

/** Auth middleware: verify X-Log9-Key */
ingest.use('*', async (c, next) => {
  const key = c.req.header('X-Log9-Key')
  if (!key || key !== c.env.LOG9_API_KEY) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  await next()
})

/** POST /ingest/:project/sdk — SDK events + spans */
ingest.post('/:project/sdk', async (c) => {
  const project = c.req.param('project')
  const body = await c.req.json()
  const { events, spans } = normalizeSdk(project, body)

  c.executionCtx.waitUntil(
    Promise.all([
      db9InsertEvents(c.env, events),
      db9InsertSpans(c.env, spans),
    ])
  )

  return c.json({ received: events.length + spans.length })
})

/** POST /ingest/:project/twilio — Twilio Status Callback */
ingest.post('/:project/twilio', async (c) => {
  const project = c.req.param('project')
  const body = await c.req.json()
  const event = normalizeTwilio(project, body)

  c.executionCtx.waitUntil(db9InsertEvents(c.env, [event]))

  return c.json({ received: 1 })
})

/** POST /ingest/:project/custom — Generic JSON */
ingest.post('/:project/custom', async (c) => {
  const project = c.req.param('project')
  const body = await c.req.json()

  // Support both single event and array
  const items = Array.isArray(body) ? body : [body]
  const events = items.map((item) => normalizeCustom(project, item))

  c.executionCtx.waitUntil(db9InsertEvents(c.env, events))

  return c.json({ received: events.length })
})

export default ingest
```

**Step 10: Create apps/api/src/index.ts**

```typescript
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { Env } from './types'
import ingest from './routes/ingest'

export { Db9Gateway } from './entrypoints/db9-gateway'

const app = new Hono<Env>()

app.use('*', cors({ origin: '*' }))

app.get('/health', (c) => {
  return c.json({ status: 'ok', service: 'log9', timestamp: new Date().toISOString() })
})

app.route('/ingest', ingest)

export default app
```

Note: We'll add the query route and Db9Gateway entrypoint in the next task. For now create a placeholder:

**Step 11: Create apps/api/src/entrypoints/db9-gateway.ts**

```typescript
import { WorkerEntrypoint } from 'cloudflare:workers'

export class Db9Gateway extends WorkerEntrypoint<{ DB9_TOKEN: string; DB9_DATABASE_ID: string }> {
  async query(sql: string): Promise<unknown> {
    const trimmed = sql.trim()
    const firstWord = trimmed.split(/\s/)[0]?.toUpperCase()
    if (firstWord !== 'SELECT' && firstWord !== 'WITH') {
      throw new Error('Only SELECT/WITH queries are allowed')
    }

    const response = await fetch(
      `https://api.db9.ai/customer/databases/${this.env.DB9_DATABASE_ID}/sql`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.env.DB9_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: trimmed }),
      },
    )

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`db9 query failed (${response.status}): ${text}`)
    }

    return response.json()
  }
}
```

**Step 12: Install deps and typecheck**

Run: `cd ~/Codes/log9.ai && pnpm install && pnpm --filter @log9/api typecheck`
Expected: No errors

**Step 13: Commit**

```bash
git add apps/api
git commit -m "feat: add Log Worker with ingest routes (sdk, twilio, custom)"
```

---

## Task 5: Log Worker — Query Route (NL + Structured)

**Files:**
- Create: `apps/api/src/lib/prompt-builder.ts`
- Create: `apps/api/src/lib/code-generator.ts`
- Create: `apps/api/src/lib/structured-query.ts`
- Create: `apps/api/src/routes/query.ts`
- Modify: `apps/api/src/index.ts` — add query route

**Step 1: Create apps/api/src/lib/prompt-builder.ts**

```typescript
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
      tables[table].push(`${column} (${type})`)
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
```

**Step 2: Create apps/api/src/lib/code-generator.ts**

Adapted from m0rphic's code-generator.ts:

```typescript
interface GenerateSQLOptions {
  system: string
  user: string
  apiKey: string
  model?: string
}

export async function generateSQL(options: GenerateSQLOptions): Promise<string> {
  const { system, user, apiKey, model = 'claude-haiku-4-5-20251001' } = options

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Claude API error (${response.status}): ${error}`)
  }

  const result = (await response.json()) as {
    content: Array<{ type: string; text?: string }>
  }

  const text = result.content.find((c) => c.type === 'text')?.text
  if (!text) throw new Error('No text content in Claude response')

  // Strip markdown fences if present
  let sql = text.trim()
  sql = sql.replace(/^```\w*\s*\n/, '')
  sql = sql.replace(/\n```\s*$/, '')
  return sql.trim()
}

export async function promptHash(system: string, user: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(system + '\n---\n' + user)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16)
}
```

**Step 3: Create apps/api/src/lib/structured-query.ts**

Builds SQL from structured query params (no LLM needed):

```typescript
import type { StructuredQuery } from '@log9/core'

const DURATION_MAP: Record<string, string> = {
  '1m': '1 minute',
  '5m': '5 minutes',
  '10m': '10 minutes',
  '30m': '30 minutes',
  '1h': '1 hour',
  '3h': '3 hours',
  '6h': '6 hours',
  '12h': '12 hours',
  '24h': '24 hours',
  '1d': '1 day',
  '7d': '7 days',
  '30d': '30 days',
}

export function buildStructuredQuery(q: StructuredQuery): string {
  const conditions: string[] = []

  if (q.project) {
    conditions.push(`project = '${esc(q.project)}'`)
  }

  if (q.level && q.level.length > 0) {
    const levels = q.level.map((l) => `'${esc(l)}'`).join(',')
    conditions.push(`level IN (${levels})`)
  }

  if (q.since) {
    const interval = DURATION_MAP[q.since]
    if (interval) {
      conditions.push(`timestamp > now() - interval '${interval}'`)
    }
  }

  if (q.until && q.until !== 'now') {
    const interval = DURATION_MAP[q.until]
    if (interval) {
      conditions.push(`timestamp < now() - interval '${interval}'`)
    }
  }

  if (q.message_like) {
    conditions.push(`message LIKE '${esc(q.message_like)}'`)
  }

  if (q.tags) {
    for (const [key, value] of Object.entries(q.tags)) {
      conditions.push(`tags @> '{"${esc(key)}": "${esc(value)}"}'::jsonb`)
    }
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  if (q.group_by) {
    const orderBy = q.order_by === 'count' ? 'count DESC' : `${esc(q.group_by)}`
    const limit = q.limit ?? 50
    return `SELECT ${esc(q.group_by)}, COUNT(*) as count FROM events ${where} GROUP BY ${esc(q.group_by)} ORDER BY ${orderBy} LIMIT ${limit}`
  }

  const orderBy = q.order_by === 'count' ? 'timestamp DESC' : 'timestamp DESC'
  const limit = q.limit ?? 100
  return `SELECT * FROM events ${where} ORDER BY ${orderBy} LIMIT ${limit}`
}

function esc(s: string): string {
  return s.replace(/'/g, "''")
}
```

**Step 4: Create apps/api/src/routes/query.ts**

```typescript
import { Hono } from 'hono'
import type { Env } from '../types'
import { db9Query } from '../lib/db9'
import { buildQueryPrompt } from '../lib/prompt-builder'
import { generateSQL } from '../lib/code-generator'
import { buildStructuredQuery } from '../lib/structured-query'
import type { NLQuery, StructuredQuery } from '@log9/core'

const query = new Hono<Env>()

/** Auth middleware */
query.use('*', async (c, next) => {
  const key = c.req.header('X-Log9-Key')
  if (!key || key !== c.env.LOG9_API_KEY) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  await next()
})

function isNLQuery(body: unknown): body is NLQuery {
  return typeof body === 'object' && body !== null && 'q' in body && typeof (body as NLQuery).q === 'string'
}

/** POST /query */
query.post('/', async (c) => {
  const body = await c.req.json()
  let sql: string

  if (isNLQuery(body)) {
    // NL mode: Claude generates SQL
    const { system, user } = await buildQueryPrompt(c.env, body.q)
    sql = await generateSQL({
      system,
      user,
      apiKey: c.env.ANTHROPIC_API_KEY,
    })
  } else {
    // Structured mode: build SQL directly
    sql = buildStructuredQuery(body as StructuredQuery)
  }

  // Safety: only SELECT/WITH
  const firstWord = sql.trim().split(/\s/)[0]?.toUpperCase()
  if (firstWord !== 'SELECT' && firstWord !== 'WITH') {
    return c.json({ error: 'Only SELECT/WITH queries allowed', sql }, 400)
  }

  const result = await db9Query(c.env, sql)

  const format = (body as { format?: string }).format ?? 'json'
  if (format === 'html') {
    return c.html(renderResultTable(sql, result))
  }

  return c.json({ sql, ...result })
})

function renderResultTable(sql: string, result: { columns: Array<{ name: string }>; rows: unknown[][]; row_count: number }): string {
  const headers = result.columns.map((c) => `<th>${c.name}</th>`).join('')
  const rows = result.rows
    .map(
      (row) =>
        `<tr>${row.map((cell) => `<td>${cell === null ? '<em>null</em>' : String(cell)}</td>`).join('')}</tr>`,
    )
    .join('')

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>log9 query</title>
<style>
  body { font-family: system-ui, sans-serif; padding: 24px; background: #0d1117; color: #c9d1d9; }
  pre { background: #161b22; padding: 12px; border-radius: 6px; overflow-x: auto; color: #79c0ff; }
  table { border-collapse: collapse; width: 100%; margin-top: 16px; }
  th { background: #161b22; text-align: left; padding: 8px 12px; border-bottom: 1px solid #30363d; }
  td { padding: 8px 12px; border-bottom: 1px solid #21262d; max-width: 400px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  tr:hover td { background: #161b22; }
  .meta { color: #8b949e; font-size: 14px; margin-top: 8px; }
</style></head><body>
<h2>log9 query</h2>
<pre>${sql}</pre>
<p class="meta">${result.row_count} row${result.row_count === 1 ? '' : 's'}</p>
<table><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table>
</body></html>`
}

export default query
```

**Step 5: Update apps/api/src/index.ts to add query route**

```typescript
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { Env } from './types'
import ingest from './routes/ingest'
import query from './routes/query'

export { Db9Gateway } from './entrypoints/db9-gateway'

const app = new Hono<Env>()

app.use('*', cors({ origin: '*' }))

app.get('/health', (c) => {
  return c.json({ status: 'ok', service: 'log9', timestamp: new Date().toISOString() })
})

app.route('/ingest', ingest)
app.route('/query', query)

export default app
```

**Step 6: Typecheck**

Run: `pnpm --filter @log9/api typecheck`
Expected: No errors

**Step 7: Commit**

```bash
git add apps/api/src
git commit -m "feat: add query route — NL (Claude → SQL) + structured (direct SQL) modes"
```

---

## Task 6: wanman Agent Skill Files

**Files:**
- Create: `agent/AGENT.md`
- Create: `agent/CLAUDE.md`

**Step 1: Create agent/AGENT.md**

Write the full AGENT.md as specified in the design doc (section "第三部分: AGENT.md"). This is the skill file that gets loaded into the wanman runtime.

```markdown
# Log9 Agent

你是 log9 可观测性 Agent，身份为 `log9`，24/7 运行。

## 职责

持续通过 Query Worker 查询各产品日志，发现异常和优化点。

## 查询日志

不要直接连接 db9。所有查询通过 Query Worker：

### 结构化查询（推荐，快且确定，无 LLM 开销）

```bash
curl -X POST https://log9.ai/query \
  -H "X-Log9-Key: $LOG9_API_KEY" \
  -d '{"project":"tuwa","level":["error","warn"],"since":"10m"}'
```

### 自然语言查询（复杂分析时用）

```bash
curl -X POST https://log9.ai/query \
  -H "X-Log9-Key: $LOG9_API_KEY" \
  -d '{"q":"对比 tuwa 今天和昨天同时段的 error 率变化趋势"}'
```

## 每轮循环

1. `wanman recv` 查收消息
2. 通过 Query Worker 结构化查询各项目最近 10 分钟的 error/warn 事件
3. 需要深度分析时，用 NL 模式查询（如趋势对比、关联分析）
4. 发现的问题通过 ingest 端上报
5. 根据严重程度决定行动

## findings 上报

发现的问题通过 SDK ingest 端上报（findings 本身也是一种日志）：

```bash
curl -X POST https://log9.ai/ingest/log9/sdk \
  -H "X-Log9-Key: $LOG9_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"events":[{
    "level": "warn",
    "message": "error_spike: tuwa voice-bridge timeout 增加 300%",
    "tags": { "type": "finding", "severity": "high", "finding_project": "tuwa" },
    "extra": { "evidence_event_ids": ["..."], "status": "open" }
  }]}'
```

## 行动决策

| 严重程度 | 行动 |
|---------|------|
| critical | `wanman send dev --steer "紧急修复: {finding}"` |
| high | `wanman send devops "发现问题: {finding}"` |
| medium | `wanman task create "优化: {title}" --assign dev` |
| low | 上报 finding，下次巡检跟踪 |

## 协作规则

- 需要修代码 → 发给 `dev`（自动 takeover repo 修复）
- 需要决策 → 发给 `ceo`
- 运维相关 → 发给 `devops`
- 需要人介入 → `wanman send human --type decision "..."`

## 监控的产品

查询所有项目的汇总状态：

```bash
curl -X POST https://log9.ai/query \
  -H "X-Log9-Key: $LOG9_API_KEY" \
  -d '{"q":"过去 10 分钟各 project 的 error 数量排行"}'
```

## wanman CLI 速查

```bash
wanman recv                          # 查收消息
wanman send <agent> "<message>"      # 发消息
wanman send dev --steer "<urgent>"   # 紧急中断
wanman task create "<title>" --assign <agent>  # 创建任务
wanman task list --assignee log9     # 查看我的任务
wanman task done <task-id>           # 完成任务
wanman context set <key> <value>     # 写共享状态
wanman context get <key>             # 读共享状态
```
```

**Step 2: Create agent/CLAUDE.md**

```markdown
# Log9 Agent — Claude Code Config

## Identity

You are the log9 observability agent. Your name is `log9`.

## Environment

- LOG9_API_KEY is available as $LOG9_API_KEY
- Use curl to call the Query Worker at https://log9.ai/query
- Use curl to ingest findings at https://log9.ai/ingest/log9/sdk
- Use wanman CLI for inter-agent communication

## Rules

- Never connect to db9 directly. Always use the Query Worker.
- Prefer structured queries over NL queries (faster, no LLM cost).
- Use NL queries only for complex analysis (trends, comparisons, correlations).
- Always include evidence (event IDs, counts, timestamps) when reporting findings.
- Escalate critical issues immediately via steer, don't wait for the next cycle.
```

**Step 3: Commit**

```bash
git add agent
git commit -m "feat: add wanman agent skill files (AGENT.md, CLAUDE.md)"
```

---

## Task 7: db9 Schema Bootstrap

**Files:**
- Create: `scripts/bootstrap-db9.sql`

**Step 1: Create the SQL migration script**

```sql
-- log9.ai schema for db9
-- Run: db9 db sql <dbname> -q "$(cat scripts/bootstrap-db9.sql)"

CREATE TABLE IF NOT EXISTS events (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  project     TEXT NOT NULL,
  level       TEXT NOT NULL,
  message     TEXT NOT NULL,
  timestamp   TIMESTAMPTZ NOT NULL DEFAULT now(),
  trace_id    TEXT,
  tags        JSONB,
  extra       JSONB,
  breadcrumbs JSONB,
  stack_trace TEXT
);

CREATE TABLE IF NOT EXISTS spans (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  project     TEXT NOT NULL,
  trace_id    TEXT NOT NULL,
  name        TEXT NOT NULL,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  duration    FLOAT NOT NULL,
  status      INT,
  tags        JSONB
);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_events_project_ts ON events (project, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_events_level ON events (level) WHERE level IN ('error', 'warn');
CREATE INDEX IF NOT EXISTS idx_events_trace ON events (trace_id) WHERE trace_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_spans_project_ts ON spans (project, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_spans_trace ON spans (trace_id);

-- JSONB index for tag-based queries
CREATE INDEX IF NOT EXISTS idx_events_tags ON events USING GIN (tags);
CREATE INDEX IF NOT EXISTS idx_spans_tags ON spans USING GIN (tags);
```

**Step 2: Commit**

```bash
git add scripts
git commit -m "feat: add db9 schema bootstrap script"
```

---

## Task 8: Verify Everything Builds

**Step 1: Full install**

Run: `cd ~/Codes/log9.ai && pnpm install`

**Step 2: Build all packages**

Run: `pnpm build`
Expected: All packages build without errors

**Step 3: Typecheck all packages**

Run: `pnpm typecheck`
Expected: No type errors

**Step 4: Try dev server**

Run: `pnpm --filter @log9/api dev`
Expected: Wrangler starts on port 3151

**Step 5: Test health endpoint**

Run: `curl http://localhost:3151/health`
Expected: `{"status":"ok","service":"log9",...}`

**Step 6: Final commit**

```bash
git add -A
git commit -m "chore: verify full build and dev server"
```

---

## Execution Order Summary

| Task | What | Dependencies |
|------|------|-------------|
| 1 | Monorepo scaffolding | None |
| 2 | @log9/core (types, transport) | Task 1 |
| 3 | @log9/cloudflare (SDK) | Task 2 |
| 4 | Log Worker: ingest routes | Task 2 |
| 5 | Log Worker: query route | Task 4 |
| 6 | wanman agent skill files | None (can parallel with 2-5) |
| 7 | db9 schema bootstrap | None (can parallel with 2-5) |
| 8 | Verify full build | Tasks 1-7 |

Tasks 6 and 7 are independent and can run in parallel with tasks 2-5.
