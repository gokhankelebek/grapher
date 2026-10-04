// ============================================================================
// src/ui/shapeLinks.ts — points, segments, vectors and polygons as plain data,
// plus every pure question the board asks about them.
//
// src/core/parse/shapes.ts reads the line a teacher types. That is not STATE.
// What a board has to remember is the same declarative handful a slope field
// remembers:
//
//   the line as typed      "ABC = (0,0) (4,0) (a,3)"   -> vertices
//   the free constants     [a]                         -> sliders
//   the style              colour, fill, visible
//
// Everything visible — the triangle, its labels, its legend chip, the drag
// handles on its vertices — is recomputed from that on every change. Which is
// why dragging the slider `a` moves C live, and why a reopened document is a
// live figure rather than a photograph of one.
//
// THE SOURCE IS THE TRUTH, and that has a consequence the rest of the app does
// not have: a vertex dragged with a finger REWRITES the text. There is nowhere
// else to put the new number — a stored (4.2, 3) beside a source that says
// (a, 3) is a contradiction the next load would resolve the wrong way — so a
// coordinate that was `a` becomes the number, exactly as if it had been typed.
// `replaceCoord` is that rewrite, and it is the only thing in the app that
// edits a teacher's own text.
//
// Pure: no React, no DOM, no canvas. The App owns the state; this owns the
// meaning of it.
// ============================================================================

import type { ParamMeta, Shape, ShapeLineLink, ShapeOutcome, Vec2 } from '../core/types'
import { looksLikeLinkedLine, parseShape } from '../core/parse/shapes'
import { lineRelativeTo } from '../core/geometry'
import { measureCard, measureDraw, measureReports } from './shapeMeasure'
import type { MeasureCardData, MeasureReports } from './shapeMeasure'
import type { BoardShape } from '../core/persist'
import type { SymmetryReport } from '../core/transform2d'
import { figureLabel as figureLabelOf } from './shapeXform'
import { buildImage, compareCard, shapeLabels, shapePoints, symmetryAids, transformable } from './shapeXform'
import { figureNames } from '../core/transform2d'
import type { CompareCardData, XformReport } from './shapeXform'
import { fieldParamMeta } from './fieldLinks'
import { triangleCentres } from '../core/triangleCentres'
import type { TriangleCentres } from '../core/triangleCentres'
import { coord } from './fieldLinks'
import type { LegendEntry } from './present'

// The shape SHAPE lives in src/core/persist.ts, beside the format that stores
// and validates it (core may not import from src/ui). Re-exported so the UI
// has one place to reach for both the data and its meaning.
export type { BoardShape }

/** A shape's constants get the SAME slider rule a field's and a curve's do. */
export const shapeParamMeta = (name: string, v: number): ParamMeta => fieldParamMeta(name, v)

export { coord }

// ---------------------------------------------------------------------------
// Reading the line
// ---------------------------------------------------------------------------

/**
 * Does this text CLEARLY mean to be a shape?
 *
 * The equation box is shared, and the two parsers want the same string. The
 * rule that matters is the one this does NOT catch: `y = x` and `(x+1)(x-2)`
 * are curves, the shape parser refuses them, and that refusal must never be
 * what the teacher sees — so the App asks the expression parser too and only
 * falls back to the shape parser's complaint when BOTH refuse.
 *
 * What is "clearly a shape": one of the shape words, a name followed by `=`
 * and a bracket, or a line that opens with a bracket.
 */
