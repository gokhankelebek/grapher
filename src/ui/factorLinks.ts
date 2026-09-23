// ============================================================================
// src/ui/factorLinks.ts — editing a function BY ITS ROOTS, as the UI does it.
//
// src/core/factored.ts is the two-way bridge between a typed equation and a
// list of factors: `readFactored` turns "y = (x + 1)^2(x - 3)" into a spec and
// `factoredSource` turns a spec back into the line. Everything here sits on
// top of that bridge and is pure — no React, no DOM, no App state:
//
//   * the spec EDITS a card or the "Build from roots" editor makes (add a
//     root, drop one, step a multiplicity, open the denominator), each one a
//     plain FactorOp so a test can state it and a card can name it for undo;
//   * what each row SAYS ("touches", "vertical asymptote — same sign"), read
//     from `rootsOf` and matched back to the row it came from;
//   * the one thing the board keeps beside the equation: whether the curve
//     was defined THROUGH A POINT, in which case the leading coefficient is
//     re-solved on every edit so the curve keeps passing through it.
//
// The result of every edit is an ordinary typed curve. Nothing downstream —
// analysis, holes, asymptotes, figure styles, export — knows this file exists.
// ============================================================================

import type { Vec2 } from '../core/types'
import {
  endBehaviour,
  factoredSource,
  leadingThrough,
  readFactored,
  rootsOf,
} from '../core/factored'
import type { Factor, FactoredRoot, FactoredSpec, RootBehaviour } from '../core/factored'
import { parseExpression } from '../core/parse'
import { parseNumeric } from './numeric'
import { numText } from './shapeLinks'

export type FactorSide = 'num' | 'den'

export const MULT_MIN = 1
export const MULT_MAX = 9

/** A multiplicity a row can hold: a whole number from 1 to 9. */
export function clampMult(n: number): number {
  if (!Number.isFinite(n)) return MULT_MIN
  return Math.min(MULT_MAX, Math.max(MULT_MIN, Math.round(n)))
}

// ---------------------------------------------------------------------------
// edits
// ---------------------------------------------------------------------------

/** One stated change to a spec. Data, so it can be tested and named. */
export type FactorOp =
  | { kind: 'addRoot'; side: FactorSide; root?: string }
  | { kind: 'addComplex'; side: FactorSide; re?: string; im?: string }
  | { kind: 'remove'; side: FactorSide; index: number }
  | { kind: 'setMult'; side: FactorSide; index: number; mult: number }
  | { kind: 'stepMult'; side: FactorSide; index: number; delta: number }
  | { kind: 'setRoot'; side: FactorSide; index: number; root: string }
  | { kind: 'setComplex'; side: FactorSide; index: number; part: 're' | 'im'; text: string }
  | { kind: 'setA'; a: string }
  | { kind: 'toggleRational' }

function list(spec: FactoredSpec, side: FactorSide): Factor[] {
  return side === 'num' ? spec.num : spec.den
}

function withList(spec: FactoredSpec, side: FactorSide, next: Factor[]): FactoredSpec {
  return side === 'num' ? { ...spec, num: next } : { ...spec, den: next }
}

function mapFactor(
  spec: FactoredSpec,
  side: FactorSide,
  index: number,
  fn: (f: Factor) => Factor,
): FactoredSpec {
  const l = list(spec, side)
  if (index < 0 || index >= l.length) return spec
  const next = l.slice()
  next[index] = fn(l[index])
  return withList(spec, side, next)
}

/** The numeric value of a text field, or null when it is not a number. */
export function evalText(text: string): number | null {
  try {
    const v = parseNumeric(text)
    return v !== null && Number.isFinite(v) ? v : null
  } catch {
    return null
  }
}

/** Every real root's value on either side, as far as it evaluates. */
function realValues(spec: FactoredSpec): number[] {
  const out: number[] = []
  for (const f of [...spec.num, ...spec.den]) {
    if (f.root === undefined) continue
    const v = evalText(f.root)
    if (v !== null) out.push(v)
  }
  return out
}

/**
 * A root a new row can start at: the first of 0, 1, −1, 2, −2, … that no row
 * already uses. A new DENOMINATOR row starting on a numerator root would open
 * as a hole, which is a lesson of its own and not what "+ root" means.
 */
