// ============================================================================
// src/ui/volumeLinks.ts — the volume link: a solid built on the region
// between f and g (or f and the x-axis) over [a, b], cut into disks/washers,
// shells, or known cross-sections (AP Calculus Unit 8).
//
// src/core/volume.ts owns the numbers. This module owns what a teacher SEES:
//
//   the card    the written integral with R(x), r(x), h(x) or s(x) spelled
//               out from the typed lines —   π∫₀¹ (x² − (x²)²) dx
//               V exactly when it is exact (8π, 2π/15, 2√3) and in decimals,
//               the axis-through-the-region warning, and — for the two
//               pairings that slice in dy — either the dy integral (x as a
//               function of y on each side, from the typed line's inverse) or
//               the plain statement of what it needs: "use shells for this
//               axis", with a button that switches.
//   the board   a 2-D teaching view, NOT a 3-D engine: the region shaded, the
//               axis dashed and named, the region's mirror across the axis as
//               a faint ghost (the solid's silhouette), and at the slice the
//               representative rectangle, its reflection, the disk or washer
//               seen edge-on as an ellipse (horizontal semi-axis R/4), R and r
//               as labelled segments; for shells the strip, its mirror, the
//               radius "r = x" and the height "h" with the shell's rims; for
//               cross-sections the base s and the section standing on it in
//               oblique projection, with a few fainter slices to suggest the
//               solid.
//
// Everything is recomputed from the link { otherId?, a, b, method, axis?,
// section?, ratio?, x? } on every change; nothing computed is stored. One
// analysis per (curves, link without its slice) is cached, so a slice drag
// re-draws without re-integrating.
//
// Pure: no React, no DOM, no canvas.
// ============================================================================

import type { FittedCurve, ModelSpec, Vec2 } from '../core/types'
import type { Overlay } from '../render/overlays'
import type { VolumeLink } from '../core/persist'
import { areaBetween, areaUnder, curveIntersections } from '../core/calculus'
import { mvtSourceOf } from '../core/mvt'
import { exactForm } from '../core/exact'
import { parseAst, parseExpression } from '../core/parse'
import type { ExprNode } from '../core/parse'
import { invertFormula, printSource, printText } from '../core/inverse'
import {
  X_AXIS,
  botOf,
  crossings,
  exactVolume,
  horizontalBands,
  horizontalAxisThrough,
  sectionFactor,
  sectionVolume,
  shellVolume,
  shellVolumeDy,
  sideX,
  signChanges,
  topOf,
  verticalAxisThrough,
  washerVolume,
  washerVolumeDy,
} from '../core/volume'
import type {
  Band,
  ExactVolume,
  Fn,
  Region,
  SectionShape,
  SideRef,
  VolumeAxis,
  VolumeMethod,
  VolumeResult,
} from '../core/volume'
import { decimal, numText } from './secantLinks'
import { defaultBetweenBounds } from './calcLinks'
import type { CalcChange } from './calcLinks'

export type { VolumeLink }

// ---------------------------------------------------------------------------
// Look
// ---------------------------------------------------------------------------

/** The region's wash, and the ghost of its mirror image across the axis. */
export const VOLUME_REGION_ALPHA = 0.22
export const MIRROR_FILL_ALPHA = 0.07
export const MIRROR_LINE_ALPHA = 0.5
/** The representative slice and its reflection. */
export const SLICE_FILL_ALPHA = 0.42
export const SLICE_MIRROR_ALPHA = 0.2
/** The disk / washer face and a cross-section standing on its base. */
export const FACE_FILL_ALPHA = 0.16
/** The fainter slices that suggest a cross-section solid. */
export const GHOST_SLICE_ALPHA = 0.32
/** The oblique projection: a unit out of the page is drawn this long, at this angle. */
export const OBLIQUE_SCALE = 0.55
export const OBLIQUE_ANGLE = (35 * Math.PI) / 180
/** An edge-on disk is an ellipse this much narrower than it is tall. */
export const EDGE_ON = 0.25
/** How many faint slices a cross-section solid gets besides the representative one. */
const GHOST_SLICES = 5

// ---------------------------------------------------------------------------
// Numbers, the way a teacher writes them
// ---------------------------------------------------------------------------

const MINUS = '−'

function numTex(v: number): string {
  if (!Number.isFinite(v)) return '\\text{—}'
  if (v === 0) return '0'
  const ex = exactForm(v)
  if (ex) return ex.tex
  return decimal(v).replace(MINUS, '-')
}

/** What a typed field is prefilled with, and the parser reads back. */
export function editableNum(v: number): string {
  return numText(v).replace(/−/g, '-').replace(/π/g, 'pi').replace(/√(\d+)/g, 'sqrt($1)')
}

// ---------------------------------------------------------------------------
// Terms — just enough algebra to write R(x) = 2 − x² and (x²)²
// ---------------------------------------------------------------------------

/** A piece of a written formula, in Unicode and in LaTeX. */
export interface Term {
  text: string
  tex: string
  /** 1: a sum or a leading minus; 2: a product or quotient; 3: an atom, power or call. */
  prec: 1 | 2 | 3
  /** Squares without brackets: x², f(x)², 2². */
  bare: boolean
  zero?: boolean
  /** Set on a plain number, so 2 − 1 is written 1. */
  value?: number
}

const ZERO: Term = { text: '0', tex: '0', prec: 3, bare: true, zero: true, value: 0 }

/** A number as a term: 2, 1/2, −1, π/2. */
export function constTerm(v: number): Term {
  if (v === 0) return ZERO
  const text = numText(v)
  const tex = numTex(v)
  const prec: 1 | 2 | 3 = v < 0 ? 1 : /[/]/.test(text) ? 2 : 3
  return { text, tex, prec, bare: prec === 3 && /^[0-9.]+$/.test(text), value: v }
}

/** A curve known only by its letter: f(x), g(y). */
function letterTerm(name: string, v: 'x' | 'y'): Term {
  return { text: `${name}(${v})`, tex: `${name}(${v})`, prec: 3, bare: true }
}

function nodePrec(n: ExprNode): { prec: 1 | 2 | 3; bare: boolean } {
  switch (n.t) {
    case 'bin':
      return n.op === '+' || n.op === '-' ? { prec: 1, bare: false } : n.op === '^' ? { prec: 3, bare: false } : { prec: 2, bare: false }
    case 'neg':
      return { prec: 1, bare: false }
    case 'num':
      return n.v < 0 ? { prec: 1, bare: false } : { prec: 3, bare: true }
    case 'var':
    case 'const':
    case 'param':
      return { prec: 3, bare: true }
    default:
      return { prec: 3, bare: false }
  }
}

/** x → y throughout a formula (the inverse, read as a function of y). */
function swapXY(n: ExprNode): ExprNode {
  switch (n.t) {
    case 'var':
      return n.name === 'x' ? { ...n, name: 'y' as typeof n.name } : n
    case 'neg':
      return { ...n, a: swapXY(n.a) }
    case 'bin':
      return { ...n, a: swapXY(n.a), b: swapXY(n.b) }
    case 'call':
      return { ...n, args: n.args.map(swapXY) }
    default:
      return n
  }
}

/** LaTeX for a formula in x, through the parser's own printer; x → y when asked. */
function texOf(n: ExprNode, v: 'x' | 'y'): string {
  const src = printSource(n)
  let tex = src
  try {
    const out = parseExpression(`y = ${src}`)
    if (out.ok) tex = out.plot.latex.replace(/^\s*y\s*=\s*/, '')
  } catch {
    tex = src
  }
  return v === 'y' ? tex.replace(/\\[a-zA-Z]+|x/g, (m) => (m === 'x' ? 'y' : m)) : tex
}

/** A formula as a term, in x (or, swapped, in y). */
function nodeTerm(n: ExprNode, v: 'x' | 'y'): Term {
  const p = nodePrec(n)
  const inV = v === 'y' ? swapXY(n) : n
  return { text: printText(inV), tex: texOf(n, v), prec: p.prec, bare: p.bare }
}

