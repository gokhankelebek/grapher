// ============================================================================
// Typed shapes (src/core/parse/shapes.ts):
//
//   export function parseShape(src: string): ShapeOutcome
//
// A shape is a handful of points, written the way a Math 3 teacher writes
// them on a board:
//
//   point (1, 2)        P = (1, 2)            P(1, 2)
//   segment (0,0) (3,4) AB = (0,0) (3,4)      segment from (0,0) to (3,4)
//   vector <3, 4>       v = <3,4> from (1,1)  vector (1,1) to (4,5)
//   polygon (0,0) (4,0) (4,3)                 triangle …   quadrilateral …
//   ABC = (0,0) (4,0) (4,3)                   (letters name the vertices)
//
// Keywords are case-insensitive; whitespace is free. A comma is required
// BETWEEN the two coordinates of a pair — "(1 2)" is a typo, not a point —
// and pairs may be separated by commas or by nothing but space.
//
// Every coordinate is an ordinary expression in the shared engine
// (./index.ts): functions, powers, implicit multiplication, pi/e, and
// single-letter free constants that become sliders exactly as
// parseExpression's do. What a shape does NOT have is a running variable:
// there is no x sweeping across the board, so 'x', 'y', 'r' and 'θ' are
// refused here. 't' is not a coordinate name, so it stays available as an
// ordinary slider — "<cos(t), sin(t)>" is a vector you can spin.
//
// `makeShape` evaluates each coordinate ONCE into plain numbers: a Shape is
// data, not closures, so the renderer never calls back into the parser.
//
// No module cycle: this file imports ./index.ts; ./index.ts never imports it.
// ============================================================================

import type { Shape, ShapeOutcome, Vec2 } from '../types'
import { compileExpr } from './index'

type Kind = Shape['kind']

// ----------------------------------------------------------------------------
// Failures
// ----------------------------------------------------------------------------

interface Fail {
  ok: false
  error: string
  pos?: number
}

const fail = (error: string, pos?: number): Fail =>
  pos === undefined ? { ok: false, error } : { ok: false, error, pos }

const isFail = (v: unknown): v is Fail =>
  typeof v === 'object' && v !== null && (v as { ok?: unknown }).ok === false

/** Offset of the first non-space character of `s`, or 0 when it is all space. */
function firstNonSpace(s: string): number {
  const m = /\S/.exec(s)
  return m ? m.index : 0
}

/** Re-point "at position N" inside a message produced from a substring. */
function shift(msg: string, by: number): string {
  if (by === 0) return msg
  return msg.replace(/position (\d+)/g, (_m, d: string) => `position ${Number(d) + by}`)
}

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

const START_HINT =
  'Start with point, segment, vector or polygon — or name it, e.g. P = (1, 2)'
const CURVE_MSG = 'That is a curve — type it in the equation box as it is'

/** How a refused reserved variable is spelled back to the teacher. */
const VAR_LABEL: Record<string, string> = { x: "'x'", y: "'y'", r: "'r'", theta: 'θ' }

// ----------------------------------------------------------------------------
// Keywords
// ----------------------------------------------------------------------------

interface Keyword {
  kind: Kind
  /** exact vertex count a triangle/quadrilateral demands */
  vertices?: number
  /** how the word is spelled in an error message */
  word: string
  /** a correct line to show when the teacher's is not */
  eg: string
}

const KEYWORDS: Record<string, Keyword> = {
  point: { kind: 'point', word: 'point', eg: 'point (1, 2)' },
  segment: { kind: 'segment', word: 'segment', eg: 'segment (0, 0) (3, 4)' },
  vector: { kind: 'vector', word: 'vector', eg: 'vector <3, 4>' },
  polygon: { kind: 'polygon', word: 'polygon', eg: 'polygon (0, 0) (4, 0) (4, 3)' },
  triangle: { kind: 'polygon', vertices: 3, word: 'triangle', eg: 'triangle (0, 0) (4, 0) (4, 3)' },
  quadrilateral: { kind: 'polygon', vertices: 4, word: 'quadrilateral', eg: 'quadrilateral (0, 0) (4, 0) (4, 3) (0, 3)' },
  quad: { kind: 'polygon', vertices: 4, word: 'quadrilateral', eg: 'quadrilateral (0, 0) (4, 0) (4, 3) (0, 3)' },
}

