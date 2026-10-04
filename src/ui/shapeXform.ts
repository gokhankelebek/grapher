// ============================================================================
// src/ui/shapeXform.ts — transformations of shapes as the BOARD holds them.
//
// An image is an ordinary shape on the board (a point, segment or polygon
// with its own card, colour, measurements) whose BoardShape.xform says
//
//   of     the pre-image's id
//   op     the transformation, every parameter as typed ("90", "1/2", "y = x")
//   aids   which construction marks it draws (absent: the op's default)
//
// and nothing else. Its vertices, its primed names (A′B′C′, then A″B″C″ for
// an image of an image), its mapping rule and its "preserved" checks are
// recomputed from the pre-image on every change — which is why dragging A
// moves A′ and A″ with it, and why a reopened document is a live figure.
//
// Also here: the symmetry overlay of a polygon, and the "compare two
// figures" readout. Everything mathematical is src/core/transform2d.ts.
//
// Pure: no React, no DOM, no canvas.
// ============================================================================

import type { Shape, ShapeAidsDraw, ShapeImageInfo, Vec2, XformAid, XformOp } from '../core/types'
import { XFORM_AIDS } from '../core/types'
import type { BoardShape, ShapeXform } from '../core/persist'
import type { FigureComparison, Motion, Notation, PreservedCheck, Rule, SymmetryReport } from '../core/transform2d'
import {
  applyMotion,
  centreName,
  classifyAffine,
  compareFigures,
  composeMotions,
  degreeText,
  figureNames,
  mirrorFrame,
  mirrorText,
  motionAffine,
  motionName,
  motionRule,
  motionWords,
  numForm,
  pointForm,
  preservedChecks,
  primeName,
  primeTex,
  siblingName,
  symmetryOf,
} from '../core/transform2d'
import { opCommand, resolveOp } from '../core/parse/xform'
import { pointText } from '../core/geometry'

// ---------------------------------------------------------------------------
// Aids
// ---------------------------------------------------------------------------

/** The aid a transformation draws when nobody has chosen. */
export function defaultAids(t: XformOp['t']): XformAid[] {
  switch (t) {
    case 'translate':
      return ['vector']
    case 'reflect':
      return ['mirror']
    case 'rotate':
      return ['arc']
    case 'dilate':
      return ['rays']
  }
}

/** The aids a kind of transformation can draw at all, in display order. */
export function aidChoices(t: XformOp['t']): { aid: XformAid; label: string; hint: string }[] {
  const paths = { aid: 'paths' as const, label: 'Vertex paths', hint: 'Dashed lines from each vertex to its image' }
  switch (t) {
    case 'translate':
      return [{ aid: 'vector', label: 'Vector', hint: 'The translation vector, from a vertex to its image' }, paths]
    case 'reflect':
      return [{ aid: 'mirror', label: 'Mirror line', hint: 'The line of reflection, with its equation' }, paths]
    case 'rotate':
      return [{ aid: 'arc', label: 'Rotation arc', hint: 'The centre and the arc a vertex turns through, with its angle' }, paths]
    case 'dilate':
      return [{ aid: 'rays', label: 'Rays', hint: 'Rays from the centre through each vertex and its image' }, paths]
  }
}

export function aidsOf(x: ShapeXform): XformAid[] {
  return x.aids ?? defaultAids(x.op.t)
}

/** The link with these aids on — written only when they differ from the default. */
export function withAids(x: ShapeXform, aids: readonly XformAid[]): ShapeXform {
  const def = defaultAids(x.op.t)
  const same = aids.length === def.length && def.every((a) => aids.includes(a))
  const { aids: _old, ...rest } = x
  return same ? rest : { ...rest, aids: XFORM_AIDS.filter((a) => aids.includes(a)) }
}

// ---------------------------------------------------------------------------
// A shape's vertices and names, whatever its kind
// ---------------------------------------------------------------------------