/** The body of a typed line — "y = …", "f(x) = …", or a bare expression — or null. */
export function bodyOf(src: string): ExprNode | null {
  let a: ReturnType<typeof parseAst>
  try {
    a = parseAst(src)
  } catch {
    return null
  }
  if (!a.ok) return null
  const { lhs, rhs } = a
  if (rhs === null) return lhs
  if (lhs.t === 'var' && lhs.name === 'y') return rhs
  if (lhs.t === 'bin' && lhs.op === '*' && lhs.a.t === 'param' && lhs.b.t === 'var' && lhs.b.name === 'x') return rhs
  return null
}

const wrapT = (t: Term): string => (t.prec <= 1 ? `(${t.text})` : t.text)
const wrapX = (t: Term): string => (t.prec <= 1 ? `\\left(${t.tex}\\right)` : t.tex)

export function sub(A: Term, B: Term): Term {
  if (A.value !== undefined && B.value !== undefined) return constTerm(A.value - B.value)
  if (B.zero) return A
  if (A.zero) return neg(B)
  return { text: `${A.text} ${MINUS} ${wrapT(B)}`, tex: `${A.tex} - ${wrapX(B)}`, prec: 1, bare: false }
}

function neg(B: Term): Term {
  if (B.zero) return B
  return { text: `${MINUS}${wrapT(B)}`, tex: `-${wrapX(B)}`, prec: 1, bare: false }
}

export function sq(A: Term): Term {
  if (A.bare) return { text: `${A.text}²`, tex: `${A.tex}^{2}`, prec: 3, bare: false }
  return { text: `(${A.text})²`, tex: `\\left(${A.tex}\\right)^{2}`, prec: 3, bare: false }
}

function mul(A: Term, B: Term): Term {
  const pa = A.prec <= 1
  const pb = B.prec <= 1
  const text = pa || pb ? `${wrapT(A)}${wrapT(B)}` : `${A.text}·${B.text}`
  const tex = pa || pb ? `${wrapX(A)}${wrapX(B)}` : `${A.tex}\\cdot ${B.tex}`
  return { text, tex, prec: 2, bare: false }
}

/** "x − k" as a term, with k = 0 as just x. */
const minusConst = (A: Term, k: number): Term => (k === 0 ? A : k < 0 ? plusConst(A, -k) : sub(A, constTerm(k)))
const plusConst = (A: Term, k: number): Term =>
  A.value !== undefined
    ? constTerm(A.value + k)
    : {
        text: `${A.text} + ${constTerm(k).text}`,
        tex: `${A.tex} + ${constTerm(k).tex}`,
        prec: 1,
        bare: false,
      }
/** "k − A". */
const constMinus = (k: number, A: Term): Term => sub(constTerm(k), A)

// ---------------------------------------------------------------------------
// The analysis, cached
// ---------------------------------------------------------------------------

/** Which cut: washers in dx about y = k, shells in dx about x = k, the two dy pairings, sections. */
export type VolumeMode = 'washer-h' | 'washer-v' | 'shell-v' | 'shell-h' | 'section'

export function modeOf(link: Pick<VolumeLink, 'method' | 'axis'>): VolumeMode {
  if (link.method === 'section') return 'section'
  const dir = (link.axis ?? X_AXIS).dir
  if (link.method === 'shell') return dir === 'v' ? 'shell-v' : 'shell-h'
  return dir === 'h' ? 'washer-h' : 'washer-v'
}

/** True for the two pairings that slice in dy. */
export const slicesInY = (mode: VolumeMode): boolean => mode === 'washer-v' || mode === 'shell-h'

export interface VolumeAnalysis {
  region: Region | null
  lo: number
  hi: number
  problem: string | null
  /** The number — always from the dx computation of the same solid. */
  result: VolumeResult | null
  exact: ExactVolume | null
  /** The sideways description, for the dy pairings (null: not one strip at every height). */
  bands: Band[] | null
  /** The dy integral, measured on its own; `dyOk` when it agrees with `result`. */
  dy: VolumeResult | null
  dyOk: boolean
  /** The axis runs through the inside of the region. */
  through: boolean
}

const SERIALS = new WeakMap<object, number>()
let serialNext = 1
const serialOf = (o: object | undefined): number => {
  if (!o) return 0
  let n = SERIALS.get(o)
  if (n === undefined) {
    n = serialNext++
    SERIALS.set(o, n)
  }
  return n
}

const CACHE = new Map<string, VolumeAnalysis>()
const CACHE_MAX = 48

const curveKey = (c: FittedCurve | undefined, models: Record<string, ModelSpec>): string =>
  c ? [c.modelId, serialOf(models[c.modelId]), c.params.join(','), c.domain ? c.domain.join(',') : ''].join(':') : '-'

/** The region's two boundary functions and every reason there is no region. */
function regionOf(
  link: VolumeLink,
  parent: FittedCurve,
  other: FittedCurve | undefined,
  models: Record<string, ModelSpec>,
  fName: string,
  gName: string,
): { region: Region } | { problem: string } {
  const F = mvtSourceOf(parent, models)
  if (!F) return { problem: `${fName} is not a function of x` }
  if (link.otherId !== undefined && !other) return { problem: 'the second curve is gone' }
  const G = other ? mvtSourceOf(other, models) : null
  if (other && !G) return { problem: `${gName} is not a function of x` }
  if (!Number.isFinite(link.a) || !Number.isFinite(link.b)) return { problem: 'a and b must be numbers' }
  if (link.a === link.b) return { problem: 'a and b are the same point, so there is no region' }
  const lo = Math.min(link.a, link.b)
  const hi = Math.max(link.a, link.b)
  for (const [src, name] of [
    [F, fName],
    [G, gName],
  ] as const) {
    if (!src || !src.domain) continue
    const [dlo, dhi] = src.domain
    const tol = 1e-9 * Math.max(1, Math.abs(dlo), Math.abs(dhi))
    if (lo < dlo - tol || hi > dhi + tol) {
      return {
        problem: `[${numText(lo)}, ${numText(hi)}] runs outside the domain of ${name} [${numText(dlo)}, ${numText(dhi)}]`,
      }
    }
  }
  const f: Fn = (x) => F.f(x)
  const g: Fn = G ? (x) => G.f(x) : () => 0
  // A gap anywhere is a region with a piece missing; a pole is no region.
  for (let i = 0; i <= 400; i++) {
    const x = lo + ((hi - lo) * i) / 400
    if (!Number.isFinite(f(x))) return { problem: `${fName} is undefined at x = ${numText(round6(x))}, inside [${numText(lo)}, ${numText(hi)}]` }
    if (!Number.isFinite(g(x))) return { problem: `${gName} is undefined at x = ${numText(round6(x))}, inside [${numText(lo)}, ${numText(hi)}]` }
  }
  let ok = true
  try {
    ok = (other ? areaBetween(parent, other, models, lo, hi, true) : areaUnder(parent, models, lo, hi)) !== null
  } catch {
    ok = false
  }
  if (!ok) return { problem: `the region is unbounded on [${numText(lo)}, ${numText(hi)}] (a vertical asymptote)` }
  return { region: { f, g, a: lo, b: hi } }
}

