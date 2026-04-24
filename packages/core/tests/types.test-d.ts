import type { Log9Config, Log9Event, Log9Span, QueryRequest } from '../src/types'

const config: Log9Config = {
  apiKey: 'key',
  endpoint: 'https://log9.example.com',
  project: 'demo',
  batchSize: 10,
  flushInterval: 500,
  debug: true,
}

const event: Log9Event = {
  project: config.project,
  level: 'fatal',
  message: 'test',
  timestamp: new Date().toISOString(),
  tags: { env: 'test' },
  extra: { ok: true },
}

const span: Log9Span = {
  project: config.project,
  trace_id: 'trace-1',
  name: 'request',
  started_at: new Date().toISOString(),
  duration: 123,
  status: 200,
}

const structuredQuery: QueryRequest = {
  project: config.project,
  level: ['debug', 'error'],
  message_like: 'timeout',
  format: 'json',
  limit: 20,
}

const nlQuery: QueryRequest = {
  q: 'show me recent errors',
  format: 'html',
}

void event
void span
void structuredQuery
void nlQuery

const invalidEvent: Log9Event = {
  project: config.project,
  // @ts-expect-error invalid log level should be rejected
  level: 'trace',
  message: 'bad',
  timestamp: new Date().toISOString(),
}

const invalidQuery: QueryRequest = {
  q: 'errors',
  // @ts-expect-error query format is constrained
  format: 'text',
}

// @ts-expect-error apiKey is required in config
const invalidConfig: Log9Config = {
  endpoint: 'https://log9.example.com',
  project: 'demo',
}

void invalidEvent
void invalidQuery
void invalidConfig