export function freshRoot(spec: FactoredSpec): string {
  const used = realValues(spec)
  for (let k = 0; k < 40; k++) {
    const n = k === 0 ? 0 : k % 2 === 1 ? (k + 1) / 2 : -k / 2
    if (!used.some((u) => Math.abs(u - n) < 1e-9)) return String(n)
  }
  return '0'
}

/** Apply one edit. Returns the same object when nothing changes. */
export function applyFactorOp(spec: FactoredSpec, op: FactorOp): FactoredSpec {
  switch (op.kind) {
    case 'addRoot': {
      const root = op.root ?? freshRoot(spec)
      return withList(spec, op.side, [...list(spec, op.side), { root, mult: 1 }])
    }
    case 'addComplex': {
      const complex = { re: op.re ?? '0', im: op.im ?? '1' }
      return withList(spec, op.side, [...list(spec, op.side), { complex, mult: 1 }])
    }
    case 'remove': {
      const l = list(spec, op.side)
      if (op.index < 0 || op.index >= l.length) return spec
      return withList(
        spec,
        op.side,
        l.filter((_, i) => i !== op.index),
      )
    }
    case 'setMult': {
      const mult = clampMult(op.mult)
      const f = list(spec, op.side)[op.index]
      if (!f || f.mult === mult) return spec
      return mapFactor(spec, op.side, op.index, (g) => ({ ...g, mult }))
    }
    case 'stepMult': {
      const f = list(spec, op.side)[op.index]
      if (!f) return spec
      const mult = clampMult(f.mult + op.delta)
      if (mult === f.mult) return spec
      return mapFactor(spec, op.side, op.index, (g) => ({ ...g, mult }))
    }
    case 'setRoot': {
      const f = list(spec, op.side)[op.index]
      if (!f || f.root === op.root) return spec
      return mapFactor(spec, op.side, op.index, (g) => {
        const { complex: _c, ...rest } = g
        return { ...rest, root: op.root }
      })
    }
    case 'setComplex': {
      const f = list(spec, op.side)[op.index]
      if (!f || !f.complex || f.complex[op.part] === op.text) return spec
      return mapFactor(spec, op.side, op.index, (g) => ({
        ...g,
        complex: { ...g.complex!, [op.part]: op.text },
      }))
    }
    case 'setA':
      return spec.a === op.a ? spec : { ...spec, a: op.a }
    case 'toggleRational':
      // Opening the denominator opens it WITH a row: an empty denominator is
      // the same function as none, and a toggle that changed nothing on the
      // board would look broken.
      return spec.den.length > 0
        ? { ...spec, den: [] }
        : { ...spec, den: [{ root: freshRoot(spec), mult: 1 }] }
  }
}

/** What undo calls this edit. */
export function factorOpLabel(op: FactorOp, spec?: FactoredSpec): string {
  switch (op.kind) {
    case 'addRoot':
      return 'add root'
    case 'addComplex':
      return 'add complex pair'
    case 'remove':
      return 'remove root'
    case 'setMult':
    case 'stepMult':
      return 'set multiplicity'
    case 'setRoot':
      return 'edit root'
    case 'setComplex':
      return 'edit complex pair'
    case 'setA':
      return 'set leading coefficient'
    case 'toggleRational':
      return spec && spec.den.length > 0 ? 'make polynomial' : 'make rational'
  }
}

// ---------------------------------------------------------------------------
// numbers written back into the line
// ---------------------------------------------------------------------------

/**
 * A computed number written as a teacher would write it: a fraction when it
 * is one with a small denominator ("1/3", "-5/4"), otherwise six significant
 * figures. ASCII, because it goes back through the parser.
 */
export function niceNumber(v: number): string {
  if (!Number.isFinite(v)) return '0'
  if (Math.abs(v) < 1e-12) return '0'
  for (let q = 1; q <= 32; q++) {
    const p = Math.round(v * q)
    if (p !== 0 && Math.abs(v * q - p) < 1e-9 * Math.max(1, Math.abs(v * q))) {
      return q === 1 ? String(p) : `${p}/${q}`
    }
  }
  const s = String(Number(v.toPrecision(6)))
  return s.includes('e') ? numText(v) : s
}

/**
 * The leading coefficient that sends this spec through `point`, as text —
 * or null when no coefficient can (the point is a root, a pole, or the
 * factors are not all numbers yet).
 */