/** Everything numeric about one link, for these curves as they are now. */
export function analyzeVolume(
  link: VolumeLink,
  parent: FittedCurve | undefined,
  other: FittedCurve | undefined,
  models: Record<string, ModelSpec>,
): VolumeAnalysis {
  // The curves' letters are written into a problem as {f} and {g} and filled
  // in by the card, so a renamed curve does not cost a re-integration.
  const fName = '{f}'
  const gName = '{g}'
  const axis = link.axis ?? X_AXIS
  const mode = modeOf(link)
  const key = [
    curveKey(parent, models),
    link.otherId === undefined ? '' : curveKey(other, models),
    link.a,
    link.b,
    mode,
    axis.at,
    link.section ?? 'square',
    link.ratio ?? 1,
  ].join('|')
  const hit = CACHE.get(key)
  if (hit) {
    CACHE.delete(key)
    CACHE.set(key, hit)
    return hit
  }
  const lo = Math.min(link.a, link.b)
  const hi = Math.max(link.a, link.b)
  const out: VolumeAnalysis = {
    region: null,
    lo,
    hi,
    problem: null,
    result: null,
    exact: null,
    bands: null,
    dy: null,
    dyOk: false,
    through: false,
  }
  if (!parent) {
    out.problem = 'the curve it was built on is gone'
    return out
  }
  let reg: ReturnType<typeof regionOf>
  try {
    reg = regionOf(link, parent, other, models, fName, gName)
  } catch {
    reg = { problem: 'this region could not be measured' }
  }
  if ('problem' in reg) {
    out.problem = reg.problem
    return remember(key, out)
  }
  const r = reg.region
  out.region = r
  try {
    if (mode === 'section') {
      out.result = sectionVolume(r, link.section ?? 'square', link.ratio ?? 1)
    } else if (axis.dir === 'h') {
      out.result = washerVolume(r, axis.at)
    } else {
      out.result = shellVolume(r, axis.at)
    }
  } catch {
    out.result = null
  }
  if (!out.result) {
    out.problem = 'the integral could not be measured on this region'
    return remember(key, out)
  }
  out.through = out.result.through
  out.exact = exactVolume(out.result.value, out.result.err)
  if (slicesInY(mode)) {
    try {
      out.bands = horizontalBands(r)
    } catch {
      out.bands = null
    }
    if (out.bands) {
      try {
        out.dy =
          mode === 'washer-v'
            ? washerVolumeDy(r, out.bands, axis.at)
            : horizontalAxisThrough(r, axis.at)
              ? null
              : shellVolumeDy(r, out.bands, axis.at)
      } catch {
        out.dy = null
      }
      const v = out.result.value
      out.dyOk = out.dy !== null && Math.abs(out.dy.value - v) <= 1e-7 * Math.max(1, Math.abs(v))
    }
  }
  return remember(key, out)
}

function remember(key: string, a: VolumeAnalysis): VolumeAnalysis {
  CACHE.set(key, a)
  while (CACHE.size > CACHE_MAX) {
    const oldest = CACHE.keys().next().value
    if (oldest === undefined) break
    CACHE.delete(oldest)
  }
  return a
}

const round6 = (v: number): number => Math.round(v * 1e6) / 1e6

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------

/** A curve the region may run to, for the card's picker. */
export interface RegionChoice {
  id: string
  label: string
}

/** One volume, as its PARENT's card shows it. */
export interface VolumeRow {
  linkId: string
  a: number
  b: number
  aText: string
  bText: string
  method: VolumeMethod
  mode: VolumeMode
  axis: VolumeAxis
  /** "the x-axis", "y = 2", "the y-axis", "x = −1" */
  axisText: string
  section: SectionShape
  ratio: number
  /** The second curve, or null for the x-axis; and every curve it could be. */
  otherId: string | null
  others: RegionChoice[]
  /** "Disks about the x-axis", "Shells about the y-axis", "Square cross-sections" */
  head: string
  /** "between f and g on [0, 1]" */
  regionText: string
  /** The parent's letter. */
  fName: string
  /** A k just clear of the region, for a fresh "y = k" (h) or "x = k" (v). */
  suggestK: { h: number; v: number }
  /** The written integral, or null (a problem, or a dy integral that cannot be written). */
  integral: { text: string; tex: string } | null
  /** "R(x) = x (outer), r(x) = x² (inner)", "s(x) = √x" … */
  parts: string[]
  /** "V = 8π ≈ 25.133", "V ≈ 12.566" */
  value: string | null
  valueTex: string | null
  /** The axis runs through the region (said, not refused). */
  warning: string | null
  /** What a dy pairing needs and does not have, with the method that works instead. */
  need: { text: string; switchTo: VolumeMethod } | null
  problem: string | null
  /** The representative slice: its coordinate, which variable, and its range. */
  slice: number | null
  sliceVar: 'x' | 'y'
  sliceLo: number
  sliceHi: number
}

export const SECTION_LABELS: Record<SectionShape, string> = {
  square: 'Squares',
  semicircle: 'Semicircles',
  equilateral: 'Equilateral triangles',
  isoRightLeg: 'Isosceles right triangles (leg on base)',
  isoRightHyp: 'Isosceles right triangles (hypotenuse on base)',
  rectangle: 'Rectangles (height = k·base)',
}

/** "the x-axis", "y = 2", "the y-axis", "x = −1". */
export function axisText(axis: VolumeAxis): string {
  if (axis.at === 0) return axis.dir === 'h' ? 'the x-axis' : 'the y-axis'
  return `${axis.dir === 'h' ? 'y' : 'x'} = ${numText(axis.at)}`
}

/** A(s) = factor·s², the factor written: null for 1 (squares). */
function factorTerm(shape: SectionShape, ratio: number): { text: string; tex: string } | null {
  switch (shape) {
    case 'square':
      return null
    case 'semicircle':
      return { text: '(π/8)', tex: '\\frac{\\pi}{8}' }
    case 'equilateral':
      return { text: '(√3/4)', tex: '\\frac{\\sqrt{3}}{4}' }
    case 'isoRightLeg':
      return { text: '(1/2)', tex: '\\frac{1}{2}' }
    case 'isoRightHyp':
      return { text: '(1/4)', tex: '\\frac{1}{4}' }
    case 'rectangle': {
      if (ratio === 1) return null
      const t = constTerm(ratio)
      return { text: t.prec === 3 ? t.text : `(${t.text})`, tex: t.tex }
    }
  }
}

/** "A = s²", "A = (π/8)s²" … — the area of one cross-section on a base s. */
function areaFormula(shape: SectionShape, ratio: number): string {
  const f = factorTerm(shape, ratio)
  return `A(s) = ${f ? f.text : ''}s²`
}

const boundText = (v: number): string => {
  const t = numText(v)
  return /^[0-9.]+$/.test(t) ? t : `(${t})`
}

interface Written {
  lo: number
  hi: number
  body: Term
}

/** "π∫_0^1 (x² − (x²)²) dx", pieces joined with +, and its LaTeX. */
function writeIntegral(
  coef: { text: string; tex: string } | null,
  pieces: readonly Written[],
  v: 'x' | 'y',
): { text: string; tex: string } {
  const texts: string[] = []
  const texes: string[] = []
  for (const p of pieces) {
    const inner = p.body.prec <= 1 ? `(${p.body.text})` : p.body.text
    const innerTex = p.body.prec <= 1 ? `\\left(${p.body.tex}\\right)` : p.body.tex
    texts.push(`${coef ? coef.text : ''}∫_${boundText(p.lo)}^${boundText(p.hi)} ${inner} d${v}`)
    texes.push(`${coef ? coef.tex : ''}\\int_{${numTex(p.lo)}}^{${numTex(p.hi)}} ${innerTex}\\,d${v}`)
  }
  return { text: texts.join(' + '), tex: texes.join(' + ') }
}

/** Adjacent pieces that write the same integrand are one integral. */
function merged(pieces: Written[]): Written[] {
  const out: Written[] = []
  for (const p of pieces) {
    const prev = out[out.length - 1]
    if (prev && prev.body.text === p.body.text && prev.hi === p.lo) prev.hi = p.hi
    else out.push({ ...p })
  }
  return out
}

/** The pieces of [lo, hi] between the given interior cuts. */
function spans(lo: number, hi: number, cuts: readonly number[]): [number, number][] {
  const tol = 1e-9 * Math.max(1, Math.abs(lo), Math.abs(hi))
  const pts = [lo, ...cuts.filter((c) => c > lo + tol && c < hi - tol).sort((p, q) => p - q), hi]
  const out: [number, number][] = []
  for (let i = 0; i + 1 < pts.length; i++) if (pts[i + 1] > pts[i]) out.push([pts[i], pts[i + 1]])
  return out
}

/** Written bounds: exact where exact, otherwise rounded the way the card rounds. */
const tidy = (v: number): number => {
  const ex = exactForm(v)
  return ex ? ex.value : round6(v)
}

/**
 * What the card says about one volume.
 *
 * `sources` holds the typed lines (curve id → "y = sqrt(x)") of the curves
 * whose formulas may be written into the integral; a curve without one is
 * written by its letter, f(x).
 */
