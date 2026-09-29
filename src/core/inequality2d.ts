// ============================================================================
// src/core/inequality2d.ts — a two-variable inequality as a REGION.
//
// The parser (src/core/parse/index.ts) reads y < x² − 4 into parts, each
// "s(x, y) > 0" with a boundary and a side (types.ts InequalityInfo). This
// module turns parts into what the board and the card need:
//
//   regionPolygons   the region (one part, a compound band, or a whole system
//                    — the intersection is just more parts) as polygons in
//                    math coords, built from per-column spans: y-parts give a
//                    span per column exactly (f(x) to ±∞), x-parts clip the
//                    columns' x-range exactly, implicit parts are sampled
//                    down the column with every sign change bisected. A run
//                    of columns with the same number of spans becomes one
//                    polygon per span, so an explicit boundary shades with a
//                    smooth edge and the whole region fills in ONE path;
//   contourPolylines F(x, y) = 0 as marching squares whose segments are
//                    CHAINED into polylines, so a dashed x² + y² = 9 is one
//                    dashed circle and not four hundred restarted dashes;
//   pointVerdict / testSentence
//                    "(1, 2): 2 < 1² − 4 → 2 < −3 ✗" — the typed chain with
//                    the numbers substituted, then evaluated;
//   describeInequality
//                    the card's words: which side is shaded, whether the
//                    boundary is dashed, and the classic origin test.
//
// Nothing here draws and nothing here is cached; src/render/inequalities.ts
// caches per viewport.
// ============================================================================

import type { IneqPart, IneqRel, InequalityInfo, Vec2 } from './types'
import { fmtNum, prettyMath, substitute } from './ineqText'
import { isReservedWord } from './parse'

export interface Box {
  x0: number
  x1: number
  y0: number
  y1: number
}

const REL_TEXT: Record<IneqRel, string> = { '<': '<', '<=': '≤', '>': '>', '>=': '≥' }

// ---------------------------------------------------------------------------
// Membership
// ---------------------------------------------------------------------------

/** Where (x, y) is with respect to one part: inside, outside, or on its boundary. */
export function partAt(part: IneqPart, x: number, y: number): 'in' | 'out' | 'on' {
  let v: number
  try {
    v = part.s(x, y)
  } catch {
    return 'out'
  }
  if (!Number.isFinite(v)) return 'out'
  if (Math.abs(v) <= 1e-9 * (1 + Math.abs(x) + Math.abs(y))) return 'on'
  return v > 0 ? 'in' : 'out'
}

/** True when (x, y) satisfies every part (a boundary point counts when not strict). */
export function holdsAt(parts: readonly IneqPart[], x: number, y: number): boolean {
  for (const p of parts) {
    const w = partAt(p, x, y)
    if (w === 'out' || (w === 'on' && p.strict)) return false
  }
  return true
}

/** True when (x, y) lies on a boundary of any part. */
export function onBoundary(parts: readonly IneqPart[], x: number, y: number): boolean {
  return parts.some((p) => partAt(p, x, y) === 'on')
}

// ---------------------------------------------------------------------------
// Sentences
// ---------------------------------------------------------------------------

/** "(1, 2)", "(−0.5, 3)". */
export function pointLabel(p: Vec2): string {
  return `(${fmtNum(p.x)}, ${fmtNum(p.y)})`
}

function relHolds(rel: IneqRel, a: number, b: number): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false
  const eq = Math.abs(a - b) <= 1e-9 * (1 + Math.abs(a) + Math.abs(b))
  switch (rel) {
    case '<':
      return a < b && !eq
    case '<=':
      return a < b || eq
    case '>':
      return a > b && !eq
    case '>=':
      return a > b || eq
  }
}

export interface PointVerdict {
  /** True when the point satisfies the whole chain. */
  ok: boolean
  /** True when it sits on a boundary (equality in some part). */
  onBoundary: boolean
  /** "2 < 1² − 4" — the typed chain with the numbers in. */
  substituted: string
  /** "2 < −3" — each side evaluated. */
  evaluated: string
}

