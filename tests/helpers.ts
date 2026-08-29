// ============================================================================
// Shared test helpers.
//
// Everything random here comes from a seeded PRNG — never Math.random() — so
// every assertion in the suite is reproducible run to run.
//
// `trace()` simulates a human drawing: it walks a ground-truth curve, adds
// hand jitter in math units, projects the point to SCREEN pixels (rounding to
// whole pixels the way a pointer event does), and maps it back to math space —
// exactly the pipeline CanvasStage feeds into processStroke().
// ============================================================================

import type { Vec2, Viewport, FitResult, ProcessedStroke } from '../src/core/types'
import { toScreen, toMath } from '../src/core/types'
import { processStroke } from '../src/core/stroke'
import { recognize } from '../src/core/fit/recognize'

// ---------------------------------------------------------------------------
// Seeded PRNG (mulberry32) — deterministic, decent distribution, tiny.
// ---------------------------------------------------------------------------

export function makeRng(seed: number): () => number {
  let a = seed >>> 0
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Standard normal deviate from a seeded uniform source (Box–Muller). */
export function makeGauss(rng: () => number): () => number {
  let spare: number | null = null
  return function gauss(): number {
    if (spare !== null) {
      const v = spare
      spare = null
      return v
    }
    let u = 0
    let v = 0
    let s = 0
    do {
      u = 2 * rng() - 1
      v = 2 * rng() - 1
      s = u * u + v * v
    } while (s === 0 || s >= 1)
    const f = Math.sqrt((-2 * Math.log(s)) / s)
    spare = v * f
    return u * f
  }
}

// ---------------------------------------------------------------------------
// The canonical viewport used by every recognition test.
// ---------------------------------------------------------------------------

export const VP: Viewport = {
  center: { x: 0, y: 0 },
  pxPerUnit: 60,
  widthPx: 1200,
  heightPx: 800,
}

/** Default hand-jitter standard deviation, in math units. */
export const JITTER = 0.03

export interface TraceOpts {
  /** number of raw pointer samples (a real stroke is 60–400) */
  n?: number
  /** jitter sd in math units */
  jitter?: number
  vp?: Viewport
  /** irregular sample spacing, like a hand speeding up and slowing down */
  wobbleSpacing?: boolean
}

/**
 * Walk `fn` over [s0, s1] and return the math-space polyline a human's pointer
 * would have produced: jittered, pixel-quantized ink.
 */
export function trace(
  fn: (s: number) => Vec2,
  s0: number,
  s1: number,
  rng: () => number,
  opts: TraceOpts = {},
): Vec2[] {
  const n = opts.n ?? 160
  const jitter = opts.jitter ?? JITTER
  const vp = opts.vp ?? VP
  const gauss = makeGauss(rng)
  const out: Vec2[] = []
  for (let i = 0; i < n; i++) {
    let u = i / (n - 1)
    if (opts.wobbleSpacing !== false) {
      // ease the parameter slightly and non-monotonically-in-speed: the pen
      // is slower at the ends of a stroke than in the middle
      u = u + 0.04 * Math.sin(2 * Math.PI * u)
      u = Math.min(1, Math.max(0, u))
    }
    const s = s0 + (s1 - s0) * u
    const p = fn(s)
    const mathPt = { x: p.x + jitter * gauss(), y: p.y + jitter * gauss() }
    // through the real pointer pipeline: math -> screen px -> math
    const scr = toScreen(mathPt, vp)
    out.push(toMath({ x: Math.round(scr.x), y: Math.round(scr.y) }, vp))
  }
  return out
}

/** trace() + processStroke(), i.e. exactly what the canvas hands recognize(). */
export function drawStroke(
  fn: (s: number) => Vec2,
  s0: number,
  s1: number,
  rng: () => number,
  opts: TraceOpts = {},
): ProcessedStroke {
  return processStroke(trace(fn, s0, s1, rng, opts), opts.vp ?? VP)
}

/** Full pipeline: trace -> processStroke -> recognize (best-first candidates). */
export function drawAndRecognize(
  fn: (s: number) => Vec2,
  s0: number,
  s1: number,
  rng: () => number,
  opts: TraceOpts = {},
): FitResult[] {
  const vp = opts.vp ?? VP
  return recognize(drawStroke(fn, s0, s1, rng, opts), vp)
}

// ---------------------------------------------------------------------------
// Curve generators (ground truth), in math coordinates.
// ---------------------------------------------------------------------------

/** y = f(x) traced left to right. */
export const explicitPath =
  (f: (x: number) => number) =>
    (x: number): Vec2 => ({ x, y: f(x) })

/** r = f(theta), signed-r polar convention (negative r plots at theta+pi). */
export const polarPath =
  (f: (t: number) => number) =>
    (t: number): Vec2 => {
      const r = f(t)
      return { x: r * Math.cos(t), y: r * Math.sin(t) }
    }

// ---------------------------------------------------------------------------
// Assertion utilities
// ---------------------------------------------------------------------------

export function winner(results: FitResult[]): FitResult {
  if (results.length === 0) throw new Error('recognize() returned no candidates')
  return results[0]
}

export function candidate(results: FitResult[], modelId: string): FitResult | undefined {
  return results.find(r => r.modelId === modelId)
}

/** A readable ranking, used in assertion messages when a test fails. */
export function ranking(results: FitResult[]): string {
  return results
    .map(r => `${r.modelId}(score=${r.score.toFixed(2)}, err=${r.error.toFixed(4)})`)
    .join(' < ')
}

export function relErr(actual: number, expected: number): number {
  if (expected === 0) return Math.abs(actual)
  return Math.abs(actual - expected) / Math.abs(expected)
}
