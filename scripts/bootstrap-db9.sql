-- log9.ai schema for db9
-- Run: db9 db sql <dbname> -q "$(cat scripts/bootstrap-db9.sql)"

CREATE TABLE IF NOT EXISTS events (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  project     TEXT NOT NULL,
  level       TEXT NOT NULL,
  message     TEXT NOT NULL,
  timestamp   TIMESTAMPTZ NOT NULL DEFAULT now(),
  trace_id    TEXT,
  tags        JSONB,
  extra       JSONB,
  breadcrumbs JSONB,
  stack_trace TEXT
);

CREATE TABLE IF NOT EXISTS spans (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  project     TEXT NOT NULL,
  trace_id    TEXT NOT NULL,
  name        TEXT NOT NULL,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  duration    FLOAT NOT NULL,
  status      INT,
  tags        JSONB
);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_events_project_ts ON events (project, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_events_level ON events (level) WHERE level IN ('error', 'warn');
CREATE INDEX IF NOT EXISTS idx_events_trace ON events (trace_id) WHERE trace_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_spans_project_ts ON spans (project, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_spans_trace ON spans (trace_id);

-- JSONB index for tag-based queries
CREATE INDEX IF NOT EXISTS idx_events_tags ON events USING GIN (tags);
CREATE INDEX IF NOT EXISTS idx_spans_tags ON spans USING GIN (tags);