/** The vertices of a point, segment or polygon; null for anything else. */
export function shapePoints(s: Shape): Vec2[] | null {
  switch (s.kind) {
    case 'point':
      return [s.at]
    case 'segment':
      return [s.a, s.b]
    case 'polygon':
      return [...s.pts]
    default:
      return null
  }
}

/** The labels a shape carries (its typed names), or null. */
export function shapeLabels(s: Shape): string[] | null {
  switch (s.kind) {
    case 'point':
      return s.label ? [s.label] : null
    case 'segment':
      return s.labels ? [...s.labels] : null
    case 'polygon':
      return s.labels ? [...s.labels] : null
    default:
      return null
  }
}

/** Can this shape be transformed (or compared)? Points, segments and polygons. */
export const transformable = (kind: Shape['kind'] | null): boolean =>
  kind === 'point' || kind === 'segment' || kind === 'polygon'

/** "△ABC", "ABCD", "AB", "P" — or "the triangle" when it has no names. */
export function figureLabel(s: Shape): string {
  const pts = shapePoints(s) ?? []
  const names = shapeLabels(s)
  if (names) {
    const joined = names.join('')
    if (s.kind === 'polygon' && pts.length === 3) return `△${joined}`
    if (s.kind === 'segment') return `segment ${joined}`
    if (s.kind === 'point') return `point ${joined}`
    return joined
  }
  if (s.kind === 'point') return 'the point'
  if (s.kind === 'segment') return 'the segment'
  return pts.length === 3 ? 'the triangle' : 'the polygon'
}

/** The name a typed command uses for this shape: "ABC", "P", or its kind. */
export function commandTarget(s: Shape): string {
  const names = shapeLabels(s)
  if (names) return names.join('')
  return s.kind === 'polygon' ? ((shapePoints(s) ?? []).length === 3 ? 'triangle' : 'polygon') : s.kind
}

function figureTex(s: Shape, names: readonly string[] | null): string {
  const pts = shapePoints(s) ?? []
  if (!names) return `\\text{${s.kind === 'polygon' ? (pts.length === 3 ? 'triangle' : 'polygon') : s.kind}}`
  const j = names.map(primeTex).join('')
  if (s.kind === 'polygon' && pts.length === 3) return `\\triangle ${j}`
  if (s.kind === 'segment') return `\\overline{${j}}`
  return j
}

// ---------------------------------------------------------------------------
// Building an image
// ---------------------------------------------------------------------------

/** Everything an image's card states, worked out once per compile. */
export interface XformReport {
  parentId: string
  motion: Motion
  /** Every motion from the first figure to this image, in order. */
  motions: Motion[]
  /** R_{90°, O} */
  name: Notation
  rule: Rule
  /** "a rotation of 90° counterclockwise about the origin" */
  words: string
  rigid: boolean
  preservesOrientation: boolean
  /** "rigid motion (an isometry)" / "not rigid: a dilation with scale factor 1/2" */
  rigidText: string
  checks: PreservedCheck[]
  pre: Vec2[]
  post: Vec2[]
  /** The pre-image's vertex names and the image's (A, B, C → A′, B′, C′). */
  names: string[]
  primes: string[]
  /** "△ABC", "△A′B′C′" */
  preName: string
  imageName: string
  /** The image's vertices, exactly: "A′(−2, 1)". */
  vertexTexts: string[]
  /** For an image of an image: the whole chain from the first figure. */
  chain: {
    rootName: string
    name: Notation
    rule: Rule
    /** What the chain amounts to, in one motion (when it is one). */
    single: string | null
    rigid: boolean
  } | null
}

/** The CompiledShape-side outcome of building one image. */
export interface BuiltImage {
  shape: Shape | null
  latex: string
  error: string | null
  report: XformReport | null
}

/**
 * The image of `parent` under `img.xform`, as a shape of the same kind:
 * vertices mapped, names primed, drawn dashed, with its aids.
 *
 * `chainOf(parentId)` returns the parent's own report when it is an image
 * too, so the chain back to the first figure can be composed.
 */
