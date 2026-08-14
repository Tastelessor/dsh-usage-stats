import { defineConfig } from 'vitest/config'

/** Minimal vitest config: default node env; client tests annotate // @vitest-environment jsdom. */
export default defineConfig({
  // Brief's spec file is .ts but contains JSX; parse .ts as TSX.
  esbuild: {
    loader: 'tsx',
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.spec.ts'],
  },
})
