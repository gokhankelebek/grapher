// ============================================================================
// src/ui/shapeMeasure.ts — a shape's Measurements: what its card states and
// what the board draws, from src/core/geometry.ts.
//
//   measureReports(shape, settings, link, pointAt, named)   the geometry, once
//   measureDraw(shape, settings, reports)                   → ShapeMeasureDraw
//   measureCard(…)                                          → the card's data
//   measureAnswerKeys(shape, settings, reports)             → reveal order
//
// What is STORED is only the toggles (BoardShape.measure: which readouts are
// drawn, and a point's partner); every number is recomputed from the
// vertices on every change, which is why a dragged vertex carries its side
// lengths, its angle arcs and the classification sentence with it.
//
// Pure: no React, no DOM, no canvas. Imports nothing from shapeLinks (which
// imports this), so there is no cycle.
// ============================================================================

import type { MeasureFlag, MeasureSummaryLine, Shape, ShapeLineLink, ShapeMeasureDraw, Vec2 } from '../core/types'
import { MEASURE_FLAGS } from '../core/types'
import type { ShapeMeasureSettings } from '../core/persist'
import type { LineEq, Measure, PointMeasure, PolygonReport, SegmentReport, SlopeInfo } from '../core/geometry'
import {
  distance,
  endpointFrom,
  lineRelativeTo,
  lineThrough,
  midpoint,
  perpReason,
  pointText,
  polygonReport,
  relation,
  segmentReport,
  slope,
  withApprox,
} from '../core/geometry'
import type { ShapePart } from './reveal'

// ---------------------------------------------------------------------------
// The geometry, once per compile
// ---------------------------------------------------------------------------

/** A point measured to another point: distance, midpoint, slope — and the endpoint problem. */
export interface PairReport {
  from: Vec2
  to: Vec2
  ref: string
  length: Measure
  slope: SlopeInfo
  midpoint: PointMeasure
  line: LineEq
  /** If THIS point is the midpoint, the other end of the segment from the partner. */
  endpointIfMid: PointMeasure
  /** If the PARTNER is the midpoint, the other end from this point. */
  endpointIfPartnerMid: PointMeasure
}

/** A linked line: its equation and why it is parallel / perpendicular. */
export interface LineReport {
  line: LineEq
  rel: 'parallel' | 'perpendicular'
  to: string
  through: string
  segSlope: SlopeInfo
  /** "ℓ ‖ AB: both have slope 1/2" */
  reason: string
}

export interface MeasureReports {
  poly?: PolygonReport | null
  seg?: SegmentReport | null
  pair?: PairReport | null
  line?: LineReport | null
}

const isOn = (s: ShapeMeasureSettings | undefined, f: MeasureFlag): boolean => !!s?.show?.includes(f)

export function measureReports(
  shape: Shape,
  settings: ShapeMeasureSettings | undefined,
  link: ShapeLineLink | undefined,
  pointAt: (ref: string) => Vec2 | null,
  named: ReadonlyMap<string, Vec2>,
): MeasureReports {
  try {
    switch (shape.kind) {
      case 'polygon':
        return { poly: polygonReport(shape.pts, shape.labels) }
      case 'segment':
        return { seg: segmentReport(shape.a, shape.b, shape.labels) }
      case 'point': {
        const to = settings?.to ? pointAt(settings.to) : null
        if (!to || !Number.isFinite(shape.at.x) || !Number.isFinite(shape.at.y)) return { pair: null }
        return {
          pair: {
            from: shape.at,
            to,
            ref: settings!.to!,
            length: distance(shape.at, to),
            slope: slope(shape.at, to),
            midpoint: midpoint(shape.at, to),
            line: lineThrough(shape.at, to),
            endpointIfMid: endpointFrom(shape.at, to),
            endpointIfPartnerMid: endpointFrom(to, shape.at),
          },
        }
      }
      case 'line': {
        if (!link) return { line: null }
        const a = named.get(link.to[0])
        const b = named.get(link.to[1])
        const p = typeof link.through === 'string' ? named.get(link.through) : link.through
        if (!a || !b || !p) return { line: null }
        const res = lineRelativeTo(link.rel, a, b, p)
        if (!res) return { line: null }
        const segSlope = slope(a, b)
        const to = link.to.join('')
        const through = typeof link.through === 'string' ? link.through : pointText(link.through).text
        const reason =
          link.rel === 'parallel'
            ? segSlope.vertical
              ? `ℓ ‖ ${to}: both are vertical (undefined slope)`
              : `ℓ ‖ ${to}: both have slope ${segSlope.words}`
            : `ℓ ⊥ ${to}: ${perpReason(res.line.slope, segSlope, 'ℓ', to)}`
        return { line: { line: res.line, rel: link.rel, to, through, segSlope, reason } }
      }
      default:
        return {}
    }
  } catch {
    return {}
  }
}