const SHAPE_WORD_RE = /^\s*(point|segment|vector|polygon|triangle|quadrilateral|quad)\b/i
const SHAPE_NAMED_RE = /^\s*[A-Za-z]+\s*=\s*[(<]/
const SHAPE_BRACKET_RE = /^\s*[(<]/

export function looksLikeShape(src: string): boolean {
  if (typeof src !== 'string') return false
  return (
    SHAPE_WORD_RE.test(src) || SHAPE_NAMED_RE.test(src) || SHAPE_BRACKET_RE.test(src) || looksLikeLinkedLine(src)
  )
}

/**
 * parseShape, memoised on the source text.
 *
 * Re-asked on every render that touches a shape (the card's LaTeX, the slider
 * names, the vertices), and the answer is a pure function of the string.
 * Bounded because a teacher typing into the equation box generates one entry
 * per keystroke over a lesson.
 */
const PARSE_CACHE = new Map<string, ShapeOutcome>()
const PARSE_CACHE_MAX = 200

export function readShape(src: string): ShapeOutcome {
  const hit = PARSE_CACHE.get(src)
  if (hit) return hit
  let outcome: ShapeOutcome
  try {
    outcome = parseShape(src)
  } catch {
    outcome = { ok: false, error: 'The parser crashed on this input' }
  }
  if (PARSE_CACHE.size >= PARSE_CACHE_MAX) PARSE_CACHE.clear()
  PARSE_CACHE.set(src, outcome)
  return outcome
}

/** What a card calls this kind of thing. */
export function shapeNoun(kind: Shape['kind']): string {
  switch (kind) {
    case 'point':
      return 'Point'
    case 'segment':
      return 'Segment'
    case 'vector':
      return 'Vector'
    case 'line':
      return 'Line'
    default:
      return 'Polygon'
  }
}

/** Only a polygon has an interior to paint. */
export const canFill = (kind: Shape['kind']): boolean => kind === 'polygon'

// ---------------------------------------------------------------------------
// Compiling
// ---------------------------------------------------------------------------

export interface CompiledShape {
  id: string
  /** Null when the line no longer parses; `error` says why. */
  shape: Shape | null
  kind: Shape['kind'] | null
  /** "\triangle ABC: (0,0),(4,0),(4,3)", or the raw source when unreadable. */
  latex: string
  paramNames: string[]
  error: string | null
  /** A linked line's references, as typed ("parallel to AB through P"). */
  link?: ShapeLineLink
  /** The geometry the Measurements section states (src/ui/shapeMeasure.ts). */
  reports?: MeasureReports
  /** A transformation's image: the motion, its rule and what it preserves. */
  xform?: XformReport
  /** A polygon with its symmetry overlay on: the lines and turns it draws. */
  sym?: SymmetryReport | null
  /** A triangle's centres (src/core/triangleCentres.ts); null when its points are collinear. */
  centres?: TriangleCentres | null
}

/**
 * Every shape's vertices, rebuilt from its source and its current constants.
 *
 * One pass, one evaluation each. `makeShape` turns the coordinates into plain
 * numbers — a Shape is data, not closures — so the renderer never calls back
 * into the parser and a slider drag costs one evaluation per vertex.
 */
export function compileShapes(shapes: readonly BoardShape[]): Map<string, CompiledShape> {
  const out = new Map<string, CompiledShape>()
  for (const s of shapes) {
    // A transformation's image is built below, once its pre-image is; the
    // entry is made now so the map keeps board order.
    if (s.xform) {
      out.set(s.id, { id: s.id, shape: null, kind: null, latex: s.src, paramNames: [], error: 'its pre-image could not be drawn' })
      continue
    }
    const outcome = readShape(s.src)
    if (!outcome.ok) {
      out.set(s.id, {
        id: s.id,
        shape: null,
        kind: null,
        latex: s.src,
        paramNames: [],
        error: outcome.error,
      })
      continue
    }
    // Pad or trim to whatever the CURRENT line asks for: retyping
    // "(a, 0)" as "(a, b)" must not leave b undefined.
    const params = outcome.paramNames.map((_n, i) =>
      Number.isFinite(s.params[i]) ? s.params[i] : outcome.defaultParams[i],
    )
    let built: Shape | null = null
    try {
      built = outcome.makeShape(s.id, params, s.color)
    } catch {
      built = null
    }
    if (built && built.kind === 'polygon') built = { ...built, fill: s.fill === true }
    out.set(s.id, {
      id: s.id,
      shape: built ? { ...built, visible: s.visible } : null,
      kind: outcome.kind,
      latex: outcome.latex,
      paramNames: outcome.paramNames.slice(),
      error: built ? null : 'the line could not be turned into a figure',
      ...(outcome.link ? { link: outcome.link } : {}),
    })
  }

  // Linked lines: resolve the names against everything else on the board, so
  // "parallel to AB through P" follows A, B and P wherever they are dragged.
  const named = namedPointMap(shapes, out)
  for (const s of shapes) {
    const c = out.get(s.id)
    if (!c || !c.link || !c.shape || c.shape.kind !== 'line') continue
    const L = c.link
    const a = named.get(L.to[0])
    const b = named.get(L.to[1])
    const p = typeof L.through === 'string' ? named.get(L.through) : L.through
    const missing = [!a ? L.to[0] : null, !b ? L.to[1] : null, typeof L.through === 'string' && !p ? L.through : null].filter(
      (x): x is string => x !== null,
    )
    if (missing.length > 0) {
      out.set(s.id, {
        ...c,
        shape: null,
        error: `there is no point named ${missing.join(' or ')} on the board — name a point P = (1, 2) or a vertex ABC = …`,
      })
      continue
    }
    const res = lineRelativeTo(L.rel, a!, b!, p!)
    if (!res) {
      out.set(s.id, { ...c, shape: null, error: `${L.to.join('')} has no direction — ${L.to[0]} and ${L.to[1]} are the same point` })
      continue
    }
    out.set(s.id, { ...c, shape: { ...c.shape, through: res.through, dir: res.dir } })
  }

  // Images, in dependency order: an image of an image waits for its parent.
  // The centre of a rotation may be a named point ("about C"), so the names
  // are read again as each round of images lands (A′ is a name too).
  const pending = shapes.filter((s) => s.xform)
  const byId = new Map(shapes.map((s) => [s.id, s]))
  const taken = new Set<string>()
  for (const v of out.values()) for (const l of v.shape ? shapeLabels(v.shape) ?? [] : []) taken.add(l)
  // In board order, each as soon as its pre-image is built — so the names
  // are handed out in the order the images were made (A′, then A″ …).
  while (pending.length > 0) {
    const i = pending.findIndex((s) => {
      const parentBoard = byId.get(s.xform!.of)
      return !(parentBoard?.xform && pending.includes(parentBoard))
    })
    if (i < 0) {
      for (const s of pending) {
        out.set(s.id, { id: s.id, shape: null, kind: null, latex: s.src, paramNames: [], error: 'it is an image of itself (the chain of images loops)' })
      }
      break
    }
    const s = pending.splice(i, 1)[0]
    const named = namedPointMap(shapes, out)
    const parent = out.get(s.xform!.of)
    const built = buildImage(s, parent?.shape ?? null, named, parent?.xform ?? null, taken)
    for (const l of built.shape ? shapeLabels(built.shape) ?? [] : []) taken.add(l)
    out.set(s.id, {
      id: s.id,
      shape: built.shape,
      kind: built.shape?.kind ?? parent?.kind ?? null,
      latex: built.latex,
      paramNames: [],
      error: built.error,
      ...(built.report ? { xform: built.report } : {}),
    })
  }

  // Measurements: the geometry each card states, and what each shape draws.
  const pointAt = (ref: string): Vec2 | null => resolvePointRef(ref, out)
  for (const s of shapes) {
    const c = out.get(s.id)
    if (!c || !c.shape) continue
    const reports = measureReports(c.shape, s.measure, c.link, pointAt, named)
    const draw = measureDraw(c.shape, s.measure, reports)
    let shape = draw && c.shape.kind !== 'vector' ? ({ ...c.shape, measure: draw } as Shape) : c.shape
    // The symmetry overlay: lines of symmetry and the turns, on the figure.
    let sym: SymmetryReport | null | undefined
    if (s.sym && shape.kind === 'polygon') {
      const got = symmetryAids(shape)
      sym = got.report
      if (got.aids) shape = { ...shape, aids: { ...(shape.aids ?? {}), ...got.aids } }
    }
    // A triangle's centres: every triangle's card states them; the flags say which are drawn.
    let centres: TriangleCentres | null | undefined
    if (shape.kind === 'polygon' && shape.pts.length === 3) {
      try {
        centres = triangleCentres(shape.pts, shape.labels)
      } catch {
        centres = null
      }
      const flags = s.measure?.centres
      if (flags && flags.length > 0) shape = { ...shape, centres: flags }
    }
    out.set(s.id, { ...c, shape, reports, ...(sym !== undefined ? { sym } : {}), ...(centres !== undefined ? { centres } : {}) })
  }
  return out
}

/**
 * Every NAMED point on the board: a point's own name, and the letters of a
 * named segment's or polygon's vertices. A point shape wins over a vertex of
 * the same name; otherwise the first in board order.
 */
export function namedPointMap(shapes: readonly { id: string }[], compiled: Map<string, CompiledShape>): Map<string, Vec2> {
  const out = new Map<string, Vec2>()
  for (const s of shapes) {
    const sh = compiled.get(s.id)?.shape
    if (sh?.kind === 'point' && sh.label && !out.has(sh.label)) out.set(sh.label, sh.at)
  }
  for (const s of shapes) {
    const sh = compiled.get(s.id)?.shape
    if (!sh) continue
    if (sh.kind === 'segment' && sh.labels) {
      if (sh.labels[0] && !out.has(sh.labels[0])) out.set(sh.labels[0], sh.a)
      if (sh.labels[1] && !out.has(sh.labels[1])) out.set(sh.labels[1], sh.b)
    } else if (sh.kind === 'polygon' && sh.labels) {
      sh.labels.forEach((l, i) => {
        if (l && !out.has(l) && sh.pts[i]) out.set(l, sh.pts[i])
      })
    }
  }
  return out
}

/** A point partner reference: "S3" (a point) or "S1#2" (vertex 2 of a shape). */
export function resolvePointRef(ref: string, compiled: Map<string, CompiledShape>): Vec2 | null {
  const hash = ref.lastIndexOf('#')
  const id = hash >= 0 ? ref.slice(0, hash) : ref
  const k = hash >= 0 ? Number(ref.slice(hash + 1)) : -1
  const sh = compiled.get(id)?.shape
  if (!sh) return null
  if (sh.kind === 'point') return k < 0 ? sh.at : null
  if (k < 0 || !Number.isInteger(k)) return null
  if (sh.kind === 'segment') return k === 0 ? sh.a : k === 1 ? sh.b : null
  if (sh.kind === 'polygon') return sh.pts[k] ?? null
  return null
}

/** The shapes the scene draws, in board order. Hidden shapes contribute none. */
export function sceneShapes(
  shapes: readonly BoardShape[],
  compiled: Map<string, CompiledShape>,
): Shape[] {
  const out: Shape[] = []
  for (const s of shapes) {
    if (!s.visible) continue
    const c = compiled.get(s.id)
    if (c?.shape) out.push(c.shape)
  }
  return out
}

// ---------------------------------------------------------------------------
// Where the coordinates live IN THE TEXT
// ---------------------------------------------------------------------------
//
// The parser reports what a line MEANS. To rewrite one coordinate of it we
// need to know where that coordinate IS, and the parser does not say — so the
// bracket run is scanned again here, by the same rules (a matched bracket, one
// top-level comma). It is deliberately forgiving: anything it cannot make
// sense of yields no pairs, and a shape with no pairs simply has no draggable
// vertices and no typeable coordinates. It never decides what is valid; the
// parser has already done that.

export interface CoordSpan {
  /** The expression source exactly as typed, trimmed. */
  text: string
  /** Offsets into the whole line: [start, end) of the untrimmed source. */
  from: number
  to: number
}

export interface CoordPair {
  /** true for <a, b> — components rather than a location. */
  angle: boolean
  x: CoordSpan
  y: CoordSpan
}

/**
 * Index of the bracket closing the one at `open`, or -1.
 *
 * The same two rules the parser uses: a '(' nests, and a '>' closes a '<' at
 * paren depth zero (so "<f(1), 2>" is one pair, not a truncated one).
 */
function matchClose(src: string, open: number, angle: boolean): number {
  let depth = 0
  for (let i = angle ? open + 1 : open; i < src.length; i++) {
    const c = src[i]
    if (c === '(') depth++
    else if (c === ')') {
      depth--
      if (!angle && depth === 0) return i
      if (depth < 0) return -1
    } else if (angle && c === '>' && depth === 0) return i
  }
  return -1
}

/** Offset of the single top-level comma in `inner`, or -1. */
function topComma(inner: string): number {
  let depth = 0
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i]
    if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') depth--
    else if (c === ',' && depth === 0) return i
  }
  return -1
}

