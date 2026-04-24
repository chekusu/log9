import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Log9Client, getClient, init } from '../src/event-builder'
import { Transport } from '../src/transport'

const config = {
  apiKey: 'test-key',
  endpoint: 'https://log9.example.com',
  project: 'demo',
}

describe('Log9Client', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('captures breadcrumbs, trims them to the latest 50 entries, and clones them into events', () => {
    const pushEvent = vi.spyOn(Transport.prototype, 'pushEvent').mockImplementation(() => {})
    const client = new Log9Client(config)

    for (let index = 0; index < 55; index += 1) {
      client.addBreadcrumb({
        category: 'ui',
        message: `crumb-${index}`,
      })
    }

    client.captureEvent('warn', 'with-breadcrumbs', { requestId: 1 }, { feature: 'checkout' })

    expect(pushEvent).toHaveBeenCalledTimes(1)
    const [event] = pushEvent.mock.calls[0] ?? []
    expect(event).toMatchObject({
      project: 'demo',
      level: 'warn',
      message: 'with-breadcrumbs',
      extra: { requestId: 1 },
      tags: { feature: 'checkout' },
    })
    expect(event?.timestamp).toBeTypeOf('string')
    expect(event?.breadcrumbs).toHaveLength(50)
    expect(event?.breadcrumbs?.[0]?.message).toBe('crumb-5')
    expect(event?.breadcrumbs?.[49]?.message).toBe('crumb-54')
  })

  it('captures exceptions from Error and non-Error values', () => {
    const pushEvent = vi.spyOn(Transport.prototype, 'pushEvent').mockImplementation(() => {})
    const client = new Log9Client(config)

    const err = new Error('boom')
    err.stack = 'stack trace'
    client.captureException(err, { tags: { route: '/health' }, extra: { retry: false } })
    client.addBreadcrumb({
      category: 'worker',
      message: 'queued',
    })
    client.captureException('bad value')

    expect(pushEvent).toHaveBeenCalledTimes(2)
    expect(pushEvent.mock.calls[0]?.[0]).toMatchObject({
      project: 'demo',
      level: 'error',
      message: 'boom',
      stack_trace: 'stack trace',
      tags: { route: '/health' },
      extra: { retry: false },
    })
    expect(pushEvent.mock.calls[1]?.[0]).toMatchObject({
      project: 'demo',
      level: 'error',
      message: 'bad value',
      breadcrumbs: [
        expect.objectContaining({
          category: 'worker',
          message: 'queued',
        }),
      ],
    })
  })

  it('routes shorthand level helpers through captureEvent and flushes through transport', async () => {
    const pushEvent = vi.spyOn(Transport.prototype, 'pushEvent').mockImplementation(() => {})
    const flush = vi.spyOn(Transport.prototype, 'flush').mockResolvedValue()
    const client = new Log9Client(config)

    client.debug('debug message', { step: 1 })
    client.info('info message')
    client.warn('warn message')
    client.error('error message')
    await expect(client.flush()).resolves.toBeUndefined()

    expect(pushEvent).toHaveBeenCalledTimes(4)
    expect(pushEvent.mock.calls.map(([event]) => event.level)).toEqual(['debug', 'info', 'warn', 'error'])
    expect(flush).toHaveBeenCalledTimes(1)
  })

  it('initializes and replaces the global client instance', () => {
    expect(getClient()).toBeNull()

    const first = init(config)
    const second = init({ ...config, project: 'demo-2' })

    expect(first).toBeInstanceOf(Log9Client)
    expect(second).toBeInstanceOf(Log9Client)
    expect(getClient()).toBe(second)
    expect(getClient()?.config.project).toBe('demo-2')
  })
})