/** Words that join two points; they carry no meaning of their own. */
const JOINERS = new Set(['to', 'from'])

// ----------------------------------------------------------------------------
// Lexical structure: the head, then a run of coordinate pairs
// ----------------------------------------------------------------------------

interface Coord {
  /** the expression source, exactly as typed */
  src: string
  /** its offset in the whole input */
  at: number
}

interface Pair {
  /** true for <a, b> — components rather than a location */
  angle: boolean
  x: Coord
  y: Coord
  /** offset of the opening bracket in the whole input */
  at: number
  /** offset just past the closing bracket */
  end: number
}

type Item = Pair | { joiner: 'to' | 'from'; at: number }

const isPair = (it: Item): it is Pair => 'angle' in it

/** Index of the ')' closing the '(' at `open`, or -1. */
function matchParen(src: string, open: number): number {
  let depth = 0
  for (let i = open; i < src.length; i++) {
    const c = src[i]
    if (c === '(') depth++
    else if (c === ')') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/** Index of the '>' closing the '<' at `open`, or -1. */
function matchAngle(src: string, open: number): number {
  let depth = 0
  for (let i = open + 1; i < src.length; i++) {
    const c = src[i]
    if (c === '(') depth++
    else if (c === ')') depth--
    else if (c === '>' && depth === 0) return i
  }
  return -1
}

/** Offsets of the commas at bracket depth 0 inside `inner`. */
function topLevelCommas(inner: string): number[] {
  const out: number[] = []
  let depth = 0
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i]
    if (c === '(' || c === '[' || c === '{') depth++
    else if (c === ')' || c === ']' || c === '}') depth--
    else if (c === ',' && depth === 0) out.push(i)
  }
  return out
}

/** Split "(a, b)" — the brackets already stripped — into its two coordinates. */
function splitPair(inner: string, innerAt: number, pair: { angle: boolean; at: number }): [Coord, Coord] | Fail {
  const commas = topLevelCommas(inner)
  if (commas.length === 0) {
    // "(x + 1)" is not a typo, it is a formula: say so rather than ask for a comma.
    const one = compileExpr(inner)
    if (one.ok && one.expr.vars.some((v) => v === 'x' || v === 'y')) {
      return fail(CURVE_MSG, pair.at)
    }
    return pair.angle
      ? fail('A vector needs two components separated by a comma, e.g. <3, 4>', pair.at)
      : fail('A point needs two coordinates separated by a comma, e.g. (1, 2)', pair.at)
  }
  if (commas.length > 1) {
    const at = innerAt + commas[1]
    return fail(
      `A coordinate pair holds just two numbers — this one has ${commas.length + 1}, at position ${at}`,
      at,
    )
  }
  const cut = commas[0]
  const x: Coord = { src: inner.slice(0, cut), at: innerAt }
  const y: Coord = { src: inner.slice(cut + 1), at: innerAt + cut + 1 }
  for (const c of [x, y]) {
    if (c.src.trim() === '') {
      return pair.angle
        ? fail('That vector is missing a component — write both, e.g. <3, 4>', pair.at)
        : fail('That point is missing a coordinate — write both, e.g. (1, 2)', pair.at)
    }
  }
  return [x, y]
}

