import { describe, expect, it } from 'vitest'
import { assertReadOnlySql } from '../src/lib/sql-guard'

describe('assertReadOnlySql', () => {
  it('rejects empty sql', () => {
    expect(() => assertReadOnlySql('   ')).toThrow('SQL query cannot be empty')
  })

  it('keeps read-only statements and strips a trailing semicolon', () => {
    expect(assertReadOnlySql("SELECT ';' AS literal;")).toBe("SELECT ';' AS literal")
  })

  it('rejects comment-only and multi-statement sql', () => {
    expect(() => assertReadOnlySql('/* comment */')).toThrow('Only single-statement SELECT/WITH queries are allowed')
    expect(() => assertReadOnlySql('SELECT 1; DELETE FROM events')).toThrow(
      'Only single-statement SELECT/WITH queries are allowed',
    )
  })

  it('rejects non-read-only select variants', () => {
    expect(() => assertReadOnlySql('SELECT * INTO temp audit_copy FROM events')).toThrow(
      'SELECT INTO is not allowed in read-only queries',
    )
    expect(() => assertReadOnlySql('SELECT * FROM events FOR UPDATE')).toThrow(
      'Locking SELECT clauses are not allowed in read-only queries',
    )
  })

  it('ignores semicolons and comments inside safe boundaries', () => {
    expect(assertReadOnlySql("/* keep */ WITH sample AS (SELECT ';' AS value) SELECT value FROM sample; -- trailing")).toBe(
      "/* keep */ WITH sample AS (SELECT ';' AS value) SELECT value FROM sample",
    )
  })
})