/** The typed chain at (x, y): substituted, evaluated, and whether it holds. */
export function pointVerdict(info: InequalityInfo, p: Vec2): PointVerdict {
  const vals: Record<string, number> = { x: p.x, y: p.y }
  info.paramNames.forEach((n, i) => {
    vals[n] = info.params[i]
  })
  const subs = info.terms.map((t) => prettyMath(substitute(t, vals, isReservedWord)))
  const nums = info.terms.map((_, i) => {
    try {
      return info.term(i, p.x, p.y)
    } catch {
      return Number.NaN
    }
  })
  let ok = true
  let on = false
  for (let k = 0; k < info.rels.length; k++) {
    if (!relHolds(info.rels[k], nums[k], nums[k + 1])) ok = false
    const a = nums[k]
    const b = nums[k + 1]
    if (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-9 * (1 + Math.abs(a) + Math.abs(b))) on = true
  }
  const join = (xs: string[]): string =>
    xs.map((s, i) => (i === 0 ? s : `${REL_TEXT[info.rels[i - 1]]} ${s}`)).join(' ')
  return { ok, onBoundary: on, substituted: join(subs), evaluated: join(nums.map(fmtNum)) }
}

/**
 * "(1, 2): 2 < 1² − 4 → 2 < −3 ✗". The arrow and the evaluated chain are
 * left out when substituting already says it ("(4, 0): 4 > 3 ✓").
 */
export function testSentence(info: InequalityInfo, p: Vec2): { ok: boolean; text: string } {
  const v = pointVerdict(info, p)
  const same = v.substituted.replace(/\s/g, '') === v.evaluated.replace(/\s/g, '')
  const body = same ? v.substituted : `${v.substituted} → ${v.evaluated}`
  return { ok: v.ok, text: `${pointLabel(p)}: ${body} ${v.ok ? '✓' : '✗'}` }
}

/** Where the part's region lies, in words: "above y = x² − 4". */
export function sideWords(info: InequalityInfo, part: IneqPart): string {
  const b = part.boundaryText
  switch (part.side) {
    case 'above':
      return `above ${b}`
    case 'below':
      return `below ${b}`
    case 'right':
      return `right of ${b}`
    case 'left':
      return `left of ${b}`
    case 'inside':
      return `inside ${b}`
    case 'outside':
      return `outside ${b}`
    case 'where': {
      const [i, j] = part.terms
      return `where ${prettyMath(info.terms[i])} ${REL_TEXT[info.rels[i]]} ${prettyMath(info.terms[j])}`
    }
  }
}

/** Points a test is tried at, the origin first. */
const TEST_POINTS: readonly Vec2[] = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: 1, y: 1 },
  { x: -1, y: 0 },
  { x: 0, y: -1 },
  { x: 2, y: 1 },
  { x: -1, y: -2 },
]

export interface InequalityCardText {
  /** "Shaded above y = x² − 4, boundary dashed (strict)". */
  shade: string
  /** Per boundary: its KaTeX and whether it is drawn dashed. */
  boundaries: { latex: string; text: string; dashed: boolean }[]
  /** The test-point line, or null when no simple point is off every boundary. */
  test: { point: Vec2; ok: boolean; text: string; note: string | null } | null
}

/** Everything the inequality's card says, at its current params. */
export function describeInequality(info: InequalityInfo): InequalityCardText {
  const parts = info.parts
  const sides = parts.map((p) => sideWords(info, p)).join(' and ')
  let dash: string
  if (parts.every((p) => p.strict)) dash = parts.length > 1 ? 'boundaries dashed (strict)' : 'boundary dashed (strict)'
  else if (parts.every((p) => !p.strict))
    dash = parts.length > 1 ? 'boundaries solid (included)' : 'boundary solid (included)'
  else dash = parts.map((p) => `${p.boundaryText} ${p.strict ? 'dashed' : 'solid'}`).join(', ')
  const shade = `Shaded ${sides}, ${dash}`
  const boundaries = parts.map((p) => ({ latex: p.boundaryLatex, text: p.boundaryText, dashed: p.strict }))

  let test: InequalityCardText['test'] = null
  const pt = TEST_POINTS.find((q) => !onBoundary(parts, q.x, q.y) && pointVerdict(info, q).evaluated.indexOf('undefined') < 0)
  if (pt) {
    const t = testSentence(info, pt)
    const isOrigin = pt.x === 0 && pt.y === 0
    const who = isOrigin ? 'the origin' : pointLabel(pt)
    let note: string
    if (parts.length === 1) note = t.ok ? `shade the side with ${who}` : `shade the side without ${who}`
    else note = t.ok ? `${who} is in the region` : `${who} is not in the region`
    test = {
      point: pt,
      ok: t.ok,
      text: `Test ${t.text} → ${note}`,
      note: isOrigin ? null : '(0, 0) is on the boundary, so another point is tested.',
    }
  }
  return { shade, boundaries, test }
}

