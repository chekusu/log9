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
