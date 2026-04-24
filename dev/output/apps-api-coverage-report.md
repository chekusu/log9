# apps/api Coverage Review Report

## Scope
This pass used `/workspace/project/cto/output/codebase-review-report.md` as the review baseline and re-validated `apps/api` against the CEO supplement.

Covered state-machine paths and review focus:
- ingest all three paths: `sdk`, `twilio`, `custom`
- ingest auth rejection and `waitUntil` rejection observability
- query NL, structured, HTML, illegal SQL, and read-only gateway branches
- db9 insert/query helper escaping and adapter normalization edge cases
- `since` / `until` window semantics against the current product contract

## Code Changes
- Added `apps/api/src/lib/sql-guard.ts` and routed both `routes/query.ts` and `entrypoints/db9-gateway.ts` through the same guard.
- The guard now enforces single-statement, read-only `SELECT` / `WITH` SQL instead of only checking the first token.
- Added explicit background-task observability in `routes/ingest.ts`: `waitUntil` failures now log with context before rethrowing, so silent persistence loss is no longer unobservable.

## Test Additions
Validated the branches explicitly requested by CEO:
- ingest `sdk` success path with events + spans
- ingest `sdk` background reject path with observable `console.error`
- ingest `twilio` path
- ingest `custom` array + single-item path
- unauthorized ingest/query rejection
- query NL path
- query structured path
- query HTML rendering path
- query illegal SQL path: direct write query rejection
- query illegal SQL path: multi-statement rejection
- query illegal SQL path: write CTE rejection
- db9 gateway read-only gate: reject writes, reject multi-statement SQL, reject write CTEs, allow commented/mixed-case read queries

## since / until Judgment
No code change was needed for `since` / `until`.

Judgment: under the current API contract, both fields represent offsets relative to `now()`, not absolute timestamps. In that model:
- `since=1h` means `timestamp > now() - interval '1 hour'`
- `until=30m` means `timestamp < now() - interval '30 minutes'`
- using both creates a bounded relative window, for example “between 1 hour ago and 30 minutes ago”

That behavior is internally consistent and already covered by tests. The real issue is naming clarity, not execution correctness. If product wants absolute upper bounds later, that is an API design change and should be handled separately.

## Commands Executed
```bash
corepack pnpm --filter @log9/api test
corepack pnpm --filter @log9/api test:coverage
corepack pnpm --filter @log9/api typecheck
```

## Coverage Result
Source: `apps/api/coverage/coverage-summary.json`

- statements: 100% (365/365)
- functions: 100% (19/19)
- branches: 100% (130/130)
- lines: 100% (365/365)

## Residual Risk
- The SQL guard is materially stronger than the previous first-word check, but it is still regex-based validation rather than a full SQL parser.
- `waitUntil` failures are now observable, but there is still no retry / dead-letter mechanism; persistence remains best-effort.
