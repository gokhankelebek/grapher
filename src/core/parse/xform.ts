// ============================================================================
// src/core/parse/xform.ts — a transformation as a teacher writes it.
//
// Two ways in, one meaning:
//
//   the card's exact text inputs     angle "90", k "1/2", line "y = x" or
//                                    "(0, 0) (1, 2)", centre "(1, 1)" or "C"
//   a typed line                     rotate ABC 90° about (0, 0)
//                                    reflect ABC across y = x
//                                    translate ABC by <3, -2>
//                                    dilate ABC by 1/2 about (1, 1)
//
// Both produce an XformOp (src/core/types.ts) — every parameter kept as the
// text it was typed as, so a reopened document shows "1/2", not 0.5 — and
// resolveOp turns one into a Motion (src/core/transform2d.ts) against the
// board's named points. Nothing here knows about the board itself: the named
// points are handed in.
//
// Pure: imports ./index.ts (the expression engine) and ../transform2d.ts.
// ============================================================================

import type { Vec2, XformOp } from '../types'
import type { Mirror, Motion } from '../transform2d'
import { mirrorFrom } from '../transform2d'
import { compileExpr } from './index'

type Fail = { error: string }

/** A constant expression: "3", "-1/2", "sqrt(2)", "2pi". Null when it is not one. */
export function evalConst(src: string): number | null {
  const s = normalizeMinus(src).trim()
  if (s === '') return null
  if (/^[-+]?(\d+\.?\d*|\.\d+)$/.test(s)) return Number(s)
  const c = compileExpr(s.replace(/√\s*(\d+(?:\.\d+)?)/g, 'sqrt($1)'))
  if (!c.ok || c.expr.vars.length > 0 || c.expr.paramNames.length > 0) return null
  const v = c.expr.ev([], 0, 0)
  return Number.isFinite(v) ? v : null
}

const normalizeMinus = (s: string): string => s.replace(/[−–—]/g, '-')