/**
 * Every coordinate pair in a shape's line, in source order.
 *
 * The order is the parser's own pair order, which is what makes a pair index
 * a stable name for a vertex: pair 2 of "ABC = (0,0) (4,0) (4,3)" is C, on the
 * card, on the board and in the text.
 */
export function scanPairs(src: string): CoordPair[] {
  const out: CoordPair[] = []
  if (typeof src !== 'string') return out
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (c !== '(' && c !== '<') {
      i++
      continue
    }
    const angle = c === '<'
    const close = matchClose(src, i, angle)
    if (close < 0) break
    const innerAt = i + 1
    const inner = src.slice(innerAt, close)
    const cut = topComma(inner)
    if (cut < 0) {
      i = close + 1
      continue
    }
    out.push({
      angle,
      x: { text: inner.slice(0, cut).trim(), from: innerAt, to: innerAt + cut },
      y: {
        text: inner.slice(cut + 1).trim(),
        from: innerAt + cut + 1,
        to: close,
      },
    })
    i = close + 1
  }
  return out
}

/**
 * A number as it is written back INTO a teacher's line.
 *
 * ASCII only and no exponent below 1e6: this goes back through the parser, and
 * "−0.2" with a typographic minus is not a number to it. Nine decimals is past
 * anything a pointer produces and short of float noise.
 */