// ---------------------------------------------------------------------------
// What the board draws
// ---------------------------------------------------------------------------

/** A length as a board chip: exact, or a plain decimal. */
const chipLen = (m: Measure): string => m.text
const chipSlope = (m: SlopeInfo): string => (m.vertical ? 'm undefined' : `m = ${m.text}`)

export function measureDraw(
  shape: Shape,
  settings: ShapeMeasureSettings | undefined,
  reports: MeasureReports,
): ShapeMeasureDraw | null {
  const show = settings?.show ?? []
  if (show.length === 0 && !(shape.kind === 'point' && reports.pair)) return null
  const on = (f: MeasureFlag): boolean => show.includes(f)
  const out: ShapeMeasureDraw = {}
  if (shape.kind === 'polygon' && reports.poly) {
    const r = reports.poly
    if (on('lengths')) out.lengths = r.sides.map((s) => chipLen(s.length))
    if (on('slopes')) out.slopes = r.sides.map((s) => chipSlope(s.slope))
    if (on('angles')) out.angles = r.angles.map((a) => a.text)
    if (on('right') && r.angles.some((a) => a.right)) out.right = r.angles.map((a) => a.right)
    if (on('marks')) {
      if (r.sideGroups.some((g) => g > 0)) out.ticks = r.sideGroups
      if (r.angleGroups.some((g) => g > 0)) out.arcs = r.angleGroups
    }
    if (on('midpoints')) out.midpoints = r.sides.map((s) => s.midpoint.text)
    const summary: MeasureSummaryLine[] = []
    if (on('area')) summary.push({ part: 'area', text: `P = ${withApprox(r.perimeter)}   A = ${withApprox(r.area.area)}` })
    if (on('classify')) {
      summary.push({ part: 'class', text: r.right?.special ? `${r.classification.short} (${r.right.special.kind})` : r.classification.short })
      if (r.classification.because) summary.push({ part: 'class', text: r.classification.because })
    }
    if (summary.length > 0) out.summary = summary
  } else if (shape.kind === 'segment' && reports.seg) {
    const r = reports.seg
    if (on('lengths')) out.lengths = [chipLen(r.length)]
    if (on('slopes')) out.slopes = [chipSlope(r.slope)]
    if (on('midpoints')) out.midpoints = [r.midpoint.text]
    if (on('equation')) out.equation = r.line.slopeIntercept.text
  } else if (shape.kind === 'point' && reports.pair) {
    const r = reports.pair
    out.pair = {
      to: r.to,
      length: on('lengths') ? chipLen(r.length) : null,
      slope: on('slopes') ? chipSlope(r.slope) : null,
      midpoint: on('midpoints') ? r.midpoint.text : null,
    }
  } else if (shape.kind === 'line' && reports.line) {
    const parts: string[] = []
    if (on('equation')) parts.push(reports.line.line.slopeIntercept.text)
    if (on('slopes')) parts.push(chipSlope(reports.line.line.slope))
    if (parts.length > 0) out.equation = parts.join('   ')
  }
  return Object.keys(out).length > 0 ? out : null
}

// ---------------------------------------------------------------------------
// Which toggles a card offers
// ---------------------------------------------------------------------------

export interface MeasureToggle {
  flag: MeasureFlag
  label: string
  hint: string
  on: boolean
}