export function buildImage(
  img: BoardShape,
  parent: Shape | null,
  named: ReadonlyMap<string, Vec2>,
  parentReport: XformReport | null,
  /** Vertex names already on the board: a second image of ABC is A″B″C″, not another A′B′C′. */
  taken: ReadonlySet<string> = new Set(),
): BuiltImage {
  const x = img.xform!
  const fail = (error: string): BuiltImage => ({ shape: null, latex: img.src, error, report: null })
  if (!parent) return fail('the figure it is the image of is not on the board any more')
  const pre = shapePoints(parent)
  if (!pre || pre.length === 0) return fail('only a point, a segment or a polygon can be transformed')
  if (!pre.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))) return fail('the figure it is the image of cannot be drawn')
  const resolved = resolveOp(x.op, named)
  if ('error' in resolved) return fail(resolved.error)
  const motion = resolved.motion
  const post = pre.map((p) => applyMotion(motion, p))

  const labels = shapeLabels(parent)
  const names = figureNames(pre.length, labels)
  // one more prime than the pre-image; the n-th image of the same figure is
  // told apart by its number (A′₂), never by an extra prime (A″ is the image of A′)
  const plain = names.map(primeName)
  let primes = plain.map((p) => siblingName(p, x.n ?? 1))
  for (let k = Math.max(2, (x.n ?? 1) + 1); k < 100 && primes.some((p) => taken.has(p)); k++) {
    primes = plain.map((p) => siblingName(p, k))
  }
  const imageLabels = labels ? primes : null
  const name = motionName(motion)
  const rule = motionRule(motion)
  const words = motionWords(motion)
  const cls = classifyAffine(motionAffine(motion))
  const rigidText = cls.rigid
    ? `Rigid motion (an isometry): distances and angles are preserved; orientation is ${cls.preservesOrientation ? 'kept' : 'reversed'}.`
    : `Not rigid: every length is multiplied by ${numForm(cls.scale).text}. Angles are preserved, so the image is similar, not congruent.`

  const base = { id: img.id, color: img.color, visible: img.visible, dashed: true }
  const aidsOn = aidsOf(x)
  const aids = aidsDraw(motion, pre, post, aidsOn)
  const preName = figureLabel(parent)
  let shape: Shape
  if (parent.kind === 'point') {
    shape = { ...base, kind: 'point', at: post[0], ...(imageLabels ? { label: imageLabels[0] } : {}) }
  } else if (parent.kind === 'segment') {
    shape = { ...base, kind: 'segment', a: post[0], b: post[1], ...(imageLabels ? { labels: [imageLabels[0], imageLabels[1]] as [string, string] } : {}) }
  } else {
    shape = { ...base, kind: 'polygon', pts: post, fill: img.fill === true, ...(imageLabels ? { labels: imageLabels } : {}) }
  }
  const imageName = figureLabel(shape)
  if (aids) (shape as Extract<Shape, { kind: 'polygon' }>).aids = aids
  const info: ShapeImageInfo = { of: preName, name: imageName, words, notation: name.text, rule: rule.text }
  ;(shape as Extract<Shape, { kind: 'polygon' }>).image = info

  let chain: XformReport['chain'] = null
  const motions = parentReport ? [...parentReport.motions, motion] : [motion]
  if (parentReport) {
    const comp = composeMotions(motions)
    chain = {
      rootName: parentReport.chain?.rootName ?? parentReport.preName,
      name: comp.name,
      rule: comp.rule,
      single: comp.singleWords,
      rigid: comp.rigid,
    }
  }

  const report: XformReport = {
    parentId: x.of,
    motion,
    motions,
    name,
    rule,
    words,
    rigid: cls.rigid,
    preservesOrientation: cls.preservesOrientation,
    rigidText,
    checks: preservedChecks(pre, post, names, primes, motion),
    pre,
    post,
    names,
    primes,
    preName,
    imageName,
    // exact where it is; a rounded vertex says so: "A′ ≈ (4.181, 3.137)"
    vertexTexts: post.map((p, i) => {
      const f = pointForm(p)
      return f.exact ? `${primes[i]}${pointText(p).text}` : `${primes[i]} ${f.text}`
    }),
    chain,
  }
  const latex = `${figureTex(shape, imageLabels)} = ${name.tex}\\left(${figureTex(parent, labels)}\\right)`
  return { shape, latex, error: null, report }
}