export function numText(v: number): string {
  if (!Number.isFinite(v)) return '0'
  const r = Math.abs(v) < 1e-12 ? 0 : v
  if (Math.abs(r) >= 1e6) return r.toExponential(6)
  const s = String(Math.round(r * 1e9) / 1e9)
  return s === '-0' ? '0' : s
}

/**
 * Rewrite ONE coordinate of a shape's line with a plain number.
 *
 * The surrounding whitespace is kept, so "( 1, 2 )" stays spaced the way it
 * was typed and only the number changes. Returns null when the pair or the
 * axis is not there, which the caller treats as "nothing to do".
 */
export function replaceCoord(
  src: string,
  pairIndex: number,
  axis: 'x' | 'y',
  value: number,
): string | null {
  const pairs = scanPairs(src)
  const pair = pairs[pairIndex]
  if (!pair) return null
  const span = axis === 'x' ? pair.x : pair.y
  const raw = src.slice(span.from, span.to)
  const lead = /^\s*/.exec(raw)?.[0] ?? ''
  const trail = /\s*$/.exec(raw)?.[0] ?? ''
  const next = `${lead}${numText(value)}${trail}`
  if (next === raw) return null
  return src.slice(0, span.from) + next + src.slice(span.to)
}

/** Is this coordinate a formula rather than a plain number? */
export function isExprCoord(text: string): boolean {
  return !/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(text.trim())
}