const TOGGLE_TEXT: Record<Shape['kind'], Partial<Record<MeasureFlag, [string, string]>>> = {
  polygon: {
    lengths: ['Side lengths', 'Each side’s length at its midpoint, exact (√13) where it can be'],
    slopes: ['Slopes', 'Each side’s slope beside it — the test for parallel and perpendicular sides'],
    angles: ['Angles', 'An arc at every vertex with the interior angle in degrees'],
    right: ['Right angles', 'A small square at every 90° angle'],
    marks: ['Equal marks', 'Tick marks on equal sides and arcs on equal angles (congruence marks)'],
    midpoints: ['Midpoints', 'A dot at the midpoint of every side, with its coordinates'],
    area: ['Perimeter & area', 'Perimeter and area (shoelace) under the figure'],
    classify: ['Classification', 'What the figure is, with the reason in slopes and lengths'],
  },
  segment: {
    lengths: ['Length', 'The distance between the endpoints'],
    slopes: ['Slope', 'Rise over run'],
    midpoints: ['Midpoint', 'A dot at the midpoint, with its coordinates'],
    equation: ['Equation', 'The line through the endpoints, y = mx + b'],
  },
  point: {
    lengths: ['Distance', 'The distance to the other point'],
    slopes: ['Slope', 'The slope of the segment between the two points'],
    midpoints: ['Midpoint', 'The midpoint between the two points'],
  },
  line: {
    equation: ['Equation', 'The line’s equation on the board'],
    slopes: ['Slope', 'The line’s slope on the board'],
  },
  vector: {},
}

export function measureToggles(kind: Shape['kind'], settings: ShapeMeasureSettings | undefined): MeasureToggle[] {
  const table = TOGGLE_TEXT[kind]
  return MEASURE_FLAGS.filter((f) => table[f]).map((flag) => ({
    flag,
    label: table[flag]![0],
    hint: table[flag]![1],
    on: isOn(settings, flag),
  }))
}

/** The settings with one toggle flipped; undefined when nothing is left on. */
export function toggleMeasure(settings: ShapeMeasureSettings | undefined, flag: MeasureFlag): ShapeMeasureSettings | undefined {
  const cur = new Set(settings?.show ?? [])
  if (cur.has(flag)) cur.delete(flag)
  else cur.add(flag)
  const show = MEASURE_FLAGS.filter((f) => cur.has(f))
  const out: ShapeMeasureSettings = {}
  if (show.length > 0) out.show = show
  if (settings?.to) out.to = settings.to
  if (settings?.centres && settings.centres.length > 0) out.centres = [...settings.centres]
  return out.show || out.to || out.centres ? out : undefined
}

/** Every toggle the card offers, on (or all off). */
export function setAllMeasure(
  kind: Shape['kind'],
  settings: ShapeMeasureSettings | undefined,
  on: boolean,
): ShapeMeasureSettings | undefined {
  const flags = on ? MEASURE_FLAGS.filter((f) => TOGGLE_TEXT[kind][f]) : []
  const out: ShapeMeasureSettings = {}
  if (flags.length > 0) out.show = [...flags]
  if (settings?.to) out.to = settings.to
  if (settings?.centres && settings.centres.length > 0) out.centres = [...settings.centres]
  return out.show || out.to || out.centres ? out : undefined
}

/** What a point's first partner turns on by itself, so choosing one visibly does something. */
const PARTNER_SHOW: readonly MeasureFlag[] = ['lengths', 'slopes', 'midpoints']

/** A point's partner set (or cleared). */
export function setMeasureTo(settings: ShapeMeasureSettings | undefined, to: string | null): ShapeMeasureSettings | undefined {
  const out: ShapeMeasureSettings = {}
  if (settings?.show && settings.show.length > 0) out.show = [...settings.show]
  if (to) {
    out.to = to
    // a fresh partner shows its distance, so choosing one visibly does something
    if (!settings?.to && !out.show) out.show = [...PARTNER_SHOW]
  } else if (settings?.to && out.show && out.show.length === PARTNER_SHOW.length && PARTNER_SHOW.every((f) => out.show!.includes(f))) {
    // …and clearing the partner takes back what choosing it added (the
    // toggles draw nothing without one): set-then-clear stores nothing
    delete out.show
  }
  if (settings?.centres && settings.centres.length > 0) out.centres = [...settings.centres]
  return out.show || out.to || out.centres ? out : undefined
}

// ---------------------------------------------------------------------------
// Reveal order
// ---------------------------------------------------------------------------

/**
 * The answers this shape puts on the board, in teaching order: the ones its
 * toggles draw. The card's other readouts hide too, and come back with their
 * own Reveal pill, but they are not stepped through by "next".
 */