export function throughA(spec: FactoredSpec, point: Vec2): string | null {
  if (specProblems({ ...spec, a: '1' }).length > 0) return null
  let a: number | null = null
  try {
    a = leadingThrough(spec, point)
  } catch {
    a = null
  }
  if (a === null || !Number.isFinite(a) || a === 0) return null
  return niceNumber(a)
}

/**
 * The spec after an edit, with the "through a point" promise kept: when the
 * curve was defined through a point, the leading coefficient is re-solved so
 * it still passes through it. When no coefficient can (the edit put a root
 * on the point), `a` is left as it was rather than the edit refused.
 */
export function keepThrough(spec: FactoredSpec, through: Vec2 | null | undefined): FactoredSpec {
  if (!through) return spec
  const a = throughA(spec, through)
  return a === null || a === spec.a ? spec : { ...spec, a }
}

/**
 * A root DRAGGED on the board. The pointer's value is already snapped; it is
 * written as a plain number (a sqrt(2) root that is dragged becomes the
 * decimal it was dragged to — typed values stay exact until then).
 */
export function moveRoot(
  spec: FactoredSpec,
  side: FactorSide,
  index: number,
  x: number,
  through?: Vec2 | null,
): FactoredSpec | null {
  if (!Number.isFinite(x)) return null
  const f = list(spec, side)[index]
  if (!f || f.root === undefined) return null
  const text = numText(x)
  const moved = f.root === text ? spec : applyFactorOp(spec, { kind: 'setRoot', side, index, root: text })
  return keepThrough(moved, through)
}

// ---------------------------------------------------------------------------
// what is wrong, and what each row says
// ---------------------------------------------------------------------------

export interface FieldProblem {
  side: FactorSide | 'a'
  index: number
  field: 'a' | 'root' | 're' | 'im'
  message: string
}

/** Every field that does not evaluate, in reading order. Empty = buildable. */
export function specProblems(spec: FactoredSpec): FieldProblem[] {
  const out: FieldProblem[] = []
  const a = spec.a.trim() === '' ? null : evalText(spec.a)
  if (a === null) {
    out.push({
      side: 'a',
      index: 0,
      field: 'a',
      message:
        spec.a.trim() === ''
          ? 'The leading coefficient is empty.'
          : `The leading coefficient “${spec.a}” is not a number.`,
    })
  } else if (a === 0) {
    out.push({ side: 'a', index: 0, field: 'a', message: 'The leading coefficient can’t be 0.' })
  }
  for (const side of ['num', 'den'] as const) {
    const where = side === 'num' ? 'numerator' : 'denominator'
    list(spec, side).forEach((f, index) => {
      if (f.complex) {
        if (evalText(f.complex.re) === null) {
          out.push({
            side,
            index,
            field: 're',
            message: `In the ${where}, “${f.complex.re}” is not a number.`,
          })
        }
        const im = evalText(f.complex.im)
        if (im === null) {
          out.push({
            side,
            index,
            field: 'im',
            message: `In the ${where}, “${f.complex.im}” is not a number.`,
          })
        } else if (im === 0) {
          out.push({
            side,
            index,
            field: 'im',
            message: `In the ${where}, b can’t be 0 — a ± 0i is a real double root.`,
          })
        }
        return
      }
      const text = f.root ?? ''
      if (evalText(text) === null) {
        out.push({
          side,
          index,
          field: 'root',
          message:
            text.trim() === ''
              ? `A ${where} root is empty.`
              : `The ${where} root “${text}” is not a number.`,
        })
      }
    })
  }
  return out
}

/** rootsOf, never throwing. */
export function safeRootsOf(spec: FactoredSpec): FactoredRoot[] {
  if (specProblems(spec).length > 0) return []
  try {
    return rootsOf(spec)
  } catch {
    return []
  }
}

/** readFactored, never throwing. */
export function safeReadFactored(src: string | undefined): FactoredSpec | null {
  if (!src || !src.trim()) return null
  try {
    return readFactored(src)
  } catch {
    return null
  }
}

/** What each behaviour is called on a row. */
export const BEHAVIOUR_TEXT: Record<RootBehaviour, string> = {
  crosses: 'crosses',
  touches: 'touches',
  flattens: 'flattens',
  'asymptote-odd': 'vertical asymptote — sign changes',
  'asymptote-even': 'vertical asymptote — same sign',
  hole: 'hole',
}