// ---------------------------------------------------------------------------
// The region as polygons
// ---------------------------------------------------------------------------

type Span = [number, number]

/** Bisection on s between y = a (value va) and y = b (value vb) for s = 0. */
function bisectY(s: (x: number, y: number) => number, x: number, a: number, va: number, b: number, vb: number): number {
  if (!Number.isFinite(va) || !Number.isFinite(vb)) return (a + b) / 2
  let lo = a
  let hi = b
  let flo = va
  for (let k = 0; k < 18; k++) {
    const m = (lo + hi) / 2
    const fm = s(x, m)
    if (!Number.isFinite(fm)) return m
    if (fm >= 0 === flo >= 0) {
      lo = m
      flo = fm
    } else hi = m
  }
  return (lo + hi) / 2
}

/** The spans of one implicit part down the column at x. */
function implicitSpans(s: (x: number, y: number) => number, x: number, ys: Float64Array): Span[] {
  const out: Span[] = []
  const n = ys.length
  let start: number | null = null
  let prevV = Number.NaN
  let prevIn = false
  for (let j = 0; j < n; j++) {
    const y = ys[j]
    let v: number
    try {
      v = s(x, y)
    } catch {
      v = Number.NaN
    }
    const inside = Number.isFinite(v) && v >= 0
    if (j === 0) {
      if (inside) start = y
    } else if (inside !== prevIn) {
      const edge = bisectY(s, x, ys[j - 1], prevV, y, v)
      if (inside) start = edge
      else if (start !== null) {
        out.push([start, edge])
        start = null
      }
    }
    prevV = v
    prevIn = inside
  }
  if (start !== null) out.push([start, ys[n - 1]])
  return out
}

function intersectSpans(a: readonly Span[], b: readonly Span[]): Span[] {
  const out: Span[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    const lo = Math.max(a[i][0], b[j][0])
    const hi = Math.min(a[i][1], b[j][1])
    if (hi > lo) out.push([lo, hi])
    if (a[i][1] < b[j][1]) i++
    else j++
  }
  return out
}

export interface RegionOpts {
  /** Columns across the box (about one per 2 CSS px on screen). */
  cols: number
  /** Samples down a column for an implicit part (about one per 4 CSS px). */
  rows: number
}

/** Drop interior points of runs that are exactly collinear-flat (a clipped edge). */
function thin(pts: Vec2[]): Vec2[] {
  if (pts.length < 4) return pts
  const out: Vec2[] = [pts[0]]
  for (let i = 1; i < pts.length - 1; i++) {
    const a = out[out.length - 1]
    const b = pts[i]
    const c = pts[i + 1]
    if (a.y === b.y && b.y === c.y) continue
    out.push(b)
  }
  out.push(pts[pts.length - 1])
  return out
}

/**
 * The region where every part holds, inside `box`, as closed polygons in math
 * coords (the closing edge implicit). Empty when nothing of it is in the box.
 */
