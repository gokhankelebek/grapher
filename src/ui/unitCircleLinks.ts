// ============================================================================
// src/ui/unitCircleLinks.ts — the App's half of the unit circle.
//
// The document stores a BoardUnitCircle (src/core/persist.ts): the centre,
// θ, degree mode, the switches, the unwrap and the inverse question. This
// file turns that into
//
//   unitCircleFigure()  what the board draws (src/render/unitCircle.ts), every
//                       label already exact: "(−√3/2, 1/2)", "θ′ = π/6"
//   unitCircleCard()    what the card prints: sin(5π/6) = 1/2, the reference
//                       angle, the quadrant, coterminal angles, the inverse
//   unitCircleBox()     the frame "Zoom to circle" and a fitted export ask for
//
// so the board and the card read the same strings and cannot disagree.
//
// WHY THE UNWRAPPED GRAPH IS NOT A CURVE. y = sin x beside the circle is a
// VIEW of the circle, not a function the teacher typed: as a real curve it
// would take a letter, a card, analysis markers, intersections with every
// other curve and a line in the saved document — all noise on a trig board —
// and its trace has to grow with θ sixty times a second while it plays,
// which a curve's domain could only do by rewriting the document every
// frame. So it is drawn by the unit circle's own renderer, as figure content
// that exports like any curve and belongs to nothing else.
// ============================================================================

import type { Vec2 } from '../core/types'
import type { BoardUnitCircle, UnitCircleShow } from '../core/persist'
import { UC_COLOR_DEFAULT, UC_SHOW_DEFAULT } from '../core/persist'
import { exactForm } from '../core/exact'
import {
  TWO_PI,
  angleText,
  coterminal,
  dec,
  inverseTrig,
  quadrantOf,
  quadrantText,
  referenceAngle,
  specialIndex,
  trigAt,
} from '../core/trig'
import type { InvFn, TrigFn, UnwrapFn } from '../core/trig'
import type { UnitCircleFigure } from '../render/unitCircle'

export type { BoardUnitCircle, UnitCircleShow }

/** Where a new circle goes: left of the origin, so y = sin x unwraps to its right. */
export const UC_DEFAULT_CENTER: Vec2 = { x: -2, y: 0 }
export const UC_DEFAULT_THETA = Math.PI / 6

export function newUnitCircle(id: string): BoardUnitCircle {
  return {
    id,
    cx: UC_DEFAULT_CENTER.x,
    cy: UC_DEFAULT_CENTER.y,
    theta: UC_DEFAULT_THETA,
    show: { ...UC_SHOW_DEFAULT },
    color: UC_COLOR_DEFAULT,
  }
}

const MINUS = '−'
const SUP_INV = '⁻¹'

/** A value as the board prints it: exact on the lattice, three decimals off it. */
function valueText(fn: TrigFn, theta: number, digits = 3): string {
  const r = trigAt(fn, theta)
  if (r.value === null) return 'undefined'
  return r.exact ? r.text : dec(r.value, digits)
}

/** A number as typed for an inverse question, shown exactly when it is: "1/2", "−√3/2". */
export function invValueText(v: number): string {
  const e = exactForm(v)
  return e ? e.text : dec(v, 4)
}

/** "(−√3/2, 1/2)" */
export function pointOnCircleText(theta: number): string {
  return `(${valueText('cos', theta)}, ${valueText('sin', theta)})`
}

/** The θ label on the board, folding θ′ into it where the two arcs coincide. */
function thetaLabel(theta: number, deg: boolean): { theta: string; ref: string | null } {
  const t = angleText(theta, deg)
  const q = quadrantOf(theta)
  if (q.kind === 'axis') return { theta: `θ = ${t}`, ref: null }
  const ref = angleText(referenceAngle(theta), deg)
  if (theta > 0 && theta < Math.PI / 2) return { theta: `θ = θ′ = ${t}`, ref: null }
  if (theta < 0 && theta > -Math.PI / 2) return { theta: `θ = ${t}, θ′ = ${ref}`, ref: null }
  return { theta: `θ = ${t}`, ref: `θ′ = ${ref}` }
}

export interface FigureOpts {
  /** θ while the animation runs (the document keeps its own until it stops). */
  playTheta?: number | null
}

