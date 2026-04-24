import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { Transport } from '../src/transport'
import type { Log9Config, Log9Event, Log9Span } from '../src/types'

const baseConfig: Log9Config = {
  apiKey: 'test-key',
  endpoint: 'https://log9.example.com',
  project: 'demo',
}

function createEvent(message: string): Log9Event {
  return {
    project: 'demo',
    level: 'info',
    message,
    timestamp: '2026-04-24T00:00:00.000Z',
  }
}

function createSpan(name: string): Log9Span {
  return {
    project: 'demo',
    trace_id: 'trace-1',
    name,
    started_at: '2026-04-24T00:00:00.000Z',
    duration: 12,
  }
}

describe('Transport', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('flushes buffered events and spans when batch size is reached', async () => {
    const transport = new Transport({ ...baseConfig, batchSize: 2, flushInterval: 1000 })

    transport.pushEvent(createEvent('first'))
    transport.pushSpan(createSpan('first-span'))
    transport.pushEvent(createEvent('second'))
    transport.pushSpan(createSpan('second-span'))

    await vi.runAllTimersAsync()

    const fetchMock = vi.mocked(fetch)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://log9.example.com/demo/sdk',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Log9-Key': 'test-key',
        },
        body: JSON.stringify({ events: [createEvent('first'), createEvent('second')] }),
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://log9.example.com/demo/sdk',
      expect.objectContaining({
        body: JSON.stringify({ spans: [createSpan('first-span')] }),
      }),
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'https://log9.example.com/demo/sdk',
      expect.objectContaining({
        body: JSON.stringify({ spans: [createSpan('second-span')] }),
      }),
    )
  })

  it('flushes immediately when span batching reaches the threshold', async () => {
    const transport = new Transport({ ...baseConfig, batchSize: 2 })

    transport.pushSpan(createSpan('batch-1'))
    transport.pushSpan(createSpan('batch-2'))

    await Promise.resolve()

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledWith(
      'https://log9.example.com/demo/sdk',
      expect.objectContaining({
        body: JSON.stringify({ spans: [createSpan('batch-1'), createSpan('batch-2')] }),
      }),
    )
  })

  it('flushes once on the timer and clears the pending timer handle', async () => {
    const transport = new Transport({ ...baseConfig, flushInterval: 250 })

    transport.pushEvent(createEvent('scheduled'))
    transport.pushSpan(createSpan('scheduled-span'))
    transport.pushEvent(createEvent('scheduled-2'))

    await vi.advanceTimersByTimeAsync(249)
    expect(fetch).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)

    const fetchMock = vi.mocked(fetch)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    await transport.flush()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('returns immediately when there is nothing to flush', async () => {
    const transport = new Transport(baseConfig)

    await expect(transport.flush()).resolves.toBeUndefined()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('swallows network errors silently unless debug logging is enabled', async () => {
    const quietTransport = new Transport(baseConfig)
    const debugTransport = new Transport({ ...baseConfig, debug: true })
    const error = new Error('network down')
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    vi.mocked(fetch).mockRejectedValue(error)

    quietTransport.pushEvent(createEvent('quiet'))
    await quietTransport.flush()
    expect(consoleError).not.toHaveBeenCalled()

    debugTransport.pushSpan(createSpan('debug'))
    await debugTransport.flush()
    expect(consoleError).toHaveBeenCalledWith('[log9] transport error:', error)
  })
})