export function regionPolygons(parts: readonly IneqPart[], box: Box, opts: RegionOpts): Vec2[][] {
  if (parts.length === 0) return []
  let xl = box.x0
  let xr = box.x1
  const yParts: IneqPart[] = []
  const iParts: IneqPart[] = []
  for (const p of parts) {
    const b = p.boundary
    if (b.kind === 'x') {
      if (!Number.isFinite(b.c)) return []
      if (p.side === 'right') xl = Math.max(xl, b.c)
      else xr = Math.min(xr, b.c)
    } else if (b.kind === 'y') yParts.push(p)
    else iParts.push(p)
  }
  if (!(xr > xl)) return []
  const fullW = box.x1 - box.x0
  const n = Math.max(2, Math.min(4000, Math.round((opts.cols * (xr - xl)) / fullW)))
  const dx = (xr - xl) / n
  const rows = Math.max(8, Math.min(2000, Math.round(opts.rows)))
  const ys = new Float64Array(rows + 1)
  for (let j = 0; j <= rows; j++) ys[j] = box.y0 + ((box.y1 - box.y0) * j) / rows

  const cols: Span[][] = new Array(n)
  const xs = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const x = xl + (i + 0.5) * dx
    xs[i] = x
    let spans: Span[] = [[box.y0, box.y1]]
    for (const p of yParts) {
      if (spans.length === 0) break
      const b = p.boundary as { kind: 'y'; f: (x: number) => number }
      let f: number
      try {
        f = b.f(x)
      } catch {
        f = Number.NaN
      }
      if (Number.isNaN(f)) {
        spans = []
        break
      }
      const own: Span = p.side === 'above' ? [f, Infinity] : [-Infinity, f]
      spans = intersectSpans(spans, [[Math.max(own[0], box.y0), Math.min(own[1], box.y1)]])
    }
    for (const p of iParts) {
      if (spans.length === 0) break
      spans = intersectSpans(spans, implicitSpans(p.s, x, ys))
    }
    cols[i] = spans
  }

  const polys: Vec2[][] = []
  let a = 0
  while (a < n) {
    const k = cols[a].length
    let b = a
    while (b + 1 < n && cols[b + 1].length === k) b++
    if (k > 0) {
      const left = a === 0 ? xl : xs[a] - dx / 2
      const right = b === n - 1 ? xr : xs[b] + dx / 2
      for (let s = 0; s < k; s++) {
        const bottom: Vec2[] = [{ x: left, y: cols[a][s][0] }]
        for (let i = a; i <= b; i++) bottom.push({ x: xs[i], y: cols[i][s][0] })
        bottom.push({ x: right, y: cols[b][s][0] })
        const top: Vec2[] = [{ x: right, y: cols[b][s][1] }]
        for (let i = b; i >= a; i--) top.push({ x: xs[i], y: cols[i][s][1] })
        top.push({ x: left, y: cols[a][s][1] })
        polys.push([...thin(bottom), ...thin(top)])
      }
    }
    a = b + 1
  }
  return polys
}

// ---------------------------------------------------------------------------
// Implicit boundaries as chained contours
// ---------------------------------------------------------------------------

/**
 * F(x, y) = 0 inside `box` on an nx × ny grid, as polylines in math coords.
 * Marching squares (saddles decided by the cell centre), every crossing point
 * refined by regula falsi along its edge, and the segments CHAINED through
 * the edges they share, so each connected piece of the curve is one path.
 */