export function unitCircleFigure(u: BoardUnitCircle, opts: FigureOpts = {}): UnitCircleFigure {
  const playing = typeof opts.playTheta === 'number' && Number.isFinite(opts.playTheta)
  const theta = playing ? (opts.playTheta as number) : u.theta
  const deg = u.deg === true
  const cos = trigAt('cos', theta)
  const sin = trigAt('sin', theta)
  const tan = trigAt('tan', theta)
  const leg = (r: typeof cos, digits = 3): string | null =>
    r.value === null || Math.abs(r.value) < 1e-12 ? null : r.exact ? r.text : dec(r.value, digits)
  const labels = thetaLabel(theta, deg)
  let unwrap: UnitCircleFigure['unwrap'] = null
  if (u.unwrap) {
    const r = trigAt(u.unwrap, theta)
    unwrap = {
      fn: u.unwrap,
      ghost: !playing,
      value: r.value,
      pointText:
        r.value === null
          ? ''
          : `(${angleText(theta, false)}, ${r.exact ? r.text : dec(r.value, 3)})`,
    }
  }
  let inv: UnitCircleFigure['inv'] = null
  if (u.inv) {
    const out = inverseTrig(u.inv.fn, u.inv.v)
    if (out.ok) {
      inv = {
        fn: out.fn,
        v: out.v,
        principal: out.principal,
        other: out.other,
        range: out.range,
        answerText: `${out.fn}${SUP_INV}(${invValueText(out.v)}) = ${angleText(out.principal, deg)}`,
        otherText:
          u.show.other && out.other !== null
            ? `${angleText(out.other, deg)} — not the principal value`
            : null,
      }
      if (!u.show.other) inv.other = null
    }
  }
  return {
    id: u.id,
    visible: u.hidden !== true,
    center: { x: u.cx, y: u.cy },
    theta,
    color: u.color,
    pointText: pointOnCircleText(theta),
    cosText: leg(cos),
    sinText: leg(sin),
    thetaText: labels.theta,
    refText: labels.ref,
    tanValue: tan.value,
    tanText: tan.value === null ? 'tan θ undefined' : `tan θ = ${tan.exact ? tan.text : dec(tan.value, 3)}`,
    show: {
      triangle: u.show.triangle,
      ref: u.show.ref,
      astc: u.show.astc,
      tan: u.show.tan,
    },
    unwrap,
    inv,
  }
}

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------

export interface TrigLine {
  fn: TrigFn
  /** "sin(5π/6) = 1/2", "tan(π/2) undefined". */
  text: string
  exact: boolean
}

export interface UnitCircleCardData {
  /** θ in the card's unit: "5π/6" or "150°". */
  thetaText: string
  /** The same angle in the other unit. */
  thetaAlt: string
  /** sin, cos, tan — then csc, sec, cot when asked for. */
  lines: TrigLine[]
  recip: TrigLine[]
  /** "θ′ = π/6". */
  refText: string
  /** "Quadrant II" / "on the positive y-axis". */
  quadrant: string
  /** Which of sin, cos, tan are positive there (ASTC), e.g. "sin +, cos −, tan −". */
  signs: string
  /** "−7π/6 and 17π/6". */
  coterminal: string
  /** θ wrapped into [0, 2π) when it is not already there, else null. */
  principal: string | null
  /** The collapsed card's one line: "θ = 5π/6 · (−√3/2, 1/2)". */
  summary: string
  inv:
    | {
        ok: true
        question: string
        answer: string
        range: string
        other: string | null
      }
    | { ok: false; error: string }
    | null
}

function fnLine(fn: TrigFn, theta: number, arg: string): TrigLine {
  const r = trigAt(fn, theta)
  if (r.value === null) return { fn, text: `${fn}(${arg}) undefined`, exact: true }
  return { fn, text: `${fn}(${arg}) ${r.exact ? '=' : '≈'} ${r.exact ? r.text : dec(r.value, 4)}`, exact: r.exact }
}

function signWord(v: number | null): string {
  if (v === null) return 'undef.'
  if (Math.abs(v) < 1e-12) return '0'
  return v > 0 ? '+' : MINUS
}

export const RANGE_WORDS: Record<InvFn, string> = {
  sin: `sin${SUP_INV} returns angles in [${MINUS}π/2, π/2] (quadrants I and IV)`,
  cos: `cos${SUP_INV} returns angles in [0, π] (quadrants I and II)`,
  tan: `tan${SUP_INV} returns angles in (${MINUS}π/2, π/2) — the ends are never reached`,
}

const RANGE_WORDS_DEG: Record<InvFn, string> = {
  sin: `sin${SUP_INV} returns angles in [${MINUS}90°, 90°] (quadrants I and IV)`,
  cos: `cos${SUP_INV} returns angles in [0°, 180°] (quadrants I and II)`,
  tan: `tan${SUP_INV} returns angles in (${MINUS}90°, 90°) — the ends are never reached`,
}