/** The construction marks for one image, as the renderer draws them. */
export function aidsDraw(m: Motion, pre: readonly Vec2[], post: readonly Vec2[], on: readonly XformAid[]): ShapeAidsDraw | null {
  const out: ShapeAidsDraw = {}
  if (on.includes('paths')) out.paths = pre.map((p, i) => [p, post[i]] as const)
  if (m.kind === 'reflect' && on.includes('mirror')) {
    const fr = mirrorFrame(m.line)
    out.mirror = { through: fr.p, dir: fr.u, label: mirrorText(m.line).text }
  }
  if (m.kind === 'rotate') {
    out.center = { at: m.center, label: centreName(m.center).text }
    if (on.includes('arc')) {
      // the arc a vertex turns through: the vertex farthest from the centre
      let i = 0
      let best = -1
      pre.forEach((p, k) => {
        const d = Math.hypot(p.x - m.center.x, p.y - m.center.y)
        if (d > best + 1e-12) {
          best = d
          i = k
        }
      })
      out.arc = { center: m.center, from: pre[i], to: post[i], deg: m.deg, label: degreeText(m.deg).text }
    }
  }
  if (m.kind === 'dilate') {
    out.center = { at: m.center, label: centreName(m.center).text }
    if (on.includes('rays')) {
      out.rays = pre.map((p) => {
        // the stretch of the line through the centre that holds the centre, P and P′
        const u = { x: p.x - m.center.x, y: p.y - m.center.y }
        const L2 = u.x * u.x + u.y * u.y
        if (!(L2 > 0)) return [m.center, m.center] as const
        const t = [0, 1, m.k]
        const lo = Math.min(...t)
        const hi = Math.max(...t)
        const at = (s: number): Vec2 => ({ x: m.center.x + u.x * s, y: m.center.y + u.y * s })
        return [at(lo), at(hi)] as const
      })
    }
  }
  if (m.kind === 'translate' && on.includes('vector') && pre.length > 0) {
    const v = numForm(m.v.x)
    const w = numForm(m.v.y)
    out.vector = { tail: pre[0], v: m.v, label: `⟨${v.text}, ${w.text}⟩` }
  }
  return Object.keys(out).length > 0 ? out : null
}

// ---------------------------------------------------------------------------
// Symmetry overlay
// ---------------------------------------------------------------------------

/** A polygon's symmetry, and what its overlay draws. */
export function symmetryAids(s: Shape): { report: SymmetryReport | null; aids: ShapeAidsDraw | null } {
  if (s.kind !== 'polygon') return { report: null, aids: null }
  const report = symmetryOf(s.pts, s.labels)
  if (!report) return { report: null, aids: null }
  const turns = report.order > 1 ? `order ${report.order} (${report.angles.map((a) => degreeText(a).text).join(', ')})` : 'no rotation symmetry'
  return {
    report,
    aids: {
      symLines: report.lines.map((l) => ({ through: l.through, dir: l.dir })),
      symText: { at: report.center, text: `${report.lines.length === 0 ? 'no lines' : report.lines.length === 1 ? '1 line' : `${report.lines.length} lines`} · ${turns}` },
    },
  }
}

// ---------------------------------------------------------------------------
// Compare two figures
// ---------------------------------------------------------------------------

export interface CompareChoice {
  id: string
  label: string
}

export interface CompareCardData {
  choices: CompareChoice[]
  /** The other figure chosen, or null. */
  with: string | null
  result: FigureComparison | null
  /** Its label, "△A″B″C″". */
  withLabel: string | null
  /** Why there is nothing to compare: no other figure of a comparable kind. */
  empty: string | null
}