export function volumeRow(
  link: VolumeLink,
  parent: FittedCurve | undefined,
  other: FittedCurve | undefined,
  models: Record<string, ModelSpec>,
  opts: {
    fName?: string
    gName?: string
    sources?: Readonly<Record<string, string>>
    others?: RegionChoice[]
  } = {},
): VolumeRow {
  const fName = opts.fName ?? 'f'
  const gName = opts.gName ?? 'g'
  const axis = link.axis ?? X_AXIS
  const mode = modeOf(link)
  const lo = Math.min(link.a, link.b)
  const hi = Math.max(link.a, link.b)
  const section = link.section ?? 'square'
  const ratio = link.ratio ?? 1
  const between = link.otherId !== undefined
  const regionText = `between ${fName} and ${between ? (other ? gName : 'a curve that is gone') : 'the x-axis'} on [${numText(lo)}, ${numText(hi)}]`
  const row: VolumeRow = {
    linkId: link.id,
    a: link.a,
    b: link.b,
    aText: numText(link.a),
    bText: numText(link.b),
    method: link.method,
    mode,
    axis,
    axisText: axisText(axis),
    section,
    ratio,
    otherId: link.otherId ?? null,
    others: opts.others ?? [],
    head: '',
    regionText,
    fName,
    suggestK: { h: 2, v: -1 },
    integral: null,
    parts: [],
    value: null,
    valueTex: null,
    warning: null,
    need: null,
    problem: null,
    slice: null,
    sliceVar: slicesInY(mode) ? 'y' : 'x',
    sliceLo: lo,
    sliceHi: hi,
  }
  const an = analyzeVolume(link, parent, other, models)
  row.head = headOf(mode, section, axis, an)
  if (an.problem || !an.region || !an.result) {
    row.problem = (an.problem ?? 'this volume could not be measured').replace(/\{f\}/g, fName).replace(/\{g\}/g, gName)
    return row
  }
  const r = an.region
  const V = an.result.value
  {
    const [, yhi] = yRange(r)
    row.suggestK = {
      h: Math.floor(yhi + 1e-9) + 1,
      v: Math.ceil(lo - 1e-9) - 1,
    }
  }
  // "V = 8π ≈ 25.133"; "V = 8" when the closed form IS the decimal.
  const dec = decimal(V)
  const same = an.exact !== null && an.exact.text === dec
  row.value = an.exact ? (same ? `V = ${dec}` : `V = ${an.exact.text} ≈ ${dec}`) : `V ≈ ${dec}`
  row.valueTex = an.exact
    ? same
      ? `V = ${an.exact.tex}`
      : `V = ${an.exact.tex} \\approx ${dec}`
    : `V \\approx ${dec}`

  // The slice's range and place.
  if (slicesInY(mode)) {
    const ys = yRange(r)
    row.sliceLo = ys[0]
    row.sliceHi = ys[1]
  }
  const mid = (row.sliceLo + row.sliceHi) / 2
  row.slice = link.x !== undefined && Number.isFinite(link.x) ? clampTo(link.x, row.sliceLo, row.sliceHi) : mid

  // The curves as written: their typed formula, or their letter.
  const src = opts.sources ?? {}
  const fBody = parent ? bodyOf(src[parent.id] ?? '') : null
  const gBody = other ? bodyOf(src[other.id] ?? '') : null
  const F: Term = fBody ? nodeTerm(fBody, 'x') : letterTerm(fName, 'x')
  const G: Term = between ? (gBody ? nodeTerm(gBody, 'x') : letterTerm(gName, 'x')) : ZERO
  const termOf = (which: 'f' | 'g'): Term => (which === 'f' ? F : G)
  // Which curve is on top over (p, q), read at the middle.
  const topAt = (x: number): 'f' | 'g' => (r.f(x) >= r.g(x) ? 'f' : 'g')
  const other_ = (w: 'f' | 'g'): 'f' | 'g' => (w === 'f' ? 'g' : 'f')
  const k = axis.at

  if (an.through) {
    row.warning =
      mode === 'washer-h' || mode === 'washer-v'
        ? `The axis passes through the region. The solid is what the region sweeps: the part on the near side of ${row.axisText} is inside the solid swept by the far side, so R is the larger of the two distances and r = 0 where the axis cuts the region.`
        : `The axis passes through the region. The solid is the region folded across ${row.axisText} and revolved — the textbook shell integral would count the overlap twice, so V is measured on the folded region.`
  }

  switch (mode) {
    case 'washer-h': {
      const cuts = [
        ...crossings(r),
        ...signChanges((x) => r.f(x) - k, lo, hi),
        ...signChanges((x) => r.g(x) - k, lo, hi),
        ...signChanges((x) => r.f(x) + r.g(x) - 2 * k, lo, hi),
      ].map(tidy)
      const pieces: Written[] = []
      let disks = true
      const outerSet = new Set<string>()
      const innerSet = new Set<string>()
      for (const [p, q] of spans(lo, hi, cuts)) {
        const m = (p + q) / 2
        const tw = topAt(m)
        const bw = other_(tw)
        const t = Math.max(r.f(m), r.g(m)) - k
        const u = Math.min(r.f(m), r.g(m)) - k
        let R: Term
        let rr: Term
        if (u >= 0) {
          R = minusConst(termOf(tw), k)
          rr = minusConst(termOf(bw), k)
        } else if (t <= 0) {
          R = constMinus(k, termOf(bw))
          rr = constMinus(k, termOf(tw))
        } else {
          R = t >= -u ? minusConst(termOf(tw), k) : constMinus(k, termOf(bw))
          rr = ZERO
        }
        if (!rr.zero) disks = false
        outerSet.add(R.text)
        if (!rr.zero) innerSet.add(rr.text)
        pieces.push({ lo: p, hi: q, body: rr.zero ? sq(R) : sub(sq(R), sq(rr)) })
      }
      row.integral = writeIntegral({ text: 'π', tex: '\\pi' }, merged(pieces), 'x')
      if (outerSet.size === 1) row.parts.push(`R(x) = ${[...outerSet][0]} (outer radius)`)
      if (innerSet.size === 1 && !disks) row.parts.push(`r(x) = ${[...innerSet][0]} (inner radius)`)
      if (disks) row.parts.push('r(x) = 0: disks')
      break
    }
    case 'shell-v': {
      if (an.through) break
      const right = lo >= k - 1e-12
      const xT: Term = { text: 'x', tex: 'x', prec: 3, bare: true }
      const radius = right ? minusConst(xT, k) : constMinus(k, xT)
      const pieces: Written[] = []
      const heights = new Set<string>()
      for (const [p, q] of spans(lo, hi, crossings(r).map(tidy))) {
        const tw = topAt((p + q) / 2)
        const h = sub(termOf(tw), termOf(other_(tw)))
        heights.add(h.text)
        pieces.push({ lo: p, hi: q, body: mul(radius, h) })
      }
      row.integral = writeIntegral({ text: '2π', tex: '2\\pi' }, merged(pieces), 'x')
      row.parts.push(`radius = ${radius.text}`)
      if (heights.size === 1) row.parts.push(`h(x) = ${[...heights][0]}`)
      break
    }
    case 'section': {
      const tw = topAt((lo + hi) / 2)
      const s = sub(termOf(tw), termOf(other_(tw)))
      row.integral = writeIntegral(factorTerm(section, ratio), [{ lo, hi, body: sq(s) }], 'x')
      row.parts.push(`s(x) = ${s.text}`)
      row.parts.push(areaFormula(section, ratio))
      break
    }
    case 'washer-v':
    case 'shell-h': {
      const alt: VolumeMethod = mode === 'washer-v' ? 'shell' : 'washer'
      const needs =
        mode === 'washer-v'
          ? `Washers about a vertical axis slice in dy, so each side of the region must be x as a function of y.`
          : `Shells about a horizontal axis slice in dy, so each side of the region must be x as a function of y.`
      if (!an.bands) {
        row.need = {
          text: `${needs} This region is not one horizontal strip at every height. Use ${alt === 'shell' ? 'shells' : 'washers'} for this axis.`,
          switchTo: alt,
        }
        break
      }
      if (mode === 'shell-h' && an.through) {
        row.need = {
          text: `The axis passes through the region, so shells in dy would count the overlap twice. Use washers for this axis.`,
          switchTo: alt,
        }
        break
      }
      if (!an.dyOk) {
        row.need = {
          text: `${needs} The inverse could not be measured reliably here. Use ${alt === 'shell' ? 'shells' : 'washers'} for this axis.`,
          switchTo: alt,
        }
        break
      }
      const written = writeDy(mode, an.bands, r, k, src, parent, other, fName, gName)
      row.integral = written.integral
      row.parts.push(...written.parts)
      break
    }
  }
  return row
}

