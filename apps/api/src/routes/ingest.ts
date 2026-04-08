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

  const items = Array.isArray(body) ? body : [body]
  const events = items.map((item) => normalizeCustom(project, item))

  c.executionCtx.waitUntil(db9InsertEvents(c.env, events))

  return c.json({ received: events.length })
})

export default ingest