/** The comparison a card makes with the figure it has chosen. */
export function compareCard(
  self: Shape,
  selfId: string,
  others: readonly { id: string; shape: Shape | null }[],
  withId: string | undefined,
): CompareCardData {
  const choices: CompareChoice[] = []
  for (const o of others) {
    if (o.id === selfId || !o.shape) continue
    if (o.shape.kind !== self.kind) continue
    if (self.kind === 'point') continue
    choices.push({ id: o.id, label: figureLabel(o.shape) })
  }
  const other = withId ? others.find((o) => o.id === withId)?.shape ?? null : null
  let result: FigureComparison | null = null
  if (other && other.kind === self.kind) {
    const P = shapePoints(self) ?? []
    const Q = shapePoints(other) ?? []
    result = compareFigures(P, Q, shapeLabels(self), shapeLabels(other))
  }
  return {
    choices,
    with: other ? withId ?? null : null,
    result,
    withLabel: other ? figureLabel(other) : null,
    empty: choices.length === 0 ? `Add another ${self.kind === 'segment' ? 'segment' : 'polygon'} to compare this one with.` : null,
  }
}

// ---------------------------------------------------------------------------
// Creating an image
// ---------------------------------------------------------------------------

/** The line an image reads as on its card and in the legend. */
export function imageSrc(op: XformOp, parent: Shape | null): string {
  return opCommand(op, parent ? commandTarget(parent) : 'figure')
}

/**
 * The number a new image of `parentId` gets among that figure's images: the
 * smallest not in use (1 is the first, unnumbered). `self` is left out (an
 * image being moved to this figure).
 */
export function imageNumber(shapes: readonly BoardShape[], parentId: string, self: string | null): number {
  const used = new Set(shapes.filter((s) => s.id !== self && s.xform?.of === parentId).map((s) => s.xform!.n ?? 1))
  let n = 1
  while (used.has(n)) n++
  return n
}

/** The shapes that depend on these (images of them, images of those …). */
export function imageDependents(shapes: readonly BoardShape[], ids: readonly string[]): Set<string> {
  const dead = new Set(ids)
  let grew = true
  while (grew) {
    grew = false
    for (const s of shapes) {
      if (!dead.has(s.id) && s.xform && dead.has(s.xform.of)) {
        dead.add(s.id)
        grew = true
      }
    }
  }
  for (const id of ids) dead.delete(id)
  return dead
}

/** Which shape a typed name means: "ABC", "A′B′C′", "P", "AB". */
export function shapeByName(
  name: string,
  list: readonly { id: string; shape: Shape | null }[],
): string | null {
  const want = name.replace(/^△\s*/, '')
  for (const { id, shape } of list) {
    if (!shape) continue
    const labels = shapeLabels(shape)
    if (labels && labels.join('') === want) return id
  }
  return null
}

/**
 * Which figure a RETYPED image line is of: the named figure (another
 * pre-image), or its own pre-image when the line names it as it is already
 * called ("ABC", or "triangle" when it has no names). Any other name is an
 * error — "rotate XYZ …" with no XYZ on the board is a typo, and silently
 * keeping ABC (and rewriting the line to say ABC) would hide it.
 */
export function retargetImage(
  target: string,
  list: readonly { id: string; shape: Shape | null }[],
  selfId: string,
  parentId: string,
): { of: string | undefined } | { error: string } {
  const named = shapeByName(target, list)
  if (named === selfId) return { error: 'A figure cannot be the image of itself' }
  if (named) return { of: named }
  const parent = list.find((x) => x.id === parentId)?.shape ?? null
  const own = parent ? commandTarget(parent) : null
  if (own !== null && target.replace(/^△\s*/, '') === own) return { of: undefined }
  return { error: `There is no figure named ${target} on the board — this is the image of ${own ?? 'a figure that is not on the board'}` }
}
