import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/** Minimal vitest config: default node env; client tests annotate // @vitest-environment jsdom. */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.spec.ts?(x)'],
  },
  resolve: {
    alias: [
      {
        // The published runtime client is a shell-loader handoff bundle with
        // no static exports; tests materialize the real factory through the
        // loader contract instead (see tests/helpers/runtime-client.ts).
        find: /^@deepseek-ai\/dsh-client-runtime\/client$/,
        replacement: fileURLToPath(new URL('./tests/helpers/runtime-client.ts', import.meta.url)),
      },
    ],
  },
})
