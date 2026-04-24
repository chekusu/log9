const READ_ONLY_PREFIX = /^(SELECT|WITH)\b/i
const WRITE_KEYWORDS = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|REPLACE|GRANT|REVOKE|MERGE|COPY)\b/i
const SELECT_INTO_PATTERN = /\bSELECT\b[\s\S]*\bINTO\b/i
const LOCKING_READ_PATTERN = /\bFOR\s+(UPDATE|NO\s+KEY\s+UPDATE|SHARE|KEY\s+SHARE)\b/i

export function assertReadOnlySql(sql: string): string {
  const trimmed = sql.trim()
  if (!trimmed) {
    throw new Error('SQL query cannot be empty')
  }

  const normalized = stripSqlLiteralsAndComments(trimmed)
  const statements = normalized
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)

  if (statements.length !== 1) {
    throw new Error('Only single-statement SELECT/WITH queries are allowed')
  }

  const statement = statements[0]
  if (!READ_ONLY_PREFIX.test(statement)) {
    throw new Error('Only SELECT/WITH queries are allowed')
  }

  if (LOCKING_READ_PATTERN.test(statement)) {
    throw new Error('Locking SELECT clauses are not allowed in read-only queries')
  }

  if (WRITE_KEYWORDS.test(statement)) {
    throw new Error('Only read-only SELECT/WITH queries are allowed')
  }

  if (SELECT_INTO_PATTERN.test(statement)) {
    throw new Error('SELECT INTO is not allowed in read-only queries')
  }

  return stripTrailingTerminator(trimmed)
}

function stripSqlLiteralsAndComments(sql: string): string {
  return sql
    .replace(/'([^']|'')*'/g, "''")
    .replace(/--.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
}

function stripTrailingTerminator(sql: string): string {
  return sql.replace(/(?:\s*(?:--.*|\/\*[\s\S]*?\*\/))*\s*;+\s*(?:--.*|\/\*[\s\S]*?\*\/)?\s*$/s, '')
}
