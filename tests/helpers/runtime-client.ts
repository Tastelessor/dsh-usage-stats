/**
 * Test-only stand-in for '@deepseek-ai/dsh-client-runtime/client'.
 *
 * The published runtime ships only the shell-loader handoff bundle: its
 * `lib/client.js` calls `window.__ModuleLoader__.load({ id, factory })` and
 * exports nothing, so Node/vitest can never statically import named exports
 * from it. This module runs the REAL bundle through the loader contract —
 * capturing the handoff and materializing the factory with a require shim
 * over the two externals the bundle asks for — then re-exports the snapshot
 * API the store needs. vitest.config.ts aliases the runtime specifier to this
 * file for tests; typecheck keeps resolving the package's own .d.ts.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

interface Handoff {
  id: string
  factory: (require: (specifier: string) => unknown) => Record<string, unknown>
}

const require = createRequire(import.meta.url)

// The bundle's factory requires exactly these two externals; everything else
// (zustand, immer, react) is bundled inline. Namespaces are the shape the
// factory expects (same pattern the harness's client-bundle specs use).
const [cordis, slots] = await Promise.all([
  import('@deepseek-ai/cordis'),
  import('@deepseek-ai/dsh-client-ui-slots'),
])

const bundlePath = require.resolve('@deepseek-ai/dsh-client-runtime/client')
const code = readFileSync(path.resolve(bundlePath), 'utf8')

let handoff: Handoff | undefined
const win = globalThis as { __ModuleLoader__?: { load(h: Handoff): void } }
const previous = win.__ModuleLoader__
win.__ModuleLoader__ = { load: (h) => { handoff = h } }
try {
  // Evaluate the bundle in a scope whose `window` is the jsdom global; the
  // bundle's top level only registers the handoff (the factory runs below).
  new Function('window', code)(win as unknown as Window)
} finally {
  win.__ModuleLoader__ = previous
}
if (handoff === undefined) {
  throw new Error('runtime client bundle did not register a __ModuleLoader__ handoff')
}

const runtime = handoff.factory((specifier) => {
  if (specifier === '@deepseek-ai/cordis') return cordis
  if (specifier === '@deepseek-ai/dsh-client-ui-slots') return slots
  throw new Error(`unexpected runtime-client external: ${specifier}`)
})

/** Real createSnapshotStore from the published bundle (rc.6). */
export const createSnapshotStore =
  runtime.createSnapshotStore as typeof import('@deepseek-ai/dsh-client-runtime/client').createSnapshotStore

export type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