function headOf(mode: VolumeMode, section: SectionShape, axis: VolumeAxis, an: VolumeAnalysis): string {
  const about = `about ${axisText(axis)}`
  switch (mode) {
    case 'section':
      return `${SECTION_LABELS[section].replace(/ \(.*\)$/, '')} ⟂ x-axis`
    case 'shell-v':
    case 'shell-h':
      return `Shells ${about}`
    default: {
      // Disks when the region reaches the axis everywhere; washers otherwise.
      const r = an.region
      if (!r || mode !== 'washer-h') return `Washers ${about}`
      const k = axis.at
      let disk = true
      for (let i = 1; i < 32 && disk; i++) {
        const x = an.lo + ((an.hi - an.lo) * i) / 32
        const t = Math.max(r.f(x), r.g(x)) - k
        const u = Math.min(r.f(x), r.g(x)) - k
        if (u > 1e-9 && t > 1e-9) disk = false
        if (t < -1e-9 && u < -1e-9) disk = false
      }
      return `${disk ? 'Disks' : 'Washers'} ${about}`
    }
  }
}

/** [min bottom, max top] over [a, b]: the heights a dy slice runs through. */
function yRange(r: Region): [number, number] {
  const top = topOf(r)
  const bot = botOf(r)
  let lo = Infinity
  let hi = -Infinity
  for (let i = 0; i <= 200; i++) {
    const x = r.a + ((r.b - r.a) * i) / 200
    lo = Math.min(lo, bot(x))
    hi = Math.max(hi, top(x))
  }
  return Number.isFinite(lo) && Number.isFinite(hi) && hi > lo ? [lo, hi] : [0, 1]
}

const clampTo = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi)

/**
 * The dy integral: each band's left and right sides as x = (formula in y) —
 * the typed line's inverse on that monotone stretch, or the constant a / b of
 * a vertical edge — then R, r (washers) or radius and length (shells).
 */
function writeDy(
  mode: 'washer-v' | 'shell-h',
  bands: readonly Band[],
  r: Region,
  k: number,
  src: Readonly<Record<string, string>>,
  parent: FittedCurve | undefined,
  other: FittedCurve | undefined,
  fName: string,
  gName: string,
): { integral: { text: string; tex: string }; parts: string[] } {
  const inverseTerm = (side: SideRef): Term => {
    if (side.kind === 'edge') return constTerm(tidy(side.x))
    const curve = side.which === 'f' ? parent : other
    const name = side.which === 'f' ? fName : gName
    const line = curve ? src[curve.id] : undefined
    if (line) {
      let inv: ReturnType<typeof invertFormula> = null
      try {
        inv = invertFormula(line, { lo: side.lo, hi: side.hi, loClosed: true, hiClosed: true, loExact: null, hiExact: null }, name)
      } catch {
        inv = null
      }
      const body = inv ? bodyOf(inv.source) : null
      if (body) return nodeTerm(body, 'y')
    }
    return { text: `${name}⁻¹(y)`, tex: `${name}^{-1}(y)`, prec: 3, bare: true }
  }
  const pieces: Written[] = []
  const parts = new Set<string>()
  const yT: Term = { text: 'y', tex: 'y', prec: 3, bare: true }
  for (const band of bands) {
    const L = inverseTerm(band.left)
    const Rt = inverseTerm(band.right)
    const ym = (band.y0 + band.y1) / 2
    const xl = sideX(r, band.left, ym)
    const xr = sideX(r, band.right, ym)
    const y0 = tidy(band.y0)
    const y1 = tidy(band.y1)
    if (mode === 'washer-v') {
      let R: Term
      let rr: Term
      if (xl >= k) {
        R = minusConst(Rt, k)
        rr = minusConst(L, k)
      } else if (xr <= k) {
        R = constMinus(k, L)
        rr = constMinus(k, Rt)
      } else {
        R = xr - k >= k - xl ? minusConst(Rt, k) : constMinus(k, L)
        rr = ZERO
      }
      parts.add(`R(y) = ${R.text}${rr.zero ? '' : `, r(y) = ${rr.text}`}`)
      pieces.push({ lo: y0, hi: y1, body: rr.zero ? sq(R) : sub(sq(R), sq(rr)) })
    } else {
      const radius = ym >= k ? minusConst(yT, k) : constMinus(k, yT)
      const len = sub(Rt, L)
      parts.add(`radius = ${radius.text}, length = ${len.text}`)
      pieces.push({ lo: y0, hi: y1, body: mul(radius, len) })
    }
  }
  const coef = mode === 'washer-v' ? { text: 'π', tex: '\\pi' } : { text: '2π', tex: '2\\pi' }
  return { integral: writeIntegral(coef, merged(pieces), 'y'), parts: [...parts].slice(0, 3) }
}

// ---------------------------------------------------------------------------
// The figure
// ---------------------------------------------------------------------------

const ELLIPSE_N = 64

/** An ellipse as a closed polyline: centre, semi-axes along x and y. */
function ellipse(c: Vec2, ax: number, ay: number, from = 0, to = 2 * Math.PI, n = ELLIPSE_N): Vec2[] {
  const out: Vec2[] = []
  for (let i = 0; i <= n; i++) {
    const t = from + ((to - from) * i) / n
    out.push({ x: c.x + ax * Math.cos(t), y: c.y + ay * Math.sin(t) })
  }
  return out
}

const rect = (x0: number, x1: number, y0: number, y1: number): Vec2[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
]

/** The oblique projection of "one unit out of the page". */
const OBLIQUE: Vec2 = { x: OBLIQUE_SCALE * Math.cos(OBLIQUE_ANGLE), y: OBLIQUE_SCALE * Math.sin(OBLIQUE_ANGLE) }

/**
 * A cross-section standing on its base from (x, y0) to (x, y1), drawn in the
 * plane by oblique projection: the square a parallelogram offset up-right,
 * the semicircle a half-ellipse, the triangles their three corners.
 */
export function sectionOutline(shape: SectionShape, x: number, y0: number, y1: number, ratio = 1): Vec2[] {
  const s = Math.abs(y1 - y0)
  const lo = Math.min(y0, y1)
  const hi = Math.max(y0, y1)
  const B0 = { x, y: lo }
  const B1 = { x, y: hi }
  const up = (p: Vec2, h: number): Vec2 => ({ x: p.x + h * OBLIQUE.x, y: p.y + h * OBLIQUE.y })
  const mid = { x, y: (lo + hi) / 2 }
  switch (shape) {
    case 'square':
      return [B0, B1, up(B1, s), up(B0, s)]
    case 'rectangle': {
      const h = (Number.isFinite(ratio) && ratio > 0 ? ratio : 1) * s
      return [B0, B1, up(B1, h), up(B0, h)]
    }
    case 'equilateral':
      return [B0, B1, up(mid, (Math.sqrt(3) / 2) * s)]
    case 'isoRightLeg':
      return [B0, B1, up(B0, s)]
    case 'isoRightHyp':
      return [B0, B1, up(mid, s / 2)]
    case 'semicircle': {
      const out: Vec2[] = []
      for (let i = 0; i <= 40; i++) {
        const t = (Math.PI * i) / 40
        const p = { x, y: mid.y - (s / 2) * Math.cos(t) }
        out.push(up(p, (s / 2) * Math.sin(t)))
      }
      return out
    }
  }
}

/** Where the slice's handle sits, which way it drags, and its range. */
export interface SliceHandle {
  pos: Vec2
  axis: 'x' | 'y'
  lo: number
  hi: number
}

