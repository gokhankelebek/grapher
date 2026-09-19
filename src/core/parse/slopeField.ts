// ============================================================================
// Differential equations for slope fields (src/core/parse/slopeField.ts):
//
//   export function parseSlopeField(src: string): SlopeFieldOutcome
//
// A slope field is dy/dx = f(x, y): one formula, evaluated on a lattice. The
// hard part is not the arithmetic — the expression engine in ./index.ts
// already does all of it — but the left-hand side, which a teacher writes six
// different ways and a student writes a seventh.
//
// Accepted left sides (case-sensitive, whitespace-liberal):
//   dy/dx      d y / d x      dydx      y'      y'(x)      f'(x)      g'
// Accepted separators:  '='  or  ':'   (so "dy/dx: x - y" works too)
//
// The right side is any expression in x and y in the full existing language —
// functions, powers, implicit multiplication, |...|, pi/e — with single-letter
// free constants becoming sliders exactly as parseExpression does:
//
//   dy/dx = x - y      y' = x*y        dy/dx = a*x + b*y      dy/dx = -x/y
//   y' = sin(x) + y    dy/dx = y(1-y)  dy/dx = k*y            dy/dx = 2
//
// Either variable may be absent (dy/dx = x is a perfectly good field), and so
// may both (dy/dx = 3 is the constant field).
//
// `makeField` compiles ONCE. The renderer evaluates the returned `f` on a
// ~40x30 lattice every frame of a slider drag, so there is no parsing, no
// param lookup by name and no allocation on that path: `f` is a closure over
// the already-compiled evaluator and the param array, reading params by index.
//
// No module cycle: this file imports ./index.ts; ./index.ts never imports it.
// ============================================================================

import type { SlopeField, SlopeFieldOutcome } from '../types'
import { compileExpr } from './index'

// ----------------------------------------------------------------------------
// Left-hand side
// ----------------------------------------------------------------------------

/** ' and the two unicode primes a word processor substitutes for it. */
const PRIME = "['’′]"

/** dy/dx | dydx | <letter>' | <letter>'(x) */
const LHS_RE = new RegExp(
  `^\\s*(?:d\\s*y\\s*/\\s*d\\s*x|dydx|[A-Za-z]\\s*${PRIME}\\s*(?:\\(\\s*x\\s*\\)\\s*)?)\\s*$`,
)

/** d<letter>/d<letter> — a derivative, but not this one. */
const OTHER_DERIV_RE = /^\s*d\s*([A-Za-z])\s*\/\s*d\s*([A-Za-z])\s*$/
/** <letter>'(<something that is not x>) */
const PRIMED_ARG_RE = new RegExp(`^\\s*([A-Za-z])\\s*${PRIME}\\s*\\(\\s*([A-Za-z]+|θ)\\s*\\)\\s*$`)
/** two primes, or the unicode double prime */
const SECOND_DERIV_RE = new RegExp(`${PRIME}\\s*${PRIME}|″`)

const HINT = 'a slope field needs dy/dx = f(x, y)'

interface Fail {
  ok: false
  error: string
  pos?: number
}

const fail = (error: string, pos?: number): Fail =>
  pos === undefined ? { ok: false, error } : { ok: false, error, pos }

/** Offset of the first non-space character of `s`, or 0 when it is all space. */
function firstNonSpace(s: string): number {
  const m = /\S/.exec(s)
  return m ? m.index : 0
}

/** Explain a left-hand side that is not a derivative. */
function lhsError(lhs: string, at: number): Fail {
  const pos = at + firstNonSpace(lhs)
  if (SECOND_DERIV_RE.test(lhs)) {
    return fail(`Second derivatives aren't supported — ${HINT}`, pos)
  }
  const other = OTHER_DERIV_RE.exec(lhs)
  if (other && !(other[1] === 'y' && other[2] === 'x')) {
    return fail(
      `Only dy/dx makes a slope field — 'd${other[1]}/d${other[2]}' is a derivative in other variables`,
      pos,
    )
  }
  const primed = PRIMED_ARG_RE.exec(lhs)
  if (primed) {
    return fail(
      `The derivative has to be with respect to x — write ${primed[1]}'(x), not ${primed[1]}'(${primed[2] === 'theta' ? 'θ' : primed[2]})`,
      pos,
    )
  }
  if (/^\s*y\s*$/.test(lhs)) {
    return fail(
      `'y = ...' is an ordinary equation, not a differential equation — write dy/dx = ... for a slope field`,
      pos,
    )
  }
  return fail(
    `The left side has to be the derivative — write 'dy/dx' or "y'", e.g. dy/dx = x - y`,
    pos,
  )
}

