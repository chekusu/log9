interface GenerateSQLOptions {
  system: string
  user: string
  apiKey: string
  model?: string
}

export async function generateSQL(options: GenerateSQLOptions): Promise<string> {
  const { system, user, apiKey, model = 'claude-haiku-4-5-20251001' } = options

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Claude API error (${response.status}): ${error}`)
  }

  const result = (await response.json()) as {
    content: Array<{ type: string; text?: string }>
  }

  const text = result.content.find((c) => c.type === 'text')?.text
  if (!text) throw new Error('No text content in Claude response')

  let sql = text.trim()
  sql = sql.replace(/^```\w*\s*\n/, '')
  sql = sql.replace(/\n```\s*$/, '')
  return sql.trim()
}

export async function promptHash(system: string, user: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(system + '\n---\n' + user)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16)
}