export function unitCircleCard(u: BoardUnitCircle): UnitCircleCardData {
  const theta = u.theta
  const deg = u.deg === true
  const arg = angleText(theta, deg)
  const lines = (['sin', 'cos', 'tan'] as const).map((fn) => fnLine(fn, theta, arg))
  const recip = (['csc', 'sec', 'cot'] as const).map((fn) => fnLine(fn, theta, arg))
  const q = quadrantOf(theta)
  const co = coterminal(theta)
  const principalDiffers = Math.abs(co.principal - theta) > 1e-9
  const s = trigAt('sin', theta).value
  const c = trigAt('cos', theta).value
  const t = trigAt('tan', theta).value
  let inv: UnitCircleCardData['inv'] = null
  if (u.inv) {
    const out = inverseTrig(u.inv.fn, u.inv.v)
    if (!out.ok) inv = { ok: false, error: out.error }
    else {
      inv = {
        ok: true,
        question: `${out.fn}${SUP_INV}(${invValueText(out.v)})`,
        answer: angleText(out.principal, deg),
        range: (deg ? RANGE_WORDS_DEG : RANGE_WORDS)[out.fn],
        other:
          out.other === null
            ? null
            : `${out.fn} θ = ${invValueText(out.v)} also at θ = ${angleText(out.other, deg)} in [0, ${
                deg ? '360°' : '2π'
              }) — not the principal value`,
      }
    }
  }
  return {
    thetaText: arg,
    thetaAlt: angleText(theta, !deg),
    lines,
    recip,
    refText: `θ′ = ${angleText(referenceAngle(theta), deg)}`,
    quadrant: quadrantText(q),
    signs: `sin ${signWord(s)}, cos ${signWord(c)}, tan ${signWord(t)}`,
    coterminal: `${angleText(co.minus, deg)} and ${angleText(co.plus, deg)}`,
    principal: principalDiffers ? angleText(co.principal, deg) : null,
    summary: `θ = ${arg} · ${pointOnCircleText(theta)}`,
    inv,
  }
}

// ---------------------------------------------------------------------------
// Frames
// ---------------------------------------------------------------------------

export interface UCBox {
  min: Vec2
  max: Vec2
}

/**
 * What the circle occupies: the circle with its labels' breathing room, and
 * — when unwrapped, or asked to leave room for it — the graph to the right
 * from x = 0 across a full turn (or to θ, past one).
 */
export function unitCircleBox(u: BoardUnitCircle, roomForGraph = false): UCBox {
  let minX = u.cx - 1.5
  let maxX = u.cx + 1.5
  let minY = u.cy - 1.5
  let maxY = u.cy + 1.5
  if (u.unwrap || roomForGraph) {
    minX = Math.min(minX, Math.min(0, u.theta) - 0.3)
    maxX = Math.max(maxX, Math.max(TWO_PI, u.theta) + 0.4)
    if (u.unwrap === 'tan') {
      minY = Math.min(minY, u.cy - 3)
      maxY = Math.max(maxY, u.cy + 3)
    }
  }
  if (u.show.tan) {
    const t = trigAt('tan', u.theta).value
    if (t !== null) {
      const c = Math.max(-3, Math.min(3, t))
      minY = Math.min(minY, u.cy + c - 0.3)
      maxY = Math.max(maxY, u.cy + c + 0.3)
    }
    maxX = Math.max(maxX, u.cx + 2.4)
  }
  return { min: { x: minX, y: minY }, max: { x: maxX, y: maxY } }
}

// ---------------------------------------------------------------------------
// Playing
// ---------------------------------------------------------------------------

/** Radians per second at 1×: one full turn in eight seconds. */
export const PLAY_RATE = TWO_PI / 8
export const PLAY_SPEEDS = [0.5, 1, 2] as const
export type PlaySpeed = (typeof PLAY_SPEEDS)[number]

/** Where a press of Play starts: from 0, unless θ is already partway round. */
export function playStart(theta: number): number {
  return theta > 1e-9 && theta < TWO_PI - 1e-9 ? theta : 0
}

/** One frame of the animation. Stops (done) at 2π. */
export function playStep(theta: number, dt: number, speed: number): { theta: number; done: boolean } {
  const next = theta + Math.max(0, dt) * PLAY_RATE * speed
  if (next >= TWO_PI - 1e-9) return { theta: TWO_PI, done: true }
  return { theta: next, done: false }
}

/** The angle the document keeps when the animation stops: on the lattice if it is near it. */
export function settleTheta(theta: number): number {
  const k = specialIndex(theta)
  return k !== null ? (k * Math.PI) / 12 : theta
}

export type { UnwrapFn, InvFn }