// ---------------------------------------------------------------------------
// Vertices: the same list the card prints and the board hands a finger
// ---------------------------------------------------------------------------

/**
 * One movable corner of a shape.
 *
 * `mode` is the whole subtlety of the vector. "v = <2, 3> from (1, 1)" has a
 * TIP at (3, 4), but the text that puts it there is the COMPONENTS pair — so
 * dragging the tip to (5, 5) must write <4, 4>, not <5, 5>. Every other
 * vertex writes the position straight in.
 */
export interface ShapeVertex {
  /** Which coordinate pair of the line this vertex is written in. */
  pair: number
  /** 'A', 'tip', 'tail', or '' when the shape names nothing. */
  label: string
  pos: Vec2
  mode: 'absolute' | 'components'
  /** For 'components': the tail the components are measured from. */
  origin: Vec2
}

const ORIGIN: Vec2 = { x: 0, y: 0 }

/**
 * Every vertex of a built shape, paired with the text it is written in.
 *
 * Both the card's coordinate lines and the board's drag handles come from
 * here, so what a teacher reads and what they can grab cannot disagree.
 */
export function shapeVertices(shape: Shape, pairs: readonly CoordPair[]): ShapeVertex[] {
  const abs = (pair: number, label: string, pos: Vec2): ShapeVertex => ({
    pair,
    label,
    pos,
    mode: 'absolute',
    origin: ORIGIN,
  })
  switch (shape.kind) {
    case 'point':
      return pairs.length >= 1 ? [abs(0, shape.label ?? '', shape.at)] : []
    case 'segment': {
      if (pairs.length < 2) return []
      const [a, b] = shape.labels ?? ['start', 'end']
      return [abs(0, a, shape.a), abs(1, b, shape.b)]
    }
    case 'vector': {
      const angleIdx = pairs.findIndex((p) => p.angle)
      const tip: Vec2 = { x: shape.tail.x + shape.v.x, y: shape.tail.y + shape.v.y }
      // Which pair carries the components? The angle-bracket one when there is
      // one; otherwise a lone pair is components and two pairs are tail-to-tip.
      const compIdx = angleIdx >= 0 ? angleIdx : pairs.length === 2 ? -1 : 0
      if (compIdx >= 0) {
        const tailIdx = pairs.findIndex((p, i) => i !== compIdx)
        const out: ShapeVertex[] = [
          {
            pair: compIdx,
            label: 'tip',
            pos: tip,
            mode: 'components',
            origin: shape.tail,
          },
        ]
        // The tail is grabbable only when the line actually writes one: a
        // vector with no `from` starts at the origin, and there is no text
        // there to move.
        if (tailIdx >= 0) out.push(abs(tailIdx, 'tail', shape.tail))
        return out.sort((p, q) => p.pair - q.pair)
      }
      if (pairs.length < 2) return []
      return [abs(0, 'tail', shape.tail), abs(1, 'tip', tip)]
    }
    case 'line':
      // A linked line has no coordinates of its own: it moves with A, B and P.
      return []
    default: {
      const out: ShapeVertex[] = []
      for (let i = 0; i < shape.pts.length && i < pairs.length; i++) {
        out.push(abs(i, shape.labels?.[i] ?? '', shape.pts[i]))
      }
      return out
    }
  }
}

