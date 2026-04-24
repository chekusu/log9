import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateSQL, promptHash } from '../src/lib/code-generator'
import { buildQueryPrompt } from '../src/lib/prompt-builder'
import type { Bindings } from '../src/types'

const env: Bindings = {
  DB9_TOKEN: 'token',
  DB9_DATABASE_ID: 'db',
  ANTHROPIC_API_KEY: 'anthropic',
  LOG9_API_KEY: 'log9',
  LOADER: {},
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('code generation and prompts', () => {
  it('calls anthropic and strips fenced SQL output', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: '```sql\nSELECT * FROM events\n```' }],
      }),
    } as unknown as Response)

    await expect(
      generateSQL({
        system: 'sys',
        user: 'user',
        apiKey: 'anthropic-key',
      }),
    ).resolves.toBe('SELECT * FROM events')

    expect(fetchMock).toHaveBeenCalledWith('https://api.anthropic.com/v1/messages', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({
        'x-api-key': 'anthropic-key',
      }),
    }))
  })

  it('surfaces anthropic errors and missing text blocks', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: vi.fn().mockResolvedValue('rate limit'),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ content: [{ type: 'tool_use' }] }),
      } as unknown as Response)

    await expect(generateSQL({ system: 's', user: 'u', apiKey: 'k', model: 'custom-model' })).rejects.toThrow(
      'Claude API error (429): rate limit',
    )
    await expect(generateSQL({ system: 's', user: 'u', apiKey: 'k' })).rejects.toThrow('No text content in Claude response')
  })

  it('hashes prompts deterministically', async () => {
    expect(await promptHash('system', 'user')).toHaveLength(16)
    expect(await promptHash('system', 'user')).toBe(await promptHash('system', 'user'))
    expect(await promptHash('system', 'user')).not.toBe(await promptHash('system', 'other'))
  })

  it('builds a schema-aware prompt from db9 metadata', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        columns: [],
        row_count: 3,
        rows: [
          ['events', 'project', 'text'],
          ['events', 'timestamp', 'timestamptz'],
          ['spans', 'duration', 'double precision'],
        ],
      }),
    } as unknown as Response)

    const prompt = await buildQueryPrompt(env, 'show me errors')

    expect(prompt.user).toBe('show me errors')
    expect(prompt.system).toContain('- events: project (text), timestamp (timestamptz)')
    expect(prompt.system).toContain('- spans: duration (double precision)')
  })

  it('falls back to the built-in schema when db9 metadata lookup fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 500,
      text: vi.fn().mockResolvedValue('broken'),
    } as unknown as Response)

    const prompt = await buildQueryPrompt(env, 'show me errors')

    expect(prompt.system).toContain('- events: id (text), project (text), level (text)')
    expect(prompt.system).toContain('- spans: id (text), project (text), trace_id (text)')
  })
})