export function measureAnswerParts(
  kind: Shape['kind'],
  settings: ShapeMeasureSettings | undefined,
  reports: MeasureReports | undefined,
): ShapePart[] {
  const on = (f: MeasureFlag): boolean => isOn(settings, f)
  const out: ShapePart[] = []
  if (kind === 'point') {
    if (settings?.to && reports?.pair && (on('lengths') || on('slopes') || on('midpoints'))) out.push('pair')
    return out
  }
  if (kind === 'line') {
    if (reports?.line && (on('equation') || on('slopes'))) out.push('line')
    return out
  }
  if (on('lengths')) out.push('lengths')
  if (on('slopes')) out.push('slopes')
  if (on('midpoints')) out.push('midpoints')
  if (on('angles')) out.push('angles')
  if (on('marks')) out.push('marks')
  if (kind === 'polygon' && reports?.poly?.right && (on('angles') || on('right'))) out.push('trig')
  if (on('area')) out.push('area')
  if (on('classify')) out.push('class')
  if (kind === 'segment' && on('equation')) out.push('line')
  // a triangle's centres, in the order the card lists them
  if (kind === 'polygon') for (const f of settings?.centres ?? []) out.push(f)
  return out
}

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------

/** A point the board can measure to: a point shape, or a vertex of one. */
export interface PointChoice {
  ref: string
  label: string
  pos: Vec2
}

/** ‖ / ⊥ against the other segments, sides and lines on the board. */
export interface OtherRelation {
  text: string
}

export interface MeasureCardData {
  kind: Shape['kind']
  toggles: MeasureToggle[]
  /** The collapsed header's one line. */
  summary: string
  /** Its reveal key part. */
  summaryPart: ShapePart
  /**
   * What the figure is ("parallelogram"), shown after the summary only while
   * the classification is not a hidden answer — it has its own key, so
   * revealing the area does not reveal it.
   */
  summaryClass?: string
  reports: MeasureReports
  /** True when the vertices have no typed names (the card calls them A, B, C…). */
  unnamed: boolean
  /** A point's partners; the current one. */
  choices: PointChoice[]
  to: string | null
  /** ‖ / ⊥ with other objects on the board. */
  others: OtherRelation[]
  /** Named points a linked line can pass through; the sides it can follow. */
  throughNames: string[]
  sideNames: string[]
}

export interface BoardSeg {
  /** "AB", "side BC of △ABC", "ℓ" */
  name: string
  shapeId: string
  a: Vec2
  b: Vec2
}

/** Every segment, polygon side and linked line on the board, for ‖ / ⊥ comparisons. */
export function boardSegments(list: readonly { id: string; shape: Shape | null }[]): BoardSeg[] {
  const out: BoardSeg[] = []
  for (const { id, shape } of list) {
    if (!shape || !shape.visible) continue
    if (shape.kind === 'segment') {
      const nm = shape.labels ? shape.labels.join('') : 'the segment'
      out.push({ name: shape.labels ? `${nm}` : 'a segment', shapeId: id, a: shape.a, b: shape.b })
    } else if (shape.kind === 'polygon') {
      const n = shape.pts.length
      const names = shape.labels
      const fig = names ? (n === 3 ? `△${names.join('')}` : names.join('')) : n === 3 ? 'the triangle' : 'the polygon'
      for (let i = 0; i < n; i++) {
        const side = names ? `${names[i]}${names[(i + 1) % n]}` : `side ${i + 1}`
        out.push({ name: `${side} of ${fig}`, shapeId: id, a: shape.pts[i], b: shape.pts[(i + 1) % n] })
      }
    } else if (shape.kind === 'line' && Number.isFinite(shape.through.x) && Number.isFinite(shape.dir.x)) {
      out.push({
        name: 'line ℓ',
        shapeId: id,
        a: shape.through,
        b: { x: shape.through.x + shape.dir.x, y: shape.through.y + shape.dir.y },
      })
    }
  }
  return out
}

/** "AB ‖ DE of △DEF (slope 1/2)" for every other segment/side ‖ or ⊥ to one of ours. */
export function otherRelations(mine: readonly { name: string; a: Vec2; b: Vec2 }[], others: readonly BoardSeg[]): OtherRelation[] {
  const out: OtherRelation[] = []
  for (const m of mine) {
    for (const o of others) {
      const rel = relation(m.a, m.b, o.a, o.b)
      if (rel === 'parallel') {
        const s = slope(m.a, m.b)
        out.push({ text: `${m.name} ‖ ${o.name} (${s.vertical ? 'both vertical' : `slope ${s.words}`})` })
      } else if (rel === 'perpendicular') {
        out.push({ text: `${m.name} ⊥ ${o.name} (${perpReason(slope(m.a, m.b), slope(o.a, o.b), m.name, o.name)})` })
      } else if (rel === 'same') {
        out.push({ text: `${m.name} and ${o.name} lie on the same line` })
      }
    }
  }
  return out.slice(0, 12)
}