/**
 * What the graph does at ONE row's root, as the row says it.
 *
 * `rootsOf` reports a root shared by both lists once, as 'both', indexed into
 * the numerator — so a denominator row finds its root by value. A complex
 * pair has no x-intercept and no asymptote, and says so.
 */
export function rowBehaviour(
  spec: FactoredSpec,
  side: FactorSide,
  index: number,
  roots: readonly FactoredRoot[] = safeRootsOf(spec),
): string | null {
  const f = list(spec, side)[index]
  if (!f) return null
  if (f.complex) return side === 'num' ? 'no real zero' : 'no asymptote'
  let r: FactoredRoot | undefined
  if (side === 'num') {
    r = roots.find((x) => (x.side === 'num' || x.side === 'both') && x.index === index)
  } else {
    r = roots.find((x) => x.side === 'den' && x.index === index)
    if (!r) {
      const v = f.root === undefined ? null : evalText(f.root)
      if (v !== null) r = roots.find((x) => x.side === 'both' && Math.abs(x.x - v) < 1e-9)
    }
  }
  return r ? BEHAVIOUR_TEXT[r.behaviour] : null
}

// ---------------------------------------------------------------------------
// the preview: what "Add to graph" would put on the board
// ---------------------------------------------------------------------------

export interface FactorPreview {
  /** The line it will create, or null while a field does not evaluate. */
  src: string | null
  /** The LaTeX a card would print for it — the parser's own. */
  latex: string | null
  /** One sentence about the ends ("degree 3, a > 0: …"). */
  end: string
  /** The first thing that stops it being built, in words. */
  error: string | null
}

export function factorPreview(spec: FactoredSpec): FactorPreview {
  const problems = specProblems(spec)
  if (problems.length > 0) {
    return { src: null, latex: null, end: '', error: problems[0].message }
  }
  let src: string
  try {
    src = factoredSource(spec)
  } catch {
    return { src: null, latex: null, end: '', error: 'These factors could not be written out.' }
  }
  let latex: string | null = null
  let error: string | null = null
  try {
    const o = parseExpression(src)
    if (o.ok) latex = o.plot.latex
    else error = o.error
  } catch {
    error = 'The parser crashed on this equation.'
  }
  let end = ''
  try {
    end = endBehaviour(spec)
  } catch {
    end = ''
  }
  return { src, latex, end, error }
}

/** The editor's starting spec: a = 1 and one root at 0. */
export function blankSpec(): FactoredSpec {
  return { a: '1', num: [{ root: '0', mult: 1 }], den: [] }
}

// ---------------------------------------------------------------------------
// one committed edit on a card
// ---------------------------------------------------------------------------

export interface FactorCommitDeps {
  /** The curve was defined through this point: re-solve a on every edit. */
  through?: Vec2 | null
  /** The App's restate path: rewrite the curve's line in place. */
  restate(src: string, label: string): string | null
  /** Typing `a` by hand ends the through-a-point promise. */
  dropThrough?(): void
}

/**
 * The whole of what a card does with one edit: apply it, keep the point
 * promise, write the line, restate the curve. Returns the restate path's
 * refusal, or null. An edit that changes nothing restates nothing.
 */
export function commitFactorOp(
  spec: FactoredSpec,
  op: FactorOp,
  deps: FactorCommitDeps,
): string | null {
  let next = applyFactorOp(spec, op)
  if (next === spec) return null
  if (op.kind === 'setA') {
    deps.dropThrough?.()
  } else {
    next = keepThrough(next, deps.through)
  }
  if (specProblems(next).length > 0) return specProblems(next)[0].message
  let src: string
  try {
    src = factoredSource(next)
  } catch {
    return 'These factors could not be written out.'
  }
  return deps.restate(src, factorOpLabel(op, spec))
}

// ---------------------------------------------------------------------------
// board handles
// ---------------------------------------------------------------------------

export interface RootHandle {
  side: FactorSide
  index: number
  x: number
  /** "root" on the numerator, "asymptote" on the denominator. */
  label: string
}

/** Every real root that evaluates, where the board puts its handle. */
export function rootHandles(spec: FactoredSpec): RootHandle[] {
  const out: RootHandle[] = []
  for (const side of ['num', 'den'] as const) {
    list(spec, side).forEach((f, index) => {
      if (f.root === undefined) return
      const x = evalText(f.root)
      if (x === null) return
      out.push({ side, index, x, label: side === 'num' ? 'root' : 'asymptote' })
    })
  }
  return out
}
