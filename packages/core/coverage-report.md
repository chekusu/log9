# packages/core Coverage Report

Task ID: `5ba46a76-46d5-4fb2-9b7b-44d8ec24d2f7`
Date: `2026-04-24`

## Summary

- Added a local Vitest setup for `packages/core`.
- Added runtime tests for `transport`, `event-builder`, and public entrypoint exports.
- Added TypeScript constraint tests for `Log9Config`, `Log9Event`, `Log9Span`, and `QueryRequest`.
- No production code changes were required after investigation; gaps were in missing tests only.

## Executed Commands

```bash
corepack pnpm install
corepack pnpm --filter @log9/core test
corepack pnpm --filter @log9/core test:types
corepack pnpm --filter @log9/core test:coverage
```

## Coverage Result

Source: `packages/core/coverage/coverage-summary.json`

- Statements: `100%`
- Branches: `100%`
- Functions: `100%`
- Lines: `100%`

Per-file runtime coverage:

- `src/event-builder.ts`: `100/100/100/100`
- `src/index.ts`: `100/100/100/100`
- `src/transport.ts`: `100/100/100/100`

Note: `src/types.ts` is type-only and excluded from runtime coverage. Its constraints are validated by `corepack pnpm --filter @log9/core test:types`.

## Risk Notes

- The transport tests mock `fetch`, so they validate batching, timer behavior, and error swallowing, but not real network interoperability.
- Type constraints are enforced through `tsc` negative tests; they do not generate runtime coverage by design.
- The repo has unrelated existing worktree changes outside `packages/core`; this task did not modify or revert them.