export function contourPolylines(
  F: (x: number, y: number) => number,
  box: Box,
  nx: number,
  ny: number,
): Vec2[][] {
  nx = Math.max(4, Math.min(1200, Math.round(nx)))
  ny = Math.max(4, Math.min(1200, Math.round(ny)))
  const dx = (box.x1 - box.x0) / nx
  const dy = (box.y1 - box.y0) / ny
  const W = nx + 1
  const vals = new Float64Array(W * (ny + 1))
  const safe = (x: number, y: number): number => {
    try {
      return F(x, y)
    } catch {
      return Number.NaN
    }
  }
  for (let j = 0; j <= ny; j++) {
    const y = box.y0 + j * dy
    for (let i = 0; i <= nx; i++) vals[j * W + i] = safe(box.x0 + i * dx, y)
  }
  const pts = new Map<number, Vec2>()
  const H = (i: number, j: number): number => 2 * (j * W + i)
  const V = (i: number, j: number): number => 2 * (j * W + i) + 1
  const point = (id: number): Vec2 => {
    const got = pts.get(id)
    if (got) return got
    const base = id >> 1
    const i = base % W
    const j = (base - i) / W
    const horizontal = (id & 1) === 0
    const x0 = box.x0 + i * dx
    const y0 = box.y0 + j * dy
    const x1 = horizontal ? x0 + dx : x0
    const y1 = horizontal ? y0 : y0 + dy
    let fa = vals[j * W + i]
    let fb = horizontal ? vals[j * W + i + 1] : vals[(j + 1) * W + i]
    let ta = 0
    let tb = 1
    let t = fa / (fa - fb)
    for (let k = 0; k < 3; k++) {
      const ft = safe(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)
      if (!Number.isFinite(ft) || ft === 0) break
      if (ft > 0 === fa > 0) {
        ta = t
        fa = ft
      } else {
        tb = t
        fb = ft
      }
      const nt = ta + ((tb - ta) * fa) / (fa - fb)
      if (!Number.isFinite(nt)) break
      t = nt
    }
    const p = { x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t }
    pts.set(id, p)
    return p
  }
  const segs: [number, number][] = []
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const v00 = vals[j * W + i]
      const v10 = vals[j * W + i + 1]
      const v01 = vals[(j + 1) * W + i]
      const v11 = vals[(j + 1) * W + i + 1]
      if (!Number.isFinite(v00) || !Number.isFinite(v10) || !Number.isFinite(v01) || !Number.isFinite(v11)) continue
      let code = 0
      if (v00 > 0) code |= 1
      if (v10 > 0) code |= 2
      if (v11 > 0) code |= 4
      if (v01 > 0) code |= 8
      if (code === 0 || code === 15) continue
      const B = H(i, j)
      const T = H(i, j + 1)
      const L = V(i, j)
      const R = V(i + 1, j)
      switch (code) {
        case 1:
        case 14:
          segs.push([L, B])
          break
        case 2:
        case 13:
          segs.push([B, R])
          break
        case 3:
        case 12:
          segs.push([L, R])
          break
        case 4:
        case 11:
          segs.push([T, R])
          break
        case 6:
        case 9:
          segs.push([B, T])
          break
        case 7:
        case 8:
          segs.push([L, T])
          break
        case 5:
        case 10: {
          const vc = safe(box.x0 + (i + 0.5) * dx, box.y0 + (j + 0.5) * dy)
          const centreIn = Number.isFinite(vc) && vc > 0
          // 5: v00 and v11 positive; 10: v10 and v01 positive.
          if ((code === 5) === centreIn) {
            segs.push([L, T], [B, R])
          } else {
            segs.push([L, B], [T, R])
          }
          break
        }
      }
    }
  }
  // Chain: every edge point joins at most two segments.
  const at = new Map<number, number[]>()
  segs.forEach(([p, q], k) => {
    for (const e of [p, q]) {
      const l = at.get(e)
      if (l) l.push(k)
      else at.set(e, [k])
    }
  })
  const used = new Uint8Array(segs.length)
  const lines: Vec2[][] = []
  const walk = (from: number, seg: number, out: number[]): void => {
    let cur = from
    let s = seg
    for (;;) {
      used[s] = 1
      const [p, q] = segs[s]
      const next = p === cur ? q : p
      out.push(next)
      const cands = at.get(next) ?? []
      const nxt = cands.find((c) => !used[c])
      if (nxt === undefined) return
      cur = next
      s = nxt
    }
  }
  for (let k = 0; k < segs.length; k++) {
    if (used[k]) continue
    const [p, q] = segs[k]
    const fwd: number[] = [p]
    walk(p, k, fwd)
    // Extend backwards from p when the chain did not close on itself.
    const back: number[] = []
    const cands = at.get(p) ?? []
    const b0 = cands.find((c) => !used[c])
    if (b0 !== undefined) walk(p, b0, back)
    const ids = [...back.reverse(), ...fwd]
    void q
    lines.push(ids.map(point))
  }
  return lines
}
