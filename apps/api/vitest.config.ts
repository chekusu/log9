import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

const rootDir = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@log9/core': fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)),
      'cloudflare:workers': fileURLToPath(new URL('./test/support/cloudflare-workers.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'lcov'],
      reportsDirectory: fileURLToPath(new URL('./coverage', import.meta.url)),
      include: ['src/**/*.ts'],
      exclude: ['src/types.ts'],
      thresholds: {
        lines: 100,
        statements: 100,
        functions: 100,
        branches: 100,
      },
    },
  },
  esbuild: {
    target: 'es2022',
  },
  root: rootDir,
})