/** ASCII primes as typed (A', A'') → the prime marks the board writes (A′, A″). */
export function normalizePrimes(s: string): string {
  return s.replace(/'''/g, '‴').replace(/''/g, '″').replace(/'/g, '′').replace(/’/g, '′')
}

/** An angle in degrees: "90", "-45°", "90 cw", "π/2" (radians when π is written). */
export function parseAngle(src: string): { deg: number } | Fail {
  let s = normalizeMinus(src).toLowerCase().trim()
  if (s === '') return { error: 'Type an angle in degrees, e.g. 90' }
  let sign = 1
  const cw = /\b(cw|clockwise)\b/.exec(s)
  const ccw = /\b(ccw|counter[\s-]?clockwise|anti[\s-]?clockwise)\b/.exec(s)
  if (ccw) s = s.replace(ccw[0], '')
  else if (cw) {
    sign = -1
    s = s.replace(cw[0], '')
  }
  s = s.replace(/°|\bdeg(rees?)?\b/g, '').trim()
  // "1.5708 rad" is radians, as on a circle's points
  const radWord = /\s*\brad(ians?)?\s*$/.exec(s)
  if (radWord) s = s.slice(0, radWord.index).trim()
  const radians = !!radWord || /π|\bpi\b/.test(s)
  const v = evalConst(s.replace(/π/g, 'pi'))
  if (v === null) return { error: `“${src.trim()}” is not an angle — type degrees, e.g. 90 or -45` }
  const deg = sign * (radians ? (v * 180) / Math.PI : v)
  if (!Number.isFinite(deg)) return { error: 'That angle is not a finite number' }
  return { deg }
}

/** A scale factor: "2", "1/2", "-3". Zero squashes the figure to a point and is refused. */
export function parseScale(src: string): { k: number } | Fail {
  const s = src.replace(/^\s*k\s*=\s*/i, '')
  const v = evalConst(s)
  if (v === null) return { error: `“${src.trim()}” is not a scale factor — type a number such as 2 or 1/2` }
  if (Math.abs(v) < 1e-12) return { error: 'A scale factor of 0 squashes the figure to a point — use any other number' }
  return { k: v }
}

/** "(1, 2)" or "1, 2" → the point; null when it is not a pair of constants. */
function readPair(src: string): Vec2 | null {
  const s = src.trim().replace(/^\(\s*/, '').replace(/\s*\)$/, '').replace(/^[<⟨]\s*/, '').replace(/\s*[>⟩]$/, '')
  const parts = splitTop(s)
  if (parts.length !== 2) return null
  const x = evalConst(parts[0])
  const y = evalConst(parts[1])
  return x === null || y === null ? null : { x, y }
}

/** Split at the commas that are not inside brackets. */
function splitTop(s: string): string[] {
  const out: string[] = []
  let depth = 0
  let from = 0
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '(' || c === '[') depth++
    else if (c === ')' || c === ']') depth--
    else if (c === ',' && depth === 0) {
      out.push(s.slice(from, i))
      from = i + 1
    }
  }
  out.push(s.slice(from))
  return out
}

/** A point name as the board writes it: a capital and its primes. */
const NAME_RE = /^[A-Za-z][′″‴]*[₀-₉]*$/

/**
 * A centre: blank, "O" or "origin" for (0, 0); "(1, 2)" or "1, 2"; or the name
 * of a point on the board ("C", "A′", "A'").
 */
export function parsePointRef(src: string, named?: ReadonlyMap<string, Vec2>): { p: Vec2 } | Fail {
  // "centre C", "the point (1, 2)", "center of rotation P": the word is not the point
  const s = normalizePrimes(src.trim()).replace(/^(the\s+)?(centre|center|point)(\s+of\s+(rotation|dilation))?\s+(?=\S)/i, '')
  if (s === '' || /^(the\s+)?origin$/i.test(s)) return { p: { x: 0, y: 0 } }
  if (NAME_RE.test(s)) {
    const p = named?.get(s)
    if (p) return { p }
    if (s === 'O' || s === 'o') return { p: { x: 0, y: 0 } }
    return { error: `There is no point named ${s} on the board — type coordinates like (1, 2)` }
  }
  const p = readPair(s)
  if (p) return { p }
  return { error: `“${src.trim()}” is not a point — type (1, 2), O for the origin, or a point’s name` }
}

/** A translation vector from its two components as typed. */
export function parseVector(a: string, b: string): { v: Vec2 } | Fail {
  const x = evalConst(a)
  const y = evalConst(b)
  if (x === null) return { error: `“${a.trim() || ' '}” is not a number — type the horizontal shift, e.g. 3` }
  if (y === null) return { error: `“${b.trim() || ' '}” is not a number — type the vertical shift, e.g. -2` }
  return { v: { x, y } }
}

const LINE_HINT = 'Type a line: x-axis, y-axis, y = x, y = -x, x = 2, y = 2x + 1, two points (0, 0) (1, 2), or two point names AB'

/** Every "( … )" group in a string, outermost. */
function bracketGroups(s: string): string[] {
  const out: string[] = []
  let depth = 0
  let from = -1
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') {
      if (depth === 0) from = i
      depth++
    } else if (s[i] === ')') {
      depth--
      if (depth === 0 && from >= 0) out.push(s.slice(from, i + 1))
    }
  }
  return out
}

/** The line a figure is reflected across, in any of the ways a class writes it. */
export function parseMirrorLine(src: string, named?: ReadonlyMap<string, Vec2>): { line: Mirror } | Fail {
  const raw = normalizePrimes(normalizeMinus(src)).trim()
  if (raw === '') return { error: LINE_HINT }
  const low = raw.toLowerCase().replace(/^(the\s+)?(line\s+)?/, '').replace(/^through\s+/, '').trim()
  if (/^x[\s-]*axis$/.test(low)) return { line: { kind: 'x-axis' } }
  if (/^y[\s-]*axis$/.test(low)) return { line: { kind: 'y-axis' } }

  // two points
  const groups = bracketGroups(low)
  if (groups.length >= 2) {
    const p = readPair(groups[0])
    const q = readPair(groups[1])
    if (!p || !q) return { error: `Those are not two points — ${LINE_HINT}` }
    if (Math.hypot(q.x - p.x, q.y - p.y) < 1e-12) return { error: 'The two points are the same — a line needs two different points' }
    return { line: mirrorFrom(p, { x: q.x - p.x, y: q.y - p.y }) }
  }

  // two named points: "AB", "line AB", "A′B′"
  const nm = /^([A-Z][′″‴]*[₀-₉]*)([A-Z][′″‴]*[₀-₉]*)$/.exec(raw.replace(/^(the\s+)?(line\s+)?/i, '').trim())
  if (nm) {
    const p = named?.get(nm[1])
    const q = named?.get(nm[2])
    if (!p || !q) return { error: `There is no point named ${!p ? nm[1] : nm[2]} on the board — ${LINE_HINT}` }
    if (Math.hypot(q.x - p.x, q.y - p.y) < 1e-12) return { error: `${nm[1]} and ${nm[2]} are the same point` }
    return { line: mirrorFrom(p, { x: q.x - p.x, y: q.y - p.y }) }
  }

  // an equation in x and y
  const eq = low.indexOf('=')
  if (eq < 0) return { error: LINE_HINT }
  const lhs = low.slice(0, eq).trim()
  const rhs = low.slice(eq + 1).trim()
  if (lhs !== 'x' && lhs !== 'y') return { error: `Write the line with y or x on its own on the left — ${LINE_HINT}` }
  const c = compileExpr(rhs)
  if (!c.ok) return { error: `“${rhs}” — ${c.error}` }
  const other = lhs === 'y' ? 'x' : 'y'
  if (c.expr.paramNames.length > 0 || c.expr.vars.some((v) => v !== other)) {
    return { error: `The right side may only use ${other} — ${LINE_HINT}` }
  }
  const f = (t: number): number => (other === 'x' ? c.expr.ev([], t, 0) : c.expr.ev([], 0, t))
  const f0 = f(0)
  const f1 = f(1)
  const f2 = f(2)
  const f7 = f(7)
  if (![f0, f1, f2, f7].every(Number.isFinite)) return { error: 'That line is not defined everywhere' }
  const m = f1 - f0
  const lin = (t: number): number => f0 + m * t
  if (Math.abs(f2 - lin(2)) > 1e-9 * Math.max(1, Math.abs(f2)) || Math.abs(f7 - lin(7)) > 1e-9 * Math.max(1, Math.abs(f7))) {
    return { error: 'That is a curve, not a line — a figure is reflected across a straight line' }
  }
  if (lhs === 'y') return { line: mirrorFrom({ x: 0, y: f0 }, { x: 1, y: m }) }
  // x = m·y + b: through (b, 0), direction (m, 1)
  return { line: mirrorFrom({ x: f0, y: 0 }, { x: m, y: 1 }) }
}

/** An op as a Motion, against the named points on the board. */
export function resolveOp(op: XformOp, named?: ReadonlyMap<string, Vec2>): { motion: Motion } | Fail {
  switch (op.t) {
    case 'translate': {
      const r = parseVector(op.by[0], op.by[1])
      return 'error' in r ? r : { motion: { kind: 'translate', v: r.v } }
    }
    case 'reflect': {
      const r = parseMirrorLine(op.line, named)
      return 'error' in r ? r : { motion: { kind: 'reflect', line: r.line } }
    }
    case 'rotate': {
      const a = parseAngle(op.angle)
      if ('error' in a) return a
      const c = parsePointRef(op.about, named)
      if ('error' in c) return c
      return { motion: { kind: 'rotate', deg: a.deg, center: c.p } }
    }
    case 'dilate': {
      const k = parseScale(op.k)
      if ('error' in k) return k
      const c = parsePointRef(op.about, named)
      if ('error' in c) return c
      return { motion: { kind: 'dilate', k: k.k, center: c.p } }
    }
  }
}

/** A fresh op of a kind, with the numbers a lesson starts from. */
export function defaultOp(t: XformOp['t']): XformOp {
  switch (t) {
    case 'translate':
      return { t, by: ['3', '-2'] }
    case 'reflect':
      return { t, line: 'y-axis' }
    case 'rotate':
      return { t, angle: '90', about: '(0, 0)' }
    case 'dilate':
      return { t, k: '2', about: '(0, 0)' }
  }
}

const VERBS: Record<XformOp['t'], string> = { translate: 'translate', reflect: 'reflect', rotate: 'rotate', dilate: 'dilate' }

/** An angle as typed, with a degree sign when it is a bare number. */
const degText = (s: string): string => (/^\s*[-+−]?\d+(\.\d+)?\s*$/.test(s) ? `${s.trim()}°` : s.trim())
const aboutText = (s: string): string => (s.trim() === '' ? '(0, 0)' : s.trim())

/** The typed line an op reads as: "rotate ABC 90° about (0, 0)". */
export function opCommand(op: XformOp, target: string): string {
  switch (op.t) {
    case 'translate':
      return `translate ${target} by <${op.by[0].trim()}, ${op.by[1].trim()}>`
    case 'reflect':
      return `reflect ${target} across ${op.line.trim()}`
    case 'rotate':
      return `rotate ${target} ${degText(op.angle)} about ${aboutText(op.about)}`
    case 'dilate':
      return `dilate ${target} by ${op.k.trim()} about ${aboutText(op.about)}`
  }
}

const COMMAND_RE = /^\s*(?:[A-Za-z′″‴']+\s*=\s*)?(translate|reflect|rotate|dilate)\b/i

/** Does this line start like a transformation of a figure? */
export function looksLikeXformCommand(src: string): boolean {
  return typeof src === 'string' && COMMAND_RE.test(src)
}

export interface XformCommand {
  /** The pre-image's name as typed, primes normalised: "ABC", "A′B′C′", "P". */
  target: string
  op: XformOp
}

const EXAMPLES: Record<XformOp['t'], string> = {
  translate: 'translate ABC by <3, -2>',
  reflect: 'reflect ABC across y = x',
  rotate: 'rotate ABC 90° about (0, 0)',
  dilate: 'dilate ABC by 1/2 about (1, 1)',
}

/**
 * "rotate ABC 90° about (0, 0)" → { target: 'ABC', op }. The parameters are
 * only split out here, not checked: resolveOp checks them against the board.
 */
export function parseXformCommand(src: string): XformCommand | Fail {
  const m = COMMAND_RE.exec(src)
  if (!m) return { error: 'Start with translate, reflect, rotate or dilate' }
  const t = m[1].toLowerCase() as XformOp['t']
  let rest = normalizePrimes(src.slice(m[0].length)).trim()
  const tm = /^([A-Za-z][′″‴]*[₀-₉]*(?:[A-Za-z][′″‴]*[₀-₉]*)*)(?![A-Za-z(])/.exec(rest)
  if (!tm) return { error: `Name the figure to ${VERBS[t]}, e.g. ${EXAMPLES[t]}` }
  const target = tm[1]
  rest = rest.slice(tm[0].length).trim()
  const fail = (what: string): Fail => ({ error: `${what} — e.g. ${EXAMPLES[t]}` })
  switch (t) {
    case 'translate': {
      rest = rest.replace(/^(by|along|with)\s+/i, '').replace(/^(the\s+)?vector\s+/i, '').trim()
      const inner = rest.replace(/^[<⟨(]\s*/, '').replace(/\s*[>⟩)]$/, '')
      const parts = splitTop(inner)
      if (rest === '' || parts.length !== 2) return fail('Say how far to translate it')
      return { target, op: { t, by: [parts[0].trim(), parts[1].trim()] } }
    }
    case 'reflect': {
      rest = rest.replace(/^(across|over|in|about|through)\s+/i, '').trim()
      if (rest === '') return fail('Say which line to reflect it across')
      return { target, op: { t, line: rest } }
    }
    case 'rotate': {
      rest = rest.replace(/^by\s+/i, '')
      const at = /\s*\b(about|around|centered at|centred at|center|centre|with center|with centre)\b\s*/i.exec(rest)
      const angle = (at ? rest.slice(0, at.index) : rest).trim()
      const about = at ? rest.slice(at.index + at[0].length).trim() : '(0, 0)'
      if (angle === '') return fail('Say the angle to rotate it by')
      return { target, op: { t, angle: angle.replace(/°/g, '').trim(), about } }
    }
    case 'dilate': {
      rest = rest.replace(/^(by|with)\s+/i, '').replace(/^(a\s+)?scale\s+factor\s+(of\s+)?/i, '').replace(/^k\s*=\s*/i, '')
      const at = /\s*\b(about|around|from|centered at|centred at|center|centre|with center|with centre)\b\s*/i.exec(rest)
      const k = (at ? rest.slice(0, at.index) : rest).trim()
      const about = at ? rest.slice(at.index + at[0].length).trim() : '(0, 0)'
      if (k === '') return fail('Say the scale factor')
      return { target, op: { t, k, about } }
    }
  }
}