export function volumeSliceHandle(
  link: VolumeLink,
  parent: FittedCurve | undefined,
  other: FittedCurve | undefined,
  models: Record<string, ModelSpec>,
): SliceHandle | null {
  const an = analyzeVolume(link, parent, other, models)
  const r = an.region
  if (!r || !an.result) return null
  const mode = modeOf(link)
  if (slicesInY(mode)) {
    if (!an.bands || !an.dyOk) return null
    const [ylo, yhi] = yRange(r)
    const y = link.x !== undefined && Number.isFinite(link.x) ? clampTo(link.x, ylo, yhi) : (ylo + yhi) / 2
    const band = bandAt(an.bands, y)
    if (!band) return null
    const xl = sideX(r, band.left, y)
    const xr = sideX(r, band.right, y)
    return { pos: { x: (xl + xr) / 2, y }, axis: 'y', lo: ylo, hi: yhi }
  }
  const x = link.x !== undefined && Number.isFinite(link.x) ? clampTo(link.x, an.lo, an.hi) : (an.lo + an.hi) / 2
  return { pos: { x, y: (r.f(x) + r.g(x)) / 2 }, axis: 'x', lo: an.lo, hi: an.hi }
}

function bandAt(bands: readonly Band[], y: number): Band | null {
  for (const b of bands) if (y >= b.y0 && y <= b.y1) return b
  let best: Band | null = null
  let d = Infinity
  for (const b of bands) {
    const e = Math.min(Math.abs(y - b.y0), Math.abs(y - b.y1))
    if (e < d) {
      d = e
      best = b
    }
  }
  return best
}

/**
 * Everything the volumes draw: fills first (the region, the mirror ghost —
 * under the curves), then marks (the axis, the slice, the disk or shell or
 * section, the labels — on them). A hidden or missing curve draws nothing.
 */
export function volumeOverlays(
  links: readonly VolumeLink[],
  curves: readonly FittedCurve[],
  models: Record<string, ModelSpec>,
): Overlay[] {
  const fills: Overlay[] = []
  const marks: Overlay[] = []
  const chips: Overlay[] = []
  for (const link of links) {
    const parent = curves.find((c) => c.id === link.parentId)
    if (!parent || !parent.visible) continue
    const other = link.otherId === undefined ? undefined : curves.find((c) => c.id === link.otherId)
    if (link.otherId !== undefined && (!other || !other.visible)) continue
    let an: VolumeAnalysis
    try {
      an = analyzeVolume(link, parent, other, models)
    } catch {
      continue
    }
    const r = an.region
    if (!r) continue
    const id = parent.id
    const { lo, hi } = an
    const top = topOf(r)
    const bot = botOf(r)
    const mode = modeOf(link)
    const axis = link.axis ?? X_AXIS
    const k = axis.at

    // The region, shaded as the area link shades it.
    fills.push({
      kind: 'area',
      curveId: id,
      from: lo,
      to: hi,
      ...(other ? { against: other.id } : {}),
      alpha: VOLUME_REGION_ALPHA,
    })

    // The solid's silhouette: the region's mirror across the axis.
    const N = 96
    const outline: Vec2[] = []
    for (let i = 0; i <= N; i++) {
      const x = lo + ((hi - lo) * i) / N
      outline.push({ x, y: top(x) })
    }
    for (let i = N; i >= 0; i--) {
      const x = lo + ((hi - lo) * i) / N
      outline.push({ x, y: bot(x) })
    }
    const reflect = (p: Vec2): Vec2 => (axis.dir === 'h' ? { x: p.x, y: 2 * k - p.y } : { x: 2 * k - p.x, y: p.y })
    if (mode !== 'section') {
      fills.push({
        kind: 'path',
        curveId: id,
        points: outline.map(reflect),
        closed: true,
        fill: MIRROR_FILL_ALPHA,
        alpha: MIRROR_LINE_ALPHA,
        dashed: true,
        width: 1.25,
        under: true,
      })
      // The axis itself, dashed and named.
      if (axis.dir === 'h') {
        marks.push({ kind: 'hline', curveId: id, y: k, dashed: true })
      } else {
        marks.push({ kind: 'segment', curveId: id, from: { x: k, y: -1e7 }, to: { x: k, y: 1e7 }, dashed: true, width: 1.5 })
      }
      const name = axis.at === 0 ? (axis.dir === 'h' ? 'x-axis' : 'y-axis') : axisText(axis)
      const [ylo, yhi] = yRange(r)
      chips.push({
        kind: 'label',
        curveId: id,
        at: axis.dir === 'h' ? { x: hi + (hi - lo) * 0.12, y: k } : { x: k, y: yhi + (yhi - ylo) * 0.12 },
        text: `axis: ${name}`,
        dir: { x: 1, y: -1 },
      })
    }
    if (!an.result) continue

    if (mode === 'washer-h' || mode === 'shell-v' || mode === 'section') {
      const x = link.x !== undefined && Number.isFinite(link.x) ? clampTo(link.x, lo, hi) : (lo + hi) / 2
      const t = top(x)
      const u = bot(x)
      if (!Number.isFinite(t) || !Number.isFinite(u)) continue
      const w = (hi - lo) / 50
      if (mode === 'section') {
        drawSection(link, r, x, t, u, lo, hi, id, marks, chips)
        continue
      }
      // The representative rectangle, and its reflection.
      marks.push({ kind: 'path', curveId: id, points: rect(x - w / 2, x + w / 2, u, t), closed: true, fill: SLICE_FILL_ALPHA, width: 1.25 })
      if (mode === 'washer-h') {
        marks.push({
          kind: 'path',
          curveId: id,
          points: rect(x - w / 2, x + w / 2, 2 * k - t, 2 * k - u),
          closed: true,
          fill: SLICE_MIRROR_ALPHA,
          alpha: 0.7,
          dashed: true,
          width: 1.25,
        })
        const tt = t - k
        const uu = u - k
        let R: number
        let rr: number
        let dir: 1 | -1
        if (uu >= 0) {
          R = tt
          rr = uu
          dir = 1
        } else if (tt <= 0) {
          R = -uu
          rr = -tt
          dir = -1
        } else {
          R = Math.max(tt, -uu)
          rr = 0
          dir = tt >= -uu ? 1 : -1
        }
        washerFace({ x, y: k }, R, rr, 'h', id, marks)
        // R and r, from the axis.
        const off = 3 * w
        marks.push({ kind: 'segment', curveId: id, from: { x: x + off, y: k }, to: { x: x + off, y: k + dir * R }, width: 2 })
        chips.push({ kind: 'label', curveId: id, at: { x: x + off, y: k + (dir * R) / 2 }, text: 'R', dir: { x: 1, y: 0 } })
        if (rr > 1e-9) {
          marks.push({ kind: 'segment', curveId: id, from: { x: x - off, y: k }, to: { x: x - off, y: k + dir * rr }, width: 2 })
          chips.push({ kind: 'label', curveId: id, at: { x: x - off, y: k + (dir * rr) / 2 }, text: 'r', dir: { x: -1, y: 0 } })
        }
      } else {
        // Shells about x = k: the strip's mirror, the rims, the radius and the height.
        const xm = 2 * k - x
        marks.push({
          kind: 'path',
          curveId: id,
          points: rect(xm - w / 2, xm + w / 2, u, t),
          closed: true,
          fill: SLICE_MIRROR_ALPHA,
          alpha: 0.7,
          dashed: true,
          width: 1.25,
        })
        const rad = Math.abs(x - k)
        for (const y of [t, u]) {
          marks.push({ kind: 'path', curveId: id, points: ellipse({ x: k, y }, rad, rad * EDGE_ON), closed: true, alpha: 0.6, width: 1.25 })
        }
        const ym = (t + u) / 2
        marks.push({ kind: 'segment', curveId: id, from: { x: k, y: ym }, to: { x, y: ym }, width: 2 })
        chips.push({ kind: 'label', curveId: id, at: { x: (k + x) / 2, y: ym }, text: `r = ${radiusText(x >= k, k, 'x')}`, dir: { x: 0, y: -1 } })
        const side = x >= k ? x + w : x - w
        marks.push({ kind: 'segment', curveId: id, from: { x: side, y: u }, to: { x: side, y: t }, width: 2 })
        chips.push({ kind: 'label', curveId: id, at: { x: side, y: ym }, text: 'h', dir: { x: x >= k ? 1 : -1, y: 0 } })
      }
      continue
    }

    // The two dy pairings: a horizontal slice at height y.
    if (!an.bands || !an.dyOk) continue
    const [ylo, yhi] = yRange(r)
    const y = link.x !== undefined && Number.isFinite(link.x) ? clampTo(link.x, ylo, yhi) : (ylo + yhi) / 2
    const band = bandAt(an.bands, y)
    if (!band) continue
    const xl = sideX(r, band.left, y)
    const xr = sideX(r, band.right, y)
    if (!Number.isFinite(xl) || !Number.isFinite(xr)) continue
    const w = (yhi - ylo) / 50
    marks.push({ kind: 'path', curveId: id, points: rect(xl, xr, y - w / 2, y + w / 2), closed: true, fill: SLICE_FILL_ALPHA, width: 1.25 })
    if (mode === 'washer-v') {
      marks.push({
        kind: 'path',
        curveId: id,
        points: rect(2 * k - xr, 2 * k - xl, y - w / 2, y + w / 2),
        closed: true,
        fill: SLICE_MIRROR_ALPHA,
        alpha: 0.7,
        dashed: true,
        width: 1.25,
      })
      const L = xl - k
      const Rr = xr - k
      let R: number
      let rr: number
      let dir: 1 | -1
      if (L >= 0) {
        R = Rr
        rr = L
        dir = 1
      } else if (Rr <= 0) {
        R = -L
        rr = -Rr
        dir = -1
      } else {
        R = Math.max(-L, Rr)
        rr = 0
        dir = Rr >= -L ? 1 : -1
      }
      washerFace({ x: k, y }, R, rr, 'v', id, marks)
      const off = 3 * w
      marks.push({ kind: 'segment', curveId: id, from: { x: k, y: y + off }, to: { x: k + dir * R, y: y + off }, width: 2 })
      chips.push({ kind: 'label', curveId: id, at: { x: k + (dir * R) / 2, y: y + off }, text: 'R', dir: { x: 0, y: -1 } })
      if (rr > 1e-9) {
        marks.push({ kind: 'segment', curveId: id, from: { x: k, y: y - off }, to: { x: k + dir * rr, y: y - off }, width: 2 })
        chips.push({ kind: 'label', curveId: id, at: { x: k + (dir * rr) / 2, y: y - off }, text: 'r', dir: { x: 0, y: 1 } })
      }
    } else {
      const ym = 2 * k - y
      marks.push({
        kind: 'path',
        curveId: id,
        points: rect(xl, xr, ym - w / 2, ym + w / 2),
        closed: true,
        fill: SLICE_MIRROR_ALPHA,
        alpha: 0.7,
        dashed: true,
        width: 1.25,
      })
      const rad = Math.abs(y - k)
      for (const x of [xl, xr]) {
        marks.push({ kind: 'path', curveId: id, points: ellipse({ x, y: k }, rad * EDGE_ON, rad), closed: true, alpha: 0.6, width: 1.25 })
      }
      const xm = (xl + xr) / 2
      marks.push({ kind: 'segment', curveId: id, from: { x: xm, y: k }, to: { x: xm, y }, width: 2 })
      chips.push({ kind: 'label', curveId: id, at: { x: xm, y: (k + y) / 2 }, text: `r = ${radiusText(y >= k, k, 'y')}`, dir: { x: 1, y: 0 } })
      const side = y >= k ? y + w : y - w
      marks.push({ kind: 'segment', curveId: id, from: { x: xl, y: side }, to: { x: xr, y: side }, width: 2 })
      chips.push({ kind: 'label', curveId: id, at: { x: xm, y: side }, text: 'h', dir: { x: 0, y: y >= k ? -1 : 1 } })
    }
  }
  return [...fills, ...marks, ...chips]
}