/** Read the run of pairs and joining words that follows the head. */
function scanItems(src: string, from: number): Item[] | Fail {
  const items: Item[] = []
  let i = from
  while (i < src.length) {
    const c = src[i]
    if (c === undefined) break
    if (/\s/.test(c) || c === ',') {
      i++
      continue
    }
    if (c === '(' || c === '<') {
      const close = c === '(' ? matchParen(src, i) : matchAngle(src, i)
      if (close < 0) {
        return fail(
          `Missing closing '${c === '(' ? ')' : '>'}' for the '${c}' at position ${i}`,
          i,
        )
      }
      const inner = src.slice(i + 1, close)
      const split = splitPair(inner, i + 1, { angle: c === '<', at: i })
      if (isFail(split)) return split
      items.push({ angle: c === '<', x: split[0], y: split[1], at: i, end: close + 1 })
      i = close + 1
      continue
    }
    if (/[A-Za-z]/.test(c)) {
      const word = /^[A-Za-z]+/.exec(src.slice(i))![0]
      const lower = word.toLowerCase()
      if (JOINERS.has(lower)) {
        items.push({ joiner: lower as 'to' | 'from', at: i })
        i += word.length
        continue
      }
      if (lower in KEYWORDS) {
        return fail(
          `'${word}' comes first — write ${lower} before the points, e.g. ${lower} (0, 0) (3, 4)`,
          i,
        )
      }
      return fail(
        `Unexpected '${word}' at position ${i} — points are written in brackets, e.g. (1, 2)`,
        i,
      )
    }
    if (c === ')' || c === '>') {
      return fail(`Unexpected '${c}' at position ${i} — nothing here opens it`, i)
    }
    return fail(`Unexpected '${c}' at position ${i} — write points as (1, 2)`, i)
  }
  return items
}

// ----------------------------------------------------------------------------
// The head: an optional keyword, an optional name
// ----------------------------------------------------------------------------

interface Head {
  keyword?: Keyword
  name?: string
}

/** Parse "", "point", "P =", "segment AB =", "P" (from "P(1,2)"). */
function parseHead(head: string, src: string): Head | Fail {
  const toks: { text: string; at: number }[] = []
  const re = /[A-Za-z]+|=|[^\sA-Za-z=]+/g
  let m: RegExpExecArray | null
  while ((m = re.exec(head))) toks.push({ text: m[0], at: m.index })

  const giveUp = (): Fail =>
    head.includes('=')
      ? fail(CURVE_MSG, firstNonSpace(src))
      : fail(START_HINT, firstNonSpace(head))

  let k = 0
  const out: Head = {}
  const first = toks[k]
  if (first && /^[A-Za-z]+$/.test(first.text) && first.text.toLowerCase() in KEYWORDS) {
    out.keyword = KEYWORDS[first.text.toLowerCase()]
    k++
  }
  // "segment from (0,0) to (3,4)" — the joiner belongs to the points, not here.
  if (toks[k] && JOINERS.has(toks[k].text.toLowerCase())) k++
  else {
    const nameTok = toks[k]
    if (nameTok && /^[A-Za-z]+$/.test(nameTok.text)) {
      const named = toks[k + 1] && toks[k + 1].text === '='
      // Without '=', the only naming form is "P(1, 2)": one letter, no word.
      if (!named && !out.keyword && nameTok.text.length > 1) return giveUp()
      out.name = nameTok.text
      k++
      if (named) k++
    }
  }
  if (k !== toks.length) return giveUp()
  if (!out.keyword && !out.name && head.trim() !== '') return giveUp()
  return out
}

// ----------------------------------------------------------------------------
// Coordinates: compiled once, sharing one param vector
// ----------------------------------------------------------------------------

/** A compiled coordinate: give it the shape's params, get a number. */
interface Compiled {
  at: (params: readonly number[]) => number
  latex: string
}

class Params {
  names: string[] = []
  private index = new Map<string, number>()

  slot(name: string): number {
    let i = this.index.get(name)
    if (i === undefined) {
      i = this.names.length
      this.index.set(name, i)
      this.names.push(name)
    }
    return i
  }
}

