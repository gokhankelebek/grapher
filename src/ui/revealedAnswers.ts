// ============================================================================
// src/ui/revealedAnswers.ts — reveal mode on a projector: every answer, said.
//
// Presentation hides the sidebar, and most of what reveal mode reveals lives
// on the cards: a Riemann sum's value, a domain, a classification. So Next
// moved the counter and nothing on the wall changed. In presentation the
// board therefore carries a list of what has been revealed — "Revealed
// answers", in reveal order, the newest highlighted — set at presentation
// scale beside the board (src/ui/PresentAnswers.tsx).
//
// This module is the pure half: one answer key in, one line out —
//
//   answerLine(key, sources)        { label: "f · minimum", value: "(0, 1)" }
//   revealedLines(state, order, s)  the revealed keys, in the order they were
//                                   revealed, as lines
//
// Every key gets a line with a non-empty value. Where the value cannot be
// read (an object that has gone, a calculation that failed) the line says
// so rather than disappearing, so a Next never passes silently.
//
// `place` says whether the board itself draws the answer once revealed
// (a point's labelled marker, a figure's chips): the panel repeats those, so
// the class has one running list, but they are not its only home.
// ============================================================================

import type { SpecialPoint } from '../core/types'
import { pointText } from './numeric'
import type { RevealState } from './reveal'

export type AnswerPlace = 'board' | 'panel'

export interface AnswerLine {
  key: string
  /** What the answer is: "f · zero", "Riemann sum", "Unit circle". */
  label: string
  /** The answer itself, one line. Never empty. */
  value: string
  /** The colour of the object it belongs to, or null (neutral ink). */
  color: string | null
  /** 'board': the board draws it too once revealed. 'panel': only a card states it. */
  place: AnswerPlace
}

/** A computed text, or null when there is none. */
type Text = string | null

/** What the App knows, read on demand. Every reader is optional, and may throw. */
export interface AnswerSources {
  /** A curve's board name ("f") and colour. */
  curve?(id: string): { name: string; color: string } | null
  /** The point behind a point or crossing key (reveal mode's inventory). */
  point?(key: string): SpecialPoint | null
  /** The asymptotes a curve's card lists, in its order. */
  asymptotes?(curveId: string): readonly string[]
  /** The Domain rows of a curve's card. */
  domain?(curveId: string): { domain: Text; range: Text; oneToOne: Text; inverse: Text } | null
  /** A polynomial's Zeros over ℂ, as one line. */
  complex?(curveId: string): Text
  /** A typed line's family facts (src/ui/familyFacts.ts). */
  family?(curveId: string): readonly string[]
  /** A calculus tool's statement: "R₅₀ = 14.44 (exact ∫₋₄⁴ = 44/3)". `board`: it draws its value too. */
  calc?(linkId: string): { label: string; value: string; curveId?: string | null; board?: boolean } | null
  /** A Table section's part. */
  table?(curveId: string, part: string): Text
  /** A Circle theorems part. */
  circle?(curveId: string, part: string): Text
  /** Anything else by its key (unit circles, related rates, statistics, series, Euler, a system, shapes, solved lines). */
  object?(key: string): { label: string; value: Text; color?: string | null; board?: boolean } | null
  /** The texts the board's answer chips carry for this key (overlay labels), if any. */
  chips?(key: string): readonly string[]
}

const KIND_WORD: Record<string, string> = {
  zero: 'zero',
  yint: 'y-intercept',
  max: 'maximum',
  min: 'minimum',
  infl: 'inflection point',
  extreme: 'key point',
  tip: 'petal tip',
  hole: 'hole',
  meet: 'meets',
}

const TABLE_WORD: Record<string, string> = {
  values: 'table of values',
  eval: 'evaluate',
  compare: 'comparison',
  divide: 'synthetic division',
}

const CIRCLE_WORD: Record<string, string> = {
  angles: 'inscribed and central angles',
  tangent: 'tangent line',
  sector: 'arc length and sector area',
  chords: 'intersecting chords',
  external: 'tangents from a point',
  square: 'completing the square',
}

const SHAPE_WORD: Record<string, string> = {
  lengths: 'side lengths',
  slopes: 'slopes',
  angles: 'angles',
  marks: 'congruence marks',
  midpoints: 'midpoints',
  area: 'perimeter and area',
  class: 'classification',
  trig: 'trig ratios',
  pair: 'distance and midpoint',
  line: 'equation of the line',
  image: 'image',
  map: 'mapping rule',
  symmetry: 'symmetry',
  compare: 'congruence / similarity',
  centroid: 'centroid',
  circumcentre: 'circumcentre',
  incentre: 'incentre',
  orthocentre: 'orthocentre',
  euler: 'Euler line',
}

const OBJECT_WORD: Record<string, string> = {
  uc: 'Unit circle',
  rr: 'Related rates',
  stat: 'Statistics',
  series: 'Series',
  euler: 'Euler’s method',
  solve: 'Solution set',
}

/** Run a reader that may throw; null on failure. */
function safe<T>(f: (() => T) | undefined): T | null {
  if (!f) return null
  try {
    return f() ?? null
  } catch {
    return null
  }
}

const clean = (t: Text | undefined): string => (typeof t === 'string' ? t.trim() : '')

/** Shown when an answer's value could not be read — never a blank line. */
export const UNREADABLE = 'revealed (no value to show)'

/**
 * One answer key as a line for the panel.
 *
 * The key's grammar is src/ui/reveal.ts's (its header lists every kind).
 */