// ----------------------------------------------------------------------------
// Right-hand side guards
// ----------------------------------------------------------------------------

/** dy/dx or y' appearing again inside the formula. */
const RHS_DERIV_RE = new RegExp(`d\\s*y\\s*/\\s*d\\s*x|dydx|[A-Za-z]\\s*${PRIME}`)

const VAR_LABEL: Record<string, string> = { t: "'t'", r: "'r'", theta: 'θ' }

/** Where `name` occurs in `src` as a whole token, or -1. */
function locate(src: string, name: string): number {
  const word = /[A-Za-z0-9]/
  const needles = name === 'theta' ? ['theta', 'θ'] : [name]
  for (const needle of needles) {
    let i = src.indexOf(needle)
    while (i >= 0) {
      const before = i === 0 ? '' : src[i - 1]
      const after = src[i + needle.length] ?? ''
      if (!word.test(before) && !word.test(after)) return i
      i = src.indexOf(needle, i + 1)
    }
  }
  return -1
}

/** Re-point "at position N" inside a message produced from a substring. */
function shift(msg: string, by: number): string {
  if (by === 0) return msg
  return msg.replace(/position (\d+)/g, (_m, d: string) => `position ${Number(d) + by}`)
}

// ----------------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------------

export function parseSlopeField(src: string): SlopeFieldOutcome {
  if (!src || src.trim() === '') {
    return fail('Empty differential equation')
  }

  // ---- split on the first '=' or ':' -------------------------------------
  const eq = src.indexOf('=')
  const colon = src.indexOf(':')
  const cut =
    eq < 0 ? colon : colon < 0 ? eq : Math.min(eq, colon)
  if (cut < 0) {
    return fail(
      `A slope field needs an equals sign — ${HINT}, e.g. dy/dx = x - y`,
      firstNonSpace(src),
    )
  }

  // ---- left side ----------------------------------------------------------
  const lhs = src.slice(0, cut)
  if (!LHS_RE.test(lhs)) return lhsError(lhs, 0)

  // ---- right side ---------------------------------------------------------
  const rhsAt = cut + 1
  const rhs = src.slice(rhsAt)
  if (rhs.trim() === '') {
    return fail(`The right side is empty — ${HINT}, e.g. dy/dx = x - y`, rhsAt)
  }

  const second = rhs.indexOf('=')
  if (second >= 0) {
    const at = rhsAt + second
    return fail(`Only one '=' is allowed — unexpected '=' at position ${at}`, at)
  }

  const again = RHS_DERIV_RE.exec(rhs)
  if (again) {
    const at = rhsAt + again.index
    return fail(
      `The right side can't mention the derivative again — dy/dx has to be a formula in x and y`,
      at,
    )
  }

  const compiled = compileExpr(rhs)
  if (!compiled.ok) {
    return fail(
      shift(compiled.error, rhsAt),
      compiled.pos === undefined ? undefined : compiled.pos + rhsAt,
    )
  }
  const { ev, latex, vars, paramNames } = compiled.expr

  for (const v of vars) {
    if (v === 'x' || v === 'y') continue
    const where = locate(rhs, v)
    return fail(
      `A slope field is dy/dx = f(x, y) — ${VAR_LABEL[v] ?? `'${v}'`} isn't available here; use x and y`,
      where < 0 ? rhsAt : rhsAt + where,
    )
  }

  const fullLatex = `\\frac{dy}{dx} = ${latex}`

  return {
    ok: true,
    latex: fullLatex,
    paramNames,
    defaultParams: paramNames.map(() => 1),
    makeField(id: string, params: number[], color: string): SlopeField {
      // One closure, captured once: the renderer's inner loop does a compiled
      // evaluation and an indexed param read, nothing else.
      const p = params
      return {
        id,
        f: (x: number, y: number) => ev(p, x, y),
        latex: fullLatex,
        color,
        visible: true,
      }
    },
  }
}
