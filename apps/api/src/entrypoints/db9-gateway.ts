import { WorkerEntrypoint } from 'cloudflare:workers'
import { assertReadOnlySql } from '../lib/sql-guard'

export class Db9Gateway extends WorkerEntrypoint<{ DB9_TOKEN: string; DB9_DATABASE_ID: string }> {
  async query(sql: string): Promise<unknown> {
    const trimmed = assertReadOnlySql(sql)

    const response = await fetch(
      `https://api.db9.ai/customer/databases/${this.env.DB9_DATABASE_ID}/sql`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.env.DB9_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: trimmed }),
      },
    )

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`db9 query failed (${response.status}): ${text}`)
    }

    return response.json()
  }
}
