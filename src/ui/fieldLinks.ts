// ============================================================================
// src/ui/fieldLinks.ts — slope fields and their solution curves, as plain data
// plus every pure question the board asks about them.
//
// src/core/parse/slopeField.ts reads the sentence a teacher types and
// src/core/ode.ts integrates through a point. Neither is STATE. What a board
// has to remember is the same declarative handful a calculus link is:
//
//   the equation text         "dy/dx = x - y"      -> a compiled closure
//   the free constants        [a, k]               -> sliders
//   the initial conditions    [(0, 2), (0, 0.2)]   -> RK4 polylines
//
// Everything visible — the lattice, every solution curve, the legend chip — is
// recomputed from that, every time anything changes. That is why dragging a on
// a logistic field deforms all of its solution curves at once: none of them is
// a stored answer that could go stale, they are questions re-asked. A solve is
// ~0.1 ms, so re-asking is cheaper than remembering.
//
// Pure: no React, no DOM, no canvas. The App owns the state; this owns the
// meaning of it.
// ============================================================================

import type { ParamMeta, Polyline, SlopeField, SlopeFieldOutcome, Vec2 } from '../core/types'
import { parseSlopeField } from '../core/parse/slopeField'
import { solveField } from '../core/ode'
import type { BoardField, FieldSolution } from '../core/persist'
import { FIELD_SPACINGS, FIELD_SPACING_DEFAULT, clampFieldSpacing } from '../core/persist'
import type { LegendEntry } from './present'

// The field SHAPES live in src/core/persist.ts, beside the format that stores
// and validates them (core may not import from src/ui). This module re-exports
// them so the UI has one place to reach for both the data and its meaning.
export type { BoardField, FieldSolution }
export { FIELD_SPACINGS, FIELD_SPACING_DEFAULT, clampFieldSpacing }

// ---------------------------------------------------------------------------
// Reading the sentence
// ---------------------------------------------------------------------------

/**
 * Left-hand sides that mean "this is a differential equation" even when the
 * rest of the line is nonsense.
 *
 * The entry box is shared with ordinary equations, and the two parsers want
 * the same text. "dy/dx = x - " has to come back with the SLOPE FIELD parser's
 * complaint about its empty right side, not parseExpression's bafflement at a
 * product of d, y and x — so anything that starts like a derivative is routed
 * here whether or not it parses.
 *
 * ANY d?/d? and not only dy/dx, for the same reason: "dz/dx = x" is a product
 * of five letters to an expression parser, and it drew a perfectly good
 * implicit curve for it. The field parser knows what it is and says so —
 * "only dy/dx makes a slope field".
 */
