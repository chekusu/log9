/** Log level */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal'

/** A single log event */
export interface Log9Event {
  id?: string
  project: string
  level: LogLevel
  message: string
  timestamp: string
  trace_id?: string
  tags?: Record<string, string>
  extra?: Record<string, unknown>
  breadcrumbs?: Breadcrumb[]
  stack_trace?: string
}

/** A performance span */
export interface Log9Span {
  id?: string
  project: string
  trace_id: string
  name: string
  started_at: string
  duration: number
  status?: number
  tags?: Record<string, string>
}

/** Breadcrumb entry */
export interface Breadcrumb {
  timestamp: string
  category: string
  message: string
  level?: LogLevel
  data?: Record<string, unknown>
}

/** SDK configuration */
export interface Log9Config {
  project: string
  endpoint: string
  apiKey: string
  /** Max events before flushing (default: 25) */
  batchSize?: number
  /** Max ms before flushing (default: 5000) */
  flushInterval?: number
  /** Enable debug logging (default: false) */
  debug?: boolean
}

/** Structured query (agent mode) */
export interface StructuredQuery {
  project?: string
  level?: LogLevel[]
  since?: string
  until?: string
  message_like?: string
  tags?: Record<string, string>
  group_by?: string
  order_by?: 'count' | 'timestamp'
  limit?: number
  format?: 'json' | 'html'
}

/** NL query (human mode) */
export interface NLQuery {
  q: string
  format?: 'json' | 'html'
}

/** Query request — either NL or structured */
export type QueryRequest = NLQuery | StructuredQuery