/** "x", "x − 1", "3 − x" — the radius of a shell as the card writes it. */
function radiusText(beyond: boolean, k: number, v: 'x' | 'y'): string {
  const V: Term = { text: v, tex: v, prec: 3, bare: true }
  return (beyond ? minusConst(V, k) : constMinus(k, V)).text
}

/**
 * A disk or washer seen edge-on: an ellipse centred on the axis, as tall as
 * the disk (R) and a quarter as wide — or, about a vertical axis, as wide as
 * R and a quarter as tall — with the hole r cut out of its face.
 */
function washerFace(c: Vec2, R: number, rr: number, dir: 'h' | 'v', id: string, marks: Overlay[]): void {
  if (!(R > 0)) return
  const outer = dir === 'h' ? ellipse(c, R * EDGE_ON, R) : ellipse(c, R, R * EDGE_ON)
  if (rr > 1e-9) {
    const inner = dir === 'h' ? ellipse(c, rr * EDGE_ON, rr) : ellipse(c, rr, rr * EDGE_ON)
    // The face: the outer ring one way round, the hole the other.
    marks.push({ kind: 'path', curveId: id, points: [...outer, ...inner.slice().reverse()], closed: true, fill: FACE_FILL_ALPHA, alpha: 0 })
    marks.push({ kind: 'path', curveId: id, points: outer, closed: true, alpha: 0.9, width: 1.5 })
    marks.push({ kind: 'path', curveId: id, points: inner, closed: true, alpha: 0.9, width: 1.5 })
  } else {
    marks.push({ kind: 'path', curveId: id, points: outer, closed: true, fill: FACE_FILL_ALPHA, alpha: 0.9, width: 1.5 })
  }
}

/** The base s and the section standing on it, plus a few fainter slices of the solid. */
function drawSection(
  link: VolumeLink,
  r: Region,
  x: number,
  t: number,
  u: number,
  lo: number,
  hi: number,
  id: string,
  marks: Overlay[],
  chips: Overlay[],
): void {
  const shape = link.section ?? 'square'
  const ratio = link.ratio ?? 1
  const top = topOf(r)
  const bot = botOf(r)
  // The fainter slices first, so the representative one draws over them.
  for (let i = 1; i <= GHOST_SLICES; i++) {
    const xg = lo + ((hi - lo) * i) / (GHOST_SLICES + 1)
    if (Math.abs(xg - x) < (hi - lo) / (2 * (GHOST_SLICES + 1))) continue
    const tg = top(xg)
    const ug = bot(xg)
    if (!Number.isFinite(tg) || !Number.isFinite(ug) || !(tg - ug > 0)) continue
    marks.push({
      kind: 'path',
      curveId: id,
      points: sectionOutline(shape, xg, ug, tg, ratio),
      closed: true,
      fill: 0.05,
      alpha: GHOST_SLICE_ALPHA,
      width: 1,
    })
  }
  if (!(t - u > 0)) return
  marks.push({
    kind: 'path',
    curveId: id,
    points: sectionOutline(shape, x, u, t, ratio),
    closed: true,
    fill: FACE_FILL_ALPHA * 1.6,
    alpha: 1,
    width: 1.75,
  })
  // The base s, on the region.
  marks.push({ kind: 'segment', curveId: id, from: { x, y: u }, to: { x, y: t }, width: 3 })
  chips.push({ kind: 'label', curveId: id, at: { x, y: (t + u) / 2 }, text: 's', dir: { x: -1, y: 0 } })
}

// ---------------------------------------------------------------------------
// Where a fresh one opens
// ---------------------------------------------------------------------------

/** The curves a region may run to: other functions of x on the board. */
export function regionChoices(
  parentId: string,
  curves: readonly FittedCurve[],
  models: Record<string, ModelSpec>,
): FittedCurve[] {
  return curves.filter((c) => c.id !== parentId && c.visible && models[c.modelId]?.kind === 'explicit')
}