/**
 * The line as it would read with this vertex moved to `to`.
 *
 * One place, so a drag and a typed coordinate are the same edit — which is
 * what lets the card's tooltip promise that they are.
 */
export function moveVertex(src: string, v: ShapeVertex, to: Vec2): string | null {
  const want =
    v.mode === 'components' ? { x: to.x - v.origin.x, y: to.y - v.origin.y } : { x: to.x, y: to.y }
  if (!Number.isFinite(want.x) || !Number.isFinite(want.y)) return null
  const withX = replaceCoord(src, v.pair, 'x', want.x)
  const next = replaceCoord(withX ?? src, v.pair, 'y', want.y)
  return next ?? withX
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

/**
 * The chip a projected board shows for one shape.
 *
 * A named figure is its NAME: △ABC on the wall, not △ABC followed by nine
 * numbers the class cannot read from the back of the room. Anything unnamed
 * keeps its coordinates, because without them the chip would say "polygon".
 */
export function shapeChipTex(latex: string): string {
  const i = latex.indexOf(':')
  if (i > 0) {
    const head = latex.slice(0, i).trim()
    if (
      /^\\triangle\s+[A-Za-z]+$/.test(head) ||
      /^\\overline\{[A-Za-z]+\}$/.test(head) ||
      /^[A-Za-z]+$/.test(head)
    ) {
      return head
    }
  }
  return latex
}

/** A shape's chip, in its own colour, for the projected legend. */
export function shapeLegend(
  shapes: readonly BoardShape[],
  compiled: Map<string, CompiledShape>,
): LegendEntry[] {
  const out: LegendEntry[] = []
  for (const s of shapes) {
    if (!s.visible) continue
    const c = compiled.get(s.id)
    if (!c || !c.shape) continue
    out.push({ id: s.id, color: s.color, tex: c.xform ? c.latex.split(' = ')[0] : shapeChipTex(c.latex), text: s.src })
  }
  return out
}

/** "(4, 3)" — how a card prints one vertex. */
export function pointLabel(p: Vec2): string {
  return `(${coord(p.x)}, ${coord(p.y)})`
}

// ---------------------------------------------------------------------------
// What a card is handed
// ---------------------------------------------------------------------------

/** One slider row on a shape's card, already resolved against the line. */
export interface ShapeParamRow {
  name: string
  value: number
  meta: ParamMeta
}

/** One vertex's line on the card. */
export interface ShapeVertexRow {
  /** Stable across re-renders: the pair index names the vertex. */
  key: string
  pair: number
  label: string
  x: number
  y: number
  /** The coordinate's own source text, so the card can say it is a formula. */
  xSrc: string
  ySrc: string
  xExpr: boolean
  yExpr: boolean
  mode: ShapeVertex['mode']
  origin: Vec2
}

/**
 * Everything one shape's card needs, already computed.
 *
 * The card renders it and nothing else: no parser, no evaluation. The readouts
 * and the picture therefore come from the same pass and cannot disagree.
 */
export interface ShapeCardData {
  kind: Shape['kind'] | null
  noun: string
  latex: string
  /** Why this shape draws nothing right now, in the parser's words. */
  error: string | null
  params: ShapeParamRow[]
  vertices: ShapeVertexRow[]
  /** Polygons only. */
  fillable: boolean
  fill: boolean
  /** The Measurements section; null for a vector or a shape that cannot be drawn. */
  measure: MeasureCardData | null
  /** This shape is a transformation's image: the motion and what it preserves. */
  image: XformReport | null
  /** A point, segment or polygon that can be transformed (an image too: chaining). */
  canTransform: boolean
  /** The name a transformation of it is written with: "ABC". */
  figure: string | null
  /** Its vertex names as the card says them (A, B, C… when untyped; A′, B′… on an image). */
  names: string[]
  /** "△ABC" */
  figureLabel: string
  /** A polygon's symmetry (whether or not the overlay is drawn). */
  symmetry: SymmetryReport | null
  /** Compare with another figure (segments and polygons). */
  compare: CompareCardData | null
  /** A triangle's centres (null for anything else, or three collinear points). */
  centres: TriangleCentres | null
  /** The number its next image gets (2 when it already has one: A′₂B′₂C′₂); absent = 1. */
  nextImage?: number
}

export function shapeCard(
  shape: BoardShape,
  compiled: Map<string, CompiledShape>,
): ShapeCardData {
  const c = compiled.get(shape.id)
  const names = c?.paramNames ?? []
  const pairs = scanPairs(shape.src)
  const vertices: ShapeVertexRow[] = []
  // An image's vertices follow its pre-image: nothing in its line to type or drag.
  if (c?.shape && !shape.xform) {
    for (const v of shapeVertices(c.shape, pairs)) {
      const pair = pairs[v.pair]
      const xSrc = pair?.x.text ?? ''
      const ySrc = pair?.y.text ?? ''
      vertices.push({
        key: `${shape.id}:${v.pair}`,
        pair: v.pair,
        label: v.label,
        x: v.pos.x,
        y: v.pos.y,
        xSrc,
        ySrc,
        xExpr: isExprCoord(xSrc),
        yExpr: isExprCoord(ySrc),
        mode: v.mode,
        origin: v.origin,
      })
    }
  }
  const built = c?.shape ?? null
  const fig = built && transformable(built.kind) ? built : null
  return {
    kind: c?.kind ?? null,
    noun: shape.xform ? 'Image' : shapeNoun(c?.kind ?? 'polygon'),
    latex: c?.latex ?? shape.src,
    error: c?.error ?? null,
    params: names.map((name, i) => {
      const value = Number.isFinite(shape.params[i]) ? shape.params[i] : 1
      return { name, value, meta: shapeParamMeta(name, value) }
    }),
    vertices,
    fillable: canFill(c?.kind ?? 'point'),
    fill: shape.fill === true,
    measure: c?.shape
      ? measureCard({
          id: shape.id,
          shape: c.shape,
          settings: shape.measure,
          reports: c.reports,
          board: boardList(compiled),
          named: namedPointMap(boardList(compiled), compiled),
        })
      : null,
    image: c?.xform ?? null,
    canTransform: fig !== null,
    figure: fig ? (shapeLabels(fig)?.join('') ?? null) : null,
    names: c?.xform ? c.xform.primes : fig ? figureNames((shapePoints(fig) ?? []).length, shapeLabels(fig)) : [],
    figureLabel: c?.xform ? c.xform.imageName : fig ? figureLabelOf(fig) : '',
    symmetry: fig && fig.kind === 'polygon' ? (c?.sym !== undefined ? c.sym : symmetryAids(fig).report) : null,
    compare: fig && fig.kind !== 'point' ? compareCard(fig, shape.id, boardList(compiled), shape.compare) : null,
    centres: c?.centres ?? null,
  }
}

/** The compiled shapes in board order (a Map keeps insertion order). */
const BOARD_LIST = new WeakMap<Map<string, CompiledShape>, { id: string; shape: Shape | null }[]>()
function boardList(compiled: Map<string, CompiledShape>): { id: string; shape: Shape | null }[] {
  const hit = BOARD_LIST.get(compiled)
  if (hit) return hit
  const list = [...compiled.values()].map((c) => ({ id: c.id, shape: c.shape }))
  BOARD_LIST.set(compiled, list)
  return list
}
