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