export function answerLine(key: string, src: AnswerSources): AnswerLine {
  const parts = key.split(':')
  const head = parts[0]
  const curveOf = (id: string): { name: string; color: string } | null => safe(() => src.curve?.(id) ?? null)
  const named = (id: string, what: string): string => {
    const c = curveOf(id)
    return c ? `${c.name} · ${what}` : what
  }
  const colorOf = (id: string): string | null => curveOf(id)?.color ?? null
  const chipText = (): string => (safe(() => src.chips?.(key) ?? null) ?? []).map(clean).filter(Boolean).join('   ')
  const line = (label: string, value: string, color: string | null, place: AnswerPlace): AnswerLine => ({
    key,
    label,
    value: value.trim() || chipText() || UNREADABLE,
    color,
    place,
  })

  if (head === 'curve' && parts.length >= 3) {
    const [, id, what, idx] = parts
    if (KIND_WORD[what] !== undefined) {
      const p = safe(() => src.point?.(key) ?? null)
      return line(named(id, KIND_WORD[what]), p ? pointText(p, { decimal: false }) : '', colorOf(id), 'board')
    }
    if (what === 'asym') {
      const list = safe(() => src.asymptotes?.(id) ?? null) ?? []
      return line(named(id, 'asymptote'), clean(list[Number(idx)]), colorOf(id), 'board')
    }
    if (what === 'domain' || what === 'range' || what === 'onetoone' || what === 'inverse') {
      const d = safe(() => src.domain?.(id) ?? null)
      const word = what === 'onetoone' ? 'one-to-one' : what
      const value = d ? (what === 'onetoone' ? d.oneToOne : d[what]) : null
      return line(named(id, word), clean(value), colorOf(id), 'panel')
    }
    if (what === 'complex') {
      return line(named(id, 'zeros over ℂ'), clean(safe(() => src.complex?.(id) ?? null)), colorOf(id), 'panel')
    }
    if (what === 'family') {
      const facts = (safe(() => src.family?.(id) ?? null) ?? []).map(clean).filter(Boolean)
      return line(named(id, 'what a, b, h, k give'), facts.join(' · '), colorOf(id), 'panel')
    }
  }

  if (head === 'cross' && parts.length >= 4) {
    const [, a, b, idx] = parts
    const na = curveOf(a)?.name ?? 'one curve'
    const nb = curveOf(b)?.name ?? 'another'
    if (idx === 'same') return line(`${na} and ${nb}`, 'the same function — they coincide', null, 'panel')
    const p = safe(() => src.point?.(key) ?? null)
    return line(`${na} and ${nb} meet`, p ? pointText(p, { decimal: false }) : '', null, 'board')
  }

  if (head === 'calc') {
    const id = parts.slice(1, -1).join(':')
    const c = safe(() => src.calc?.(id) ?? null)
    if (c) {
      const label = c.curveId ? named(c.curveId, c.label) : c.label
      return line(label, clean(c.value), c.curveId ? colorOf(c.curveId) : null, c.board ? 'board' : 'panel')
    }
    return line('Calculus', '', null, 'panel')
  }

  if (head === 'table' && parts.length >= 3) {
    const [, id, part] = parts
    const place: AnswerPlace = part === 'values' && chipText() !== '' ? 'board' : 'panel'
    return line(named(id, TABLE_WORD[part] ?? 'table'), clean(safe(() => src.table?.(id, part) ?? null)), colorOf(id), place)
  }

  if (head === 'circle' && parts.length >= 3) {
    const [, id, part] = parts
    const value = clean(safe(() => src.circle?.(id, part) ?? null))
    return line(named(id, CIRCLE_WORD[part] ?? 'circle'), value, colorOf(id), part === 'square' ? 'panel' : 'board')
  }

  // Everything else is an object of its own: read it by its key.
  const o = safe(() => src.object?.(key) ?? null)
  if (head === 'shape' && parts.length >= 3) {
    const what = SHAPE_WORD[parts[2]] ?? 'measurement'
    return line(o?.label ? `${o.label} · ${what}` : what, clean(o?.value), o?.color ?? null, 'board')
  }
  if (head === 'system') return line(o?.label ?? 'System of inequalities', clean(o?.value), o?.color ?? null, o?.board ? 'board' : 'panel')
  const word = OBJECT_WORD[head] ?? 'Answer'
  // A unit circle, related rates and statistics state their answers on their own figure.
  const board = o?.board ?? (head === 'uc' || head === 'rr' || head === 'stat')
  return line(o?.label ?? word, clean(o?.value), o?.color ?? null, board ? 'board' : 'panel')
}

/**
 * The answers revealed so far, as lines, in the order they were revealed
 * (the newest last) — only those still on the board (in `order`).
 */
export function revealedKeys(state: Pick<RevealState, 'revealed'>, order: readonly string[]): string[] {
  const live = new Set(order)
  const seen = new Set<string>()
  const out: string[] = []
  for (const k of state.revealed) {
    if (!live.has(k) || seen.has(k)) continue
    seen.add(k)
    out.push(k)
  }
  return out
}

export function revealedLines(
  state: Pick<RevealState, 'revealed'>,
  order: readonly string[],
  src: AnswerSources,
): AnswerLine[] {
  return revealedKeys(state, order).map((k) => answerLine(k, src))
}

/** How many lines the panel shows at once; the earlier ones fold into "+ n earlier". */
export const PANEL_LINES = 4

/** The lines the panel shows: the newest PANEL_LINES, and how many earlier ones are folded. */
export function panelWindow<T>(lines: readonly T[], max = PANEL_LINES): { shown: T[]; earlier: number } {
  const n = Math.max(1, Math.floor(max))
  if (lines.length <= n) return { shown: lines.slice(), earlier: 0 }
  return { shown: lines.slice(lines.length - n), earlier: lines.length - n }
}