/**
 * Compile one coordinate. Free single-letter constants (and 't') are
 * registered as sliders on the shared `params` registry, so the same letter in
 * two different coordinates is one slider.
 */
function compileCoord(c: Coord, params: Params): Compiled | Fail {
  if (c.src.trim() === '') return fail('That coordinate is empty — write a number, e.g. (1, 2)', c.at)

  const compiled = compileExpr(c.src)
  if (!compiled.ok) {
    return fail(
      shift(compiled.error, c.at),
      compiled.pos === undefined ? undefined : compiled.pos + c.at,
    )
  }
  const { ev, latex, vars, paramNames } = compiled.expr

  // A shape has no running variable: the plotting names are refused here.
  for (const v of vars) {
    if (v === 't') continue
    const where = locate(c.src, v)
    return fail(
      `A shape's coordinates are fixed values — ${VAR_LABEL[v] ?? `'${v}'`} isn't available here; use a number or a constant like a`,
      where < 0 ? c.at : c.at + where,
    )
  }
  const usesT = vars.includes('t')

  // Order the free names by where they actually appear, so the sliders come
  // out in the order the teacher reads them.
  const free = usesT ? [...paramNames, 't'] : [...paramNames]
  free.sort((a, b) => locate(c.src, a) - locate(c.src, b))
  for (const name of free) params.slot(name)

  // localIdx -> global slot, resolved once; makeShape does no name lookup.
  const remap = paramNames.map((n) => params.slot(n))
  const tSlot = usesT ? params.slot('t') : -1
  const local = new Array<number>(remap.length)

  return {
    latex,
    at(all: readonly number[]): number {
      for (let i = 0; i < remap.length; i++) local[i] = all[remap[i]] ?? NaN
      return ev(local, tSlot < 0 ? 0 : all[tSlot] ?? NaN, 0)
    },
  }
}

// ----------------------------------------------------------------------------
// LaTeX
// ----------------------------------------------------------------------------

/** "(1, 2)" — the spaced form used for a lone point. */
const texPoint = (p: [Compiled, Compiled]): string => `(${p[0].latex}, ${p[1].latex})`
/** "(0,0)" — the tight form used in lists and segments. */
const texTight = (p: [Compiled, Compiled]): string => `(${p[0].latex},${p[1].latex})`

// ----------------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------------