/**
 * The region for a fresh volume. With exactly one other function on the board
 * that meets f twice in view, the region between them from the first crossing
 * to the last (the area-between rule, `defaultBetweenBounds`). Otherwise the
 * region between f and the x-axis: between two consecutive zeros of f (the
 * pair around the middle of the view), or from a lone zero four units into
 * the side where f lives (√x opens on [0, 4]), or two units either side of
 * the middle.
 */
export function defaultVolume(
  parent: FittedCurve,
  curves: readonly FittedCurve[],
  models: Record<string, ModelSpec>,
  window: [number, number],
): { otherId?: string; a: number; b: number } | null {
  const F = mvtSourceOf(parent, models)
  if (!F) return null
  const [wlo, whi] =
    Number.isFinite(window[0]) && Number.isFinite(window[1]) && window[1] > window[0] ? window : [-10, 10]
  const others = regionChoices(parent.id, curves, models)
  if (others.length === 1) {
    const g = others[0]
    let hits: number[] = []
    try {
      hits = curveIntersections(parent, g, models, [wlo, whi])
    } catch {
      hits = []
    }
    if (hits.length >= 2) {
      const [a, b] = defaultBetweenBounds(parent, g, models, [wlo, whi])
      if (b > a) return { otherId: g.id, a, b }
    }
  }
  // The longest run of the view on which f is defined.
  const N = 400
  let best: [number, number] | null = null
  let start: number | null = null
  for (let i = 0; i <= N; i++) {
    const x = wlo + ((whi - wlo) * i) / N
    const ok = Number.isFinite(F.f(x))
    if (ok && start === null) start = x
    if ((!ok || i === N) && start !== null) {
      const end = ok ? x : wlo + ((whi - wlo) * (i - 1)) / N
      if (!best || end - start > best[1] - best[0]) best = [start, end]
      start = null
    }
  }
  if (!best || !(best[1] > best[0])) return null
  const [rlo, rhi] = best
  const tol = 1e-9 * Math.max(1, Math.abs(rlo), Math.abs(rhi))
  const zeros = signChanges(F.f, rlo, rhi).map(tidy)
  if (Math.abs(F.f(rlo)) <= 1e-12) zeros.unshift(round6(rlo))
  if (Math.abs(F.f(rhi)) <= 1e-12) zeros.push(round6(rhi))
  const centre = Math.min(Math.max(0, rlo), rhi)
  if (zeros.length >= 2) {
    let pick: [number, number] = [zeros[0], zeros[1]]
    let dist = Infinity
    for (let i = 0; i + 1 < zeros.length; i++) {
      const p = zeros[i]
      const q = zeros[i + 1]
      if (!(q - p > tol)) continue
      const d = centre >= p && centre <= q ? 0 : Math.min(Math.abs(centre - p), Math.abs(centre - q))
      if (d < dist) {
        dist = d
        pick = [p, q]
      }
    }
    if (pick[1] > pick[0]) return { a: pick[0], b: pick[1] }
  }
  if (zeros.length === 1) {
    const z = zeros[0]
    const right = rhi - z
    const left = z - rlo
    if (right >= left) return { a: z, b: round6(z + Math.min(4, Math.max(right, 0))) }
    return { a: round6(z - Math.min(4, left)), b: z }
  }
  const c = Math.round(centre)
  return { a: round6(Math.max(rlo, c - 2)), b: round6(Math.min(rhi, c + 2)) }
}

/** True when an axis runs through the region (for tests and the card). */
export function axisThrough(r: Region, axis: VolumeAxis): boolean {
  return axis.dir === 'h' ? horizontalAxisThrough(r, axis.at) : verticalAxisThrough(r, axis.at)
}

// ---------------------------------------------------------------------------
// Edits
// ---------------------------------------------------------------------------

type VolumeChange = Extract<
  CalcChange,
  {
    kind:
      | 'volumeBound'
      | 'volumeMethod'
      | 'volumeAxis'
      | 'volumeSection'
      | 'volumeRatio'
      | 'volumeSlice'
      | 'volumeOther'
  }
>

export const isVolumeChange = (c: CalcChange): c is VolumeChange => c.kind.startsWith('volume')

/** The link without the slice: it moves to the middle of whatever is sliced now. */
function sliceless(link: VolumeLink): VolumeLink {
  const { x: _gone, ...rest } = link
  void _gone
  return rest
}

/**
 * One stated change to a volume link, or null when it changes nothing (or is
 * not a number). Pure, so the App's only job is to commit what comes back.
 *
 *   - A new method or axis that changes WHICH variable is sliced (dx ↔ dy)
 *     drops the slice, which then sits in the middle of the new range.
 *   - Choosing shells while the axis is still the default x-axis turns the
 *     axis to the y-axis: that is the pairing shells are taught with, and
 *     shells about the x-axis would open on a dy integral nobody asked for.
 *   - A new region re-chooses a and b the way a fresh link does (where the
 *     curves meet; where f meets the x-axis).
 */
export function applyVolumeChange(
  link: VolumeLink,
  change: VolumeChange,
  ctx: { curves: readonly FittedCurve[]; models: Record<string, ModelSpec>; window: [number, number] },
): VolumeLink | null {
  switch (change.kind) {
    case 'volumeBound': {
      if (!Number.isFinite(change.value) || link[change.which] === change.value) return null
      return { ...link, [change.which]: change.value }
    }
    case 'volumeMethod': {
      if (change.method === link.method) return null
      let next: VolumeLink = { ...link, method: change.method }
      if (change.method === 'shell' && (link.axis === undefined || (link.axis.dir === 'h' && link.axis.at === 0))) {
        next = { ...next, axis: { dir: 'v', at: 0 } }
      }
      if (change.method !== 'section') {
        const { section: _s, ratio: _r, ...rest } = next
        void _s
        void _r
        next = rest
      }
      if (slicesInY(modeOf(next)) !== slicesInY(modeOf(link))) next = sliceless(next)
      return next
    }
    case 'volumeAxis': {
      const { dir, at } = change.axis
      if ((dir !== 'h' && dir !== 'v') || !Number.isFinite(at)) return null
      const was = link.axis ?? X_AXIS
      if (was.dir === dir && was.at === at) return null
      const { axis: _a, ...rest } = link
      void _a
      let next: VolumeLink = dir === 'h' && at === 0 ? rest : { ...rest, axis: { dir, at } }
      if (slicesInY(modeOf(next)) !== slicesInY(modeOf(link))) next = sliceless(next)
      return next
    }
    case 'volumeSection': {
      if (link.method === 'section' && (link.section ?? 'square') === change.section) return null
      const { section: _s, ratio: _r, ...rest } = link
      void _s
      void _r
      return {
        ...rest,
        method: 'section',
        ...(change.section !== 'square' ? { section: change.section } : {}),
        ...(change.section === 'rectangle' && link.ratio !== undefined ? { ratio: link.ratio } : {}),
      }
    }
    case 'volumeRatio': {
      if (!Number.isFinite(change.ratio) || !(change.ratio > 0)) return null
      if ((link.ratio ?? 1) === change.ratio) return null
      const { ratio: _r, ...rest } = link
      void _r
      return change.ratio === 1 ? rest : { ...rest, ratio: change.ratio }
    }
    case 'volumeSlice': {
      if (change.x === null) return link.x === undefined ? null : sliceless(link)
      if (!Number.isFinite(change.x) || change.x === link.x) return null
      return { ...link, x: change.x }
    }
    case 'volumeOther': {
      const want = change.otherId ?? undefined
      if (want === link.otherId) return null
      const parent = ctx.curves.find((c) => c.id === link.parentId)
      if (!parent) return null
      const { otherId: _o, ...rest } = sliceless(link)
      void _o
      if (want === undefined) {
        const only = defaultVolume(parent, [parent], ctx.models, ctx.window)
        return { ...rest, ...(only ? { a: only.a, b: only.b } : {}) }
      }
      const other = ctx.curves.find((c) => c.id === want)
      if (!other) return null
      let bounds: [number, number] = [link.a, link.b]
      try {
        bounds = defaultBetweenBounds(parent, other, ctx.models, ctx.window)
      } catch {
        bounds = [link.a, link.b]
      }
      return { ...rest, otherId: want, a: bounds[0], b: bounds[1] }
    }
  }
}
