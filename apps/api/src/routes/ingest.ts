import { Hono } from 'hono'
import type { Env } from '../types'
import { db9InsertEvents, db9InsertSpans } from '../lib/db9'
import { normalizeSdk } from '../adapters/sdk'
import { normalizeTwilio } from '../adapters/twilio'
import { normalizeCustom } from '../adapters/custom'

const ingest = new Hono<Env>()

function observeBackgroundTask(promise: Promise<unknown>, context: string) {
  return promise.catch((error) => {
    console.error(`[ingest] background persistence failed for ${context}`, error)
    throw error
  })
}

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

  c.executionCtx.waitUntil(observeBackgroundTask(Promise.all([db9InsertEvents(c.env, events), db9InsertSpans(c.env, spans)]), 'sdk'))

  return c.json({ accepted: events.length + spans.length, persistence: 'deferred' }, 202)
})

/** POST /ingest/:project/twilio — Twilio Status Callback */
ingest.post('/:project/twilio', async (c) => {
  const project = c.req.param('project')
  const body = await c.req.json()
  const event = normalizeTwilio(project, body)

  c.executionCtx.waitUntil(observeBackgroundTask(db9InsertEvents(c.env, [event]), 'twilio'))

  return c.json({ accepted: 1, persistence: 'deferred' }, 202)
})

/** POST /ingest/:project/custom — Generic JSON */
ingest.post('/:project/custom', async (c) => {
  const project = c.req.param('project')
  const body = await c.req.json()

  const items = Array.isArray(body) ? body : [body]
  const events = items.map((item) => normalizeCustom(project, item))

  c.executionCtx.waitUntil(observeBackgroundTask(db9InsertEvents(c.env, events), 'custom'))

  return c.json({ accepted: events.length, persistence: 'deferred' }, 202)
})

export default ingest