export function parseShape(src: string): ShapeOutcome {
  if (!src || src.trim() === '') return fail('Empty shape')

  // An equation whose right side is a formula rather than points is a curve,
  // however it is named: "y = x", "f(x) = x^2", "r = 2cos(θ)".
  const eq = src.indexOf('=')
  if (eq >= 0) {
    const rest = src.slice(eq + 1)
    const lead = rest[firstNonSpace(rest)]
    if (rest.trim() !== '' && lead !== '(' && lead !== '<') {
      return fail(CURVE_MSG, firstNonSpace(src))
    }
  }

  // Everything up to the first bracket is the head; the rest is points.
  const open = (() => {
    const p = src.indexOf('(')
    const a = src.indexOf('<')
    return p < 0 ? a : a < 0 ? p : Math.min(p, a)
  })()
  if (open < 0) {
    const stray = /[)>]/.exec(src)
    if (stray) {
      return fail(
        `Unexpected '${stray[0]}' at position ${stray.index} — nothing here opens it`,
        stray.index,
      )
    }
    const lead = /^\s*([A-Za-z]+)/.exec(src)
    const kw = lead ? KEYWORDS[lead[1].toLowerCase()] : undefined
    if (kw) {
      return fail(
        `A ${kw.word} needs coordinates — write them in brackets, e.g. ${kw.eg}`,
        firstNonSpace(src),
      )
    }
    return fail(src.includes('=') ? CURVE_MSG : START_HINT, firstNonSpace(src))
  }

  const head = parseHead(src.slice(0, open), src)
  if (isFail(head)) return head

  const items = scanItems(src, open)
  if (isFail(items)) return items

  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    if (!isPair(it) && !(items[i + 1] && isPair(items[i + 1]))) {
      return fail(`'${it.joiner}' has to be followed by a point, e.g. ${it.joiner} (1, 1)`, it.at)
    }
  }

  const pairs = items.filter(isPair)
  if (pairs.length === 0) return fail(START_HINT, firstNonSpace(src))

  // ---- what kind of shape is this? ---------------------------------------
  const angles = pairs.filter((p) => p.angle)
  let kind: Kind
  if (head.keyword) {
    kind = head.keyword.kind
    if (angles.length > 0 && kind !== 'vector') {
      return fail(
        `Angle brackets make a vector — write a ${head.keyword.word === 'point' ? 'point' : 'vertex'} as (1, 2)`,
        angles[0].at,
      )
    }
  } else if (angles.length > 0) {
    kind = 'vector'
  } else {
    kind = pairs.length === 1 ? 'point' : pairs.length === 2 ? 'segment' : 'polygon'
  }
  if (angles.length > 1) {
    return fail('A vector has one pair of components — write <3, 4> once', angles[1].at)
  }

  // ---- compile every coordinate on a shared slider registry ---------------
  const params = new Params()
  const pts: [Compiled, Compiled][] = []
  for (const p of pairs) {
    const x = compileCoord(p.x, params)
    if (isFail(x)) return x
    const y = compileCoord(p.y, params)
    if (isFail(y)) return y
    pts.push([x, y])
  }

  const name = head.name
  const built = build(kind, head.keyword, name, items, pairs, pts)
  if (isFail(built)) return built

  return {
    ok: true,
    kind,
    latex: built.latex,
    paramNames: params.names,
    defaultParams: params.names.map(() => 1),
    makeShape: built.make,
  }
}

// ----------------------------------------------------------------------------
// Assembly, per kind
// ----------------------------------------------------------------------------

interface Built {
  latex: string
  make: (id: string, params: number[], color: string) => Shape
}