const FIELD_LHS_RE = /^\s*(?:d\s*[A-Za-z]\s*\/\s*d\s*[A-Za-z]|dydx|[A-Za-z]\s*['’′])/

/** Does this text claim to be a differential equation? */
export function looksLikeField(src: string): boolean {
  return typeof src === 'string' && FIELD_LHS_RE.test(src)
}

/**
 * parseSlopeField, memoised on the source text.
 *
 * The parse is re-asked on every render that touches a field (the card's
 * LaTeX, the slider names, the compiled closure), and the answer is a pure
 * function of the string. Bounded because a teacher typing into the equation
 * box generates one entry per keystroke over a lesson.
 */
const PARSE_CACHE = new Map<string, SlopeFieldOutcome>()
const PARSE_CACHE_MAX = 200

export function readField(src: string): SlopeFieldOutcome {
  const hit = PARSE_CACHE.get(src)
  if (hit) return hit
  let outcome: SlopeFieldOutcome
  try {
    outcome = parseSlopeField(src)
  } catch {
    outcome = { ok: false, error: 'The parser crashed on this input' }
  }
  if (PARSE_CACHE.size >= PARSE_CACHE_MAX) PARSE_CACHE.clear()
  PARSE_CACHE.set(src, outcome)
  return outcome
}

// ---------------------------------------------------------------------------
// Sliders
// ---------------------------------------------------------------------------

/**
 * The slider range for one free constant.
 *
 * Deliberately the SAME rule a typed expression's constants get (see metaFor
 * in src/core/parse/index.ts, which is module-private): a window around the
 * current value, widening with its magnitude, so `k` in y' = a·y(1 − y/k)
 * behaves on this card exactly as it would on a curve's card. A field's
 * constants are not a different kind of number.
 */
export function fieldParamMeta(name: string, v: number): ParamMeta {
  const av = Math.abs(v)
  if (!Number.isFinite(v) || av < 5) {
    return { name, min: v - 10, max: v + 10, step: 0.01 }
  }
  const span = 2 * av
  const step = Math.pow(10, Math.floor(Math.log10(span)) - 3)
  return { name, min: v - span, max: v + span, step }
}

// ---------------------------------------------------------------------------
// Spacing
// ---------------------------------------------------------------------------

export interface SpacingChoice {
  key: 'sparse' | 'normal' | 'dense'
  label: string
  px: number
  title: string
}

/** Coarse to fine, the way the card reads left to right. */
export const SPACING_CHOICES: readonly SpacingChoice[] = [
  { key: 'sparse', label: 'Sparse', px: FIELD_SPACINGS.sparse, title: 'Fewer, wider segments' },
  { key: 'normal', label: 'Normal', px: FIELD_SPACINGS.normal, title: 'The default lattice' },
  { key: 'dense', label: 'Dense', px: FIELD_SPACINGS.dense, title: 'A finer lattice' },
]

/** Which chip is lit for a given spacing. */
export function spacingKey(px: number): SpacingChoice['key'] {
  const want = clampFieldSpacing(px)
  return SPACING_CHOICES.find((c) => c.px === want)?.key ?? 'normal'
}

// ---------------------------------------------------------------------------
// Compiling
// ---------------------------------------------------------------------------

export interface CompiledField {
  id: string
  /** Null when the equation no longer parses; `error` says why. */
  field: SlopeField | null
  /** "\frac{dy}{dx} = x - y", or the raw source when it cannot be read. */
  latex: string
  paramNames: string[]
  error: string | null
}

/**
 * Every field's closure, rebuilt from its source and its current constants.
 *
 * One pass, one closure each. The renderer evaluates that closure on a ~40x30
 * lattice every frame of a slider drag, so it captures the params array by
 * reference and reads it by index — there is no parsing and no name lookup on
 * that path.
 */
export function compileFields(fields: readonly BoardField[]): Map<string, CompiledField> {
  const out = new Map<string, CompiledField>()
  for (const f of fields) {
    const outcome = readField(f.src)
    if (!outcome.ok) {
      out.set(f.id, {
        id: f.id,
        field: null,
        latex: f.src,
        paramNames: [],
        error: outcome.error,
      })
      continue
    }
    // Pad or trim to whatever the CURRENT equation asks for: retyping
    // "y' = a*y" as "y' = a*y*(1 - y/k)" must not leave k undefined.
    const params = outcome.paramNames.map((_n, i) =>
      Number.isFinite(f.params[i]) ? f.params[i] : outcome.defaultParams[i],
    )
    let built: SlopeField | null = null
    try {
      built = outcome.makeField(f.id, params, f.color)
    } catch {
      built = null
    }
    out.set(f.id, {
      id: f.id,
      field: built
        ? { ...built, visible: f.visible, spacingPx: clampFieldSpacing(f.spacingPx) }
        : null,
      latex: outcome.latex,
      paramNames: outcome.paramNames.slice(),
      error: built ? null : 'the equation could not be turned into a field',
    })
  }
  return out
}

/** The lattices the scene draws, in board order. Hidden fields contribute none. */
export function sceneFields(
  fields: readonly BoardField[],
  compiled: Map<string, CompiledField>,
): SlopeField[] {
  const out: SlopeField[] = []
  for (const f of fields) {
    if (!f.visible) continue
    const c = compiled.get(f.id)
    if (c?.field) out.push(c.field)
  }
  return out
}

// ---------------------------------------------------------------------------
// Solution curves
// ---------------------------------------------------------------------------

/**
 * How far past the visible window a solution curve is integrated, as a
 * fraction of the window's width, each side.
 *
 * Half a screen either way: a small pan or a zoom out shows curve that is
 * already there rather than a line that stops in mid-air at the old edge, and
 * the whole solve is ~0.1 ms, so buying the margin costs nothing worth
 * measuring.
 */
export const SOLVE_PAD = 0.5

/** Stroke weight for a solution curve: heavier than the hairline lattice. */
export const SOLUTION_WIDTH = 2.5

/** The x-range a window's solution curves are integrated across. */
export function solveSpan(window: readonly [number, number]): [number, number] {
  const lo = Math.min(window[0], window[1])
  const hi = Math.max(window[0], window[1])
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || !(hi > lo)) return [-10, 10]
  const pad = (hi - lo) * SOLVE_PAD
  return [lo - pad, hi + pad]
}

/**
 * Is what we already solved still enough for this window?
 *
 * The test is CONTAINMENT, not equality: zooming in, or panning within the
 * margin, leaves every curve already drawn past both edges of the screen, and
 * re-integrating then would be work with no picture to show for it. Only a
 * window that has reached beyond the solved span asks for another solve.
 */
export function spanCovers(
  span: readonly [number, number],
  window: readonly [number, number],
): boolean {
  const lo = Math.min(window[0], window[1])
  const hi = Math.max(window[0], window[1])
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return true
  return span[0] <= lo && span[1] >= hi
}

/**
 * Every solution curve on the board, integrated across `span`.
 *
 * A polyline, not a curve: there is no closed form and no family, only the
 * points RK4 produced. They are still FIGURE — the whole point of the lesson
 * is the curve threading the lattice — so they go into the scene beside the
 * fields and reach the exported PNG by the same route.
 */
export function solutionPolylines(
  fields: readonly BoardField[],
  compiled: Map<string, CompiledField>,
  span: readonly [number, number],
): Polyline[] {
  const out: Polyline[] = []
  const range: [number, number] = [span[0], span[1]]
  for (const f of fields) {
    if (!f.visible || f.solutions.length === 0) continue
    const c = compiled.get(f.id)
    if (!c?.field) continue
    const fn = c.field.f
    for (const s of f.solutions) {
      if (!Number.isFinite(s.x) || !Number.isFinite(s.y)) continue
      let pts: Vec2[] = []
      try {
        pts = solveField(fn, { x: s.x, y: s.y }, range)
      } catch {
        // A pathological closure must never take the board down; the field's
        // own lattice is still an honest picture without this one curve.
        pts = []
      }
      if (pts.length < 2) continue
      out.push({ id: `sol:${s.id}`, pts, color: f.color, width: SOLUTION_WIDTH })
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

const MINUS = '−'

/** A coordinate as a card prints it: trimmed, with a real minus sign. */
export function coord(v: number): string {
  if (!Number.isFinite(v)) return '—'
  const r = Math.abs(v) < 1e-10 ? 0 : v
  const s = Math.abs(r) >= 1e6 ? r.toExponential(2) : String(Math.round(r * 1e6) / 1e6)
  return s.replace('-', MINUS)
}

/** "through (0, 2)" — how one solution curve says what it is. */
export function throughLabel(x: number, y: number): string {
  return `through (${coord(x)}, ${coord(y)})`
}

/** "2 solution curves" / "1 solution curve". */
export function countPhrase(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

/**
 * The equation as a chip on the projected legend.
 *
 * A field has no card on the wall and its lattice says nothing about which
 * equation drew it, so without this a projected board with two fields on it is
 * two grey textures the class has to tell apart by colour alone.
 */
export function fieldLegend(
  fields: readonly BoardField[],
  compiled: Map<string, CompiledField>,
): LegendEntry[] {
  const out: LegendEntry[] = []
  for (const f of fields) {
    if (!f.visible) continue
    const c = compiled.get(f.id)
    if (!c || !c.field) continue
    out.push({ id: f.id, color: f.color, tex: c.latex, text: f.src })
  }
  return out
}

// ---------------------------------------------------------------------------
// What a card is handed
// ---------------------------------------------------------------------------

/** One slider row on a field's card, already resolved against the equation. */
export interface FieldParamRow {
  name: string
  value: number
  meta: ParamMeta
}

/** One solution curve's line on the card. */
export interface FieldSolutionRow {
  id: string
  x: number
  y: number
  /** "through (0, 2)" */
  text: string
}

/**
 * Everything one field's card needs, already computed.
 *
 * The card renders it and nothing else: no parser, no integrator, no closure.
 * The readouts and the picture therefore come from the same pass and cannot
 * disagree.
 */
export interface FieldCardData {
  latex: string
  /** Why this field draws nothing right now, in the parser's words. */
  error: string | null
  params: FieldParamRow[]
  solutions: FieldSolutionRow[]
  spacing: SpacingChoice['key']
}

export function fieldCard(
  field: BoardField,
  compiled: Map<string, CompiledField>,
): FieldCardData {
  const c = compiled.get(field.id)
  const names = c?.paramNames ?? []
  return {
    latex: c?.latex ?? field.src,
    error: c?.error ?? null,
    params: names.map((name, i) => {
      const value = Number.isFinite(field.params[i]) ? field.params[i] : 1
      return { name, value, meta: fieldParamMeta(name, value) }
    }),
    solutions: field.solutions.map((s) => ({
      id: s.id,
      x: s.x,
      y: s.y,
      text: throughLabel(s.x, s.y),
    })),
    spacing: spacingKey(field.spacingPx),
  }
}

// ---------------------------------------------------------------------------
// Edits
// ---------------------------------------------------------------------------

/**
 * Keep the constants a retyped equation still has, BY NAME.
 *
 * "y' = a*y" with a = 2.4, retyped as "y' = a*y*(1 - y/k)", must still be the
 * curve the class was looking at: a stays 2.4 and only k is new. Matching by
 * position would have handed k the 2.4 and reset a, which on a logistic field
 * is a different picture entirely.
 */
export function carryParams(
  oldNames: readonly string[],
  oldValues: readonly number[],
  newNames: readonly string[],
  defaults: readonly number[],
): number[] {
  const had = new Map<string, number>()
  oldNames.forEach((n, i) => {
    const v = oldValues[i]
    if (Number.isFinite(v)) had.set(n, v)
  })
  return newNames.map((n, i) => had.get(n) ?? defaults[i] ?? 1)
}