/** The collapsed summary of the Measurements section, and the answer it states. */
function summaryOf(kind: Shape['kind'], r: MeasureReports): { text: string; part: ShapePart; cls?: string } {
  if (kind === 'polygon' && r.poly) {
    return { text: `A = ${withApprox(r.poly.area.area)}`, part: 'area', cls: r.poly.classification.name }
  }
  if (kind === 'segment' && r.seg) return { text: `length = ${withApprox(r.seg.length)}`, part: 'lengths' }
  if (kind === 'point' && r.pair) return { text: `distance = ${withApprox(r.pair.length)}`, part: 'pair' }
  if (kind === 'line' && r.line) return { text: r.line.line.slopeIntercept.text, part: 'line' }
  return { text: '', part: 'lengths' }
}

export function measureCard(args: {
  id: string
  shape: Shape | null
  settings: ShapeMeasureSettings | undefined
  reports: MeasureReports | undefined
  /** Every compiled shape on the board, in order. */
  board: readonly { id: string; shape: Shape | null }[]
  /** Every named point on the board. */
  named: ReadonlyMap<string, Vec2>
}): MeasureCardData | null {
  const { id, shape, settings } = args
  if (!shape || shape.kind === 'vector') return null
  const reports = args.reports ?? {}
  const sum = summaryOf(shape.kind, reports)
  const choices: PointChoice[] = []
  if (shape.kind === 'point') {
    for (const { id: oid, shape: o } of args.board) {
      if (!o || oid === id) continue
      if (o.kind === 'point') choices.push({ ref: oid, label: o.label ? `${o.label} ${pointText(o.at).text}` : pointText(o.at).text, pos: o.at })
      else if (o.kind === 'segment') {
        ;[o.a, o.b].forEach((p, k) => {
          const nm = o.labels?.[k]
          choices.push({ ref: `${oid}#${k}`, label: `${nm ? `${nm} ` : ''}${pointText(p).text}${nm ? '' : ' (segment end)'}`, pos: p })
        })
      } else if (o.kind === 'polygon') {
        o.pts.forEach((p, k) => {
          const nm = o.labels?.[k]
          choices.push({ ref: `${oid}#${k}`, label: `${nm ? `${nm} ` : ''}${pointText(p).text}${nm ? '' : ' (vertex)'}`, pos: p })
        })
      }
    }
  }
  // the sides of this shape, for ‖ / ⊥ against the rest of the board
  const mine: { name: string; a: Vec2; b: Vec2 }[] = []
  if (shape.kind === 'segment' && reports.seg) mine.push({ name: reports.seg.names.join(''), a: shape.a, b: shape.b })
  if (shape.kind === 'polygon' && reports.poly) {
    reports.poly.sides.forEach((s) => mine.push({ name: s.name, a: shape.pts[s.from], b: shape.pts[s.to] }))
  }
  if (shape.kind === 'line' && Number.isFinite(shape.through.x) && Number.isFinite(shape.dir.x)) {
    mine.push({ name: 'ℓ', a: shape.through, b: { x: shape.through.x + shape.dir.x, y: shape.through.y + shape.dir.y } })
  }
  const others = otherRelations(
    mine,
    boardSegments(args.board.filter((b) => b.id !== id)),
  )
  const unnamed =
    (shape.kind === 'polygon' && !shape.labels) || (shape.kind === 'segment' && !shape.labels)
  const sideNames: string[] = []
  if (shape.kind === 'polygon' && shape.labels) {
    const n = shape.labels.length
    for (let i = 0; i < n; i++) sideNames.push(`${shape.labels[i]}${shape.labels[(i + 1) % n]}`)
  } else if (shape.kind === 'segment' && shape.labels) sideNames.push(shape.labels.join(''))
  return {
    kind: shape.kind,
    toggles: measureToggles(shape.kind, settings),
    summary: sum.text,
    summaryPart: sum.part,
    ...(sum.cls ? { summaryClass: sum.cls } : {}),
    reports,
    unnamed,
    choices,
    to: settings?.to ?? null,
    others,
    throughNames: [...args.named.keys()].filter((n) => n.length === 1).sort(),
    sideNames,
  }
}
