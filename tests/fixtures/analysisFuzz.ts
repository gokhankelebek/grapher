// ============================================================================
// tests/fixtures/analysisFuzz.ts — run by tests/analysisBugs.test.ts in a
// CHILD process (vite-node), so that an analysis that never returns is killed
// by the parent's timeout instead of freezing a vitest worker: a synchronous
// infinite loop cannot be interrupted from inside its own thread.
//
// Prints one JSON line: for each expression, the wall time (ms) of every
// analysis entry point, each on a fresh curve so no memo is shared — and a
// second (TEXT) with the domain and range as the card writes them, so the
// parent can check them for artefacts (an endpoint like −1301000 that no
// formula wrote: tan(x)/x once listed a sparse sample of tan's poles).
// ============================================================================

import type { FittedCurve, ModelSpec } from '../../src/core/types'
import { parseExpression } from '../../src/core/parse'
import { curveDomain, curveRange, levelCrossings, oneToOneInfo } from '../../src/core/domainRange'
import { analyzeCurve } from '../../src/core/analyze'
import { findAsymptotes, findHoles } from '../../src/core/holes'

let seq = 0
function typed(src: string): { curve: FittedCurve; models: Record<string, ModelSpec> } {
  const r = parseExpression(src)
  if (!r.ok) throw new Error(`"${src}" does not parse: ${r.error}`)
  const id = `fuzz_${++seq}`
  const spec = r.plot.makeModel(id)
  const curve: FittedCurve = {
    id: `c${seq}`, modelId: id, params: r.plot.defaultParams, kind: r.plot.kind,
    domain: r.plot.domain, color: '#4f9cf9', strokeWidth: 2.5, visible: true, error: 0,
  }
  return { curve, models: { [id]: spec } }
}

const CALLS: Record<string, (t: ReturnType<typeof typed>) => unknown> = {
  oneToOne: (t) => oneToOneInfo(t.curve, t.models),
  range: (t) => curveRange(t.curve, t.models),
  domain: (t) => curveDomain(t.curve, t.models),
  analyze: (t) => analyzeCurve(t.curve, t.models),
  asymptotes: (t) => findAsymptotes(t.curve, t.models, [-10, 10]),
  holes: (t) => findHoles(t.curve, t.models, [-10, 10]),
  level: (t) => levelCrossings(t.curve, t.models, 1, [-10, 10]),
}

const exprs: string[] = JSON.parse(process.argv[2] ?? '[]')

// warm the JIT on something ordinary, so the first nasty case is not charged for it
for (const fn of Object.values(CALLS)) fn(typed('y = x^3 - 2x'))

const out: Record<string, Record<string, number>> = {}
const texts: Record<string, { domain: string[]; range: string[] }> = {}
for (const src of exprs) {
  const row: Record<string, number> = {}
  for (const [name, fn] of Object.entries(CALLS)) {
    const t = typed(src)
    const t0 = performance.now()
    fn(t)
    row[name] = performance.now() - t0
  }
  out[src] = row
  // after the timing, on a fresh curve of its own
  const tt = typed(src)
  const d = curveDomain(tt.curve, tt.models)
  const r = curveRange(tt.curve, tt.models)
  texts[src] = { domain: d ? [d.text, d.builder] : [], range: r ? [r.text, r.builder] : [] }
}
console.log(`FUZZ ${JSON.stringify(out)}`)
console.log(`TEXT ${JSON.stringify(texts)}`)
