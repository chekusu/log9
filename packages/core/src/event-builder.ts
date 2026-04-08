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
