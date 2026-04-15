# log9

AI-native centralized observability platform. All logs flow through a single Cloudflare Worker into a db9.ai PostgreSQL database. The SDK never connects to the database directly — it POSTs JSON to the Log Worker, which handles ingestion, querying, and serves as the data layer for an autonomous analysis agent.

## Architecture

```
Your Workers ──SDK──> Log Worker ──> db9.ai (Postgres)
                          │
                     POST /query
                          │
                    Log9 Agent (wanman.ai)
```

Three components:

| Component | Role |
|-----------|------|
| **SDK** (`@log9/core` + `@log9/cloudflare`) | Collect events from your Cloudflare Workers |
| **Log Worker** (Hono on CF Workers) | Ingest logs, serve queries |
| **Log9 Agent** (wanman.ai skill) | Analyze patterns, triage, trigger fixes |

## Quick Start

### 1. Install the SDK

```bash
pnpm add @log9/cloudflare
```

### 2. Wrap your Worker

```ts
import { withLog9 } from "@log9/cloudflare";

export default withLog9(
  {
    dsn: "https://log.your-domain.com/ingest/my-project/sdk",
    key: "your-log9-key",
  },
  {
    async fetch(request, env, ctx) {
      return new Response("Hello");
    },
  }
);
```

That single wrapper auto-captures uncaught errors, request/response spans, breadcrumbs, and performance metrics. For manual logging:

```ts
log9.info("user signed up", { userId: "u_123" });
log9.warn("rate limit approaching");
log9.error("payment failed", { orderId });
log9.captureException(err);
```

### 3. Deploy the Log Worker

```bash
cd apps/api
cp wrangler.example.toml wrangler.toml
```

Set your secrets:

```bash
wrangler secret put DB9_CONNECTION_STRING
wrangler secret put LOG9_API_KEY
wrangler secret put ANTHROPIC_API_KEY    # for NL query
```

Deploy:

```bash
wrangler deploy
```

### 4. Bootstrap the database

Run the schema against your db9.ai Postgres instance:

```bash
psql "$DB9_CONNECTION_STRING" -f scripts/bootstrap-db9.sql
```

## SDK

### @log9/core

Types, transport layer, and event builder shared across all platform-specific SDKs.

### @log9/cloudflare

Sentry-style SDK purpose-built for Cloudflare Workers.

- **One-line integration** — `withLog9(config, worker)` wraps your existing Worker
- **Auto-capture** — uncaught errors, request/response logging (spans), breadcrumbs, performance metrics
- **Manual API** — `log9.info()`, `log9.warn()`, `log9.error()`, `log9.captureException()`
- **Batched transport** — events are buffered and flushed in batches, not sent one-by-one

## Log Worker

A Hono application running on Cloudflare Workers. Handles both ingestion and querying.

### Ingest Routes

All logs enter through a unified set of endpoints. Auth is via the `X-Log9-Key` header. Each provider has an adapter that normalizes incoming data to a common event schema. Writes are non-blocking via `waitUntil()`.

| Route | Source |
|-------|--------|
| `POST /ingest/:project/sdk` | SDK events and spans |
| `POST /ingest/:project/twilio` | Twilio Status Callbacks |
| `POST /ingest/:project/custom` | Generic JSON from any service |

### Query Route

A single `POST /query` endpoint serves both humans and agents.

**Structured query** — builds SQL directly, no LLM cost:

```json
{ "project": "tuwa", "level": ["error"], "since": "1h" }
```

**Natural language query** — Claude Haiku generates SQL from your question:

```json
{ "q": "what errors happened in the last hour for tuwa?" }
```

Both modes support `format: "json"` (API consumers) and `format: "html"` (browser with dark-themed table). Only `SELECT` and `WITH` queries are allowed — the query layer rejects anything else. Schema is auto-discovered from the db9 `information_schema`.

## Log9 Agent

A 24/7 keep-alive agent defined as an AGENT.md skill file, running inside the wanman.ai agent runtime. No custom runtime needed — it plugs into wanman's agent matrix.

**Cycle** (every 10 minutes):
1. Query logs via the Log Worker's query endpoint
2. Analyze patterns across projects
3. Act based on severity:

| Severity | Action |
|----------|--------|
| Critical | Steer dev agent into immediate fix |
| High | Notify devops |
| Medium | Create task |
| Low | Track silently |

Findings are reported back through the ingest endpoint — the agent observes itself. When a code fix is needed, it triggers wanman's dev agent in takeover mode.

## Database Schema

Stored in db9.ai (serverless Postgres). Bootstrap with `scripts/bootstrap-db9.sql`.

**`events`** — id, project, level, message, timestamp, trace_id, tags (JSONB), extra (JSONB), breadcrumbs, stack_trace

**`spans`** — id, project, trace_id, name, started_at, duration, status, tags (JSONB)

GIN indexes on JSONB columns for fast tag queries.

## Project Structure

```
log9.ai/
├── packages/
│   ├── core/              # @log9/core — types, transport, event builder
│   └── sdk-cloudflare/    # @log9/cloudflare — Workers auto-instrumentation
├── apps/
│   └── api/               # Log Worker (ingest + query)
├── agent/                 # wanman agent skill files
├── scripts/               # db9 schema bootstrap
└── docs/plans/            # design & implementation docs
```

## Tech Stack

- TypeScript 5.7 (ESM)
- pnpm + Turborepo monorepo
- Cloudflare Workers + Hono
- db9.ai (serverless Postgres)
- Claude Haiku (NL-to-SQL query generation)
- wanman.ai (agent runtime)

## Development

```bash
pnpm install
pnpm dev          # start all packages in dev mode
pnpm build        # build all packages
pnpm typecheck    # run type checks across the monorepo
```

Dev server ports: **3150** (main), **3151** (API).
