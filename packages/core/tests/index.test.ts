import { describe, expect, it } from 'vitest'

import { Log9Client, Transport, getClient, init } from '../src/index'

describe('package exports', () => {
  it('re-exports public runtime APIs from the entrypoint', () => {
    expect(Transport).toBeTypeOf('function')
    expect(Log9Client).toBeTypeOf('function')
    expect(init).toBeTypeOf('function')
    expect(getClient).toBeTypeOf('function')
  })
})