function build(
  kind: Kind,
  keyword: Keyword | undefined,
  name: string | undefined,
  items: Item[],
  pairs: Pair[],
  pts: [Compiled, Compiled][],
): Built | Fail {
  const at = (i: number, params: readonly number[]): Vec2 => ({
    x: pts[i][0].at(params),
    y: pts[i][1].at(params),
  })

  switch (kind) {
    case 'point': {
      if (pairs.length > 1) {
        return fail('A point is one pair of coordinates — for two, say segment', pairs[1].at)
      }
      if (!keyword && name && name.length > 1) {
        return fail(
          `'${name}' names ${name.length} vertices but there is only one point — a point takes one letter, e.g. P = (1, 2)`,
          0,
        )
      }
      const body = texPoint(pts[0])
      const latex = name ? `${name} = ${body}` : body
      return {
        latex,
        make: (id, params, color) => {
          const shape: Shape = { kind: 'point', id, at: at(0, params), color, visible: true }
          if (name) shape.label = name
          return shape
        },
      }
    }

    case 'segment': {
      if (pairs.length < 2) {
        return fail(
          'A segment needs two points, e.g. segment (0, 0) (3, 4)',
          pairs[pairs.length - 1].end,
        )
      }
      if (pairs.length > 2) {
        return fail('A segment has just two points — for more, say polygon', pairs[2].at)
      }
      let labels: [string, string] | undefined
      if (name) {
        if (name.length !== 2) {
          return fail(
            name.length > 2
              ? `'${name}' names ${name.length} vertices but you gave 2 points`
              : `'${name}' names one vertex but a segment has two — name it with two letters, e.g. AB`,
            0,
          )
        }
        labels = [name[0], name[1]]
      }
      const body = `${texTight(pts[0])}\\to${texTight(pts[1])}`
      const latex = labels ? `\\overline{${name}}: ${body}` : `\\text{segment }${body}`
      return {
        latex,
        make: (id, params, color) => {
          const shape: Shape = {
            kind: 'segment',
            id,
            a: at(0, params),
            b: at(1, params),
            color,
            visible: true,
          }
          if (labels) shape.labels = labels
          return shape
        },
      }
    }

    case 'vector': {
      if (pairs.length > 2) {
        return fail('A vector is a tail and a tip — that is more than two points', pairs[2].at)
      }
      const angle = pairs.find((p) => p.angle)
      // Which pair (if any) is the tail?
      let tailIdx = -1
      let tipIdx = -1
      if (angle) {
        const rest = pairs.filter((p) => !p.angle)
        if (rest.length > 0) {
          const k = items.indexOf(rest[0])
          const before = items[k - 1]
          if (!before || !('joiner' in before) || before.joiner !== 'from') {
            return fail(
              "Write 'from' before the tail, e.g. v = <3, 4> from (1, 1)",
              rest[0].at,
            )
          }
          tailIdx = pairs.indexOf(rest[0])
        }
      } else if (pairs.length === 2) {
        tailIdx = 0
        tipIdx = 1
      }
      const compIdx = angle ? pairs.indexOf(angle) : tipIdx >= 0 ? -1 : 0

      // Components: "\vec{v} = \langle 3, 4 \rangle" (+ the tail when given).
      // Tail-and-tip: there is no component expression to print, so the arrow
      // between the two points is the notation — "\vec{v}: (1,1)\to(4,5)".
      const latex =
        compIdx >= 0
          ? `${name ? `\\vec{${name}} = ` : ''}\\langle ${pts[compIdx][0].latex}, ${pts[compIdx][1].latex} \\rangle${
              tailIdx >= 0 ? `\\text{ from }${texTight(pts[tailIdx])}` : ''
            }`
          : `${name ? `\\vec{${name}}: ` : '\\text{vector }'}${texTight(pts[tailIdx])}\\to${texTight(pts[tipIdx])}`

      return {
        latex,
        make: (id, params, color) => {
          const tail: Vec2 = tailIdx >= 0 ? at(tailIdx, params) : { x: 0, y: 0 }
          const v: Vec2 =
            compIdx >= 0
              ? at(compIdx, params)
              : { x: at(tipIdx, params).x - tail.x, y: at(tipIdx, params).y - tail.y }
          const shape: Shape = { kind: 'vector', id, tail, v, color, visible: true }
          if (name) shape.label = name
          return shape
        },
      }
    }

    case 'polygon': {
      const want = keyword?.vertices
      if (want !== undefined && pairs.length !== want) {
        return fail(
          `A ${keyword!.word} has exactly ${want} vertices — you gave ${pairs.length}`,
          pairs.length > want ? pairs[want].at : pairs[pairs.length - 1].end,
        )
      }
      if (pairs.length < 3) {
        return fail(
          'A polygon needs at least three points, e.g. polygon (0, 0) (4, 0) (4, 3)',
          pairs[pairs.length - 1].end,
        )
      }
      let labels: string[] | undefined
      if (name) {
        if (name.length !== pairs.length) {
          return fail(
            `'${name}' names ${name.length} vertices but you gave ${pairs.length} points`,
            0,
          )
        }
        labels = [...name]
      }
      const body = pts.map(texTight).join(',')
      const heading = labels
        ? labels.length === 3
          ? `\\triangle ${name}`
          : `${name}`
        : `\\text{${keyword?.word ?? 'polygon'}}`
      const latex = `${heading}: ${body}`
      return {
        latex,
        make: (id, params, color) => {
          const shape: Shape = {
            kind: 'polygon',
            id,
            pts: pts.map((_p, i) => at(i, params)),
            color,
            visible: true,
            fill: false,
          }
          if (labels) shape.labels = labels
          return shape
        },
      }
    }
  }
}
