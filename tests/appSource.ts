// ============================================================================
// tests/appSource.ts — the App's source text, for the tests that read it.
//
// App.tsx is the composition root; its state, effects and handlers live in
// the hooks under src/app/. "What the App handles" is all of them together.
// ============================================================================

import { readFileSync, readdirSync } from 'node:fs'

export function appSource(): string {
  const dir = new URL('../src/app/', import.meta.url)
  const hooks = readdirSync(dir)
    .filter((f) => /\.tsx?$/.test(f))
    .sort()
    .map((f) => readFileSync(new URL(f, dir), 'utf8'))
  return [readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8'), ...hooks].join('\n')
}
