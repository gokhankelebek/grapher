// ============================================================================
// GRAPHER — document persistence (pure: no DOM, no storage APIs).
//
// Everything here is plain data in / plain data out so it can be unit-tested in
// node. The browser-side storage adapter lives in src/ui/storage.ts.
//
// THE CLOSURE PROBLEM: typed-expression curves reference a ModelSpec built by
// parseExpression(...).plot.makeModel(). Those are live closures and cannot be
// JSON-serialized. We persist the expression SOURCE TEXT per curve instead and
// rebuild the models on load. A source that no longer parses degrades to a
// visibly broken card rather than a vanished curve or a dead board.
// ============================================================================

import type { CurveKind, FitResult, FittedCurve, ModelSpec, Vec2 } from './types'
import { parseExpression } from './parse'

/** Bump when the on-disk shape changes in a way older readers can't handle. */
export const SCHEMA_VERSION = 1

/** Per-curve style extras that FittedCurve itself doesn't carry. */
export interface CurveStyle {
  dash?: number[]
  opacity?: number
}
export type StyleMap = Record<string, CurveStyle>

export type BoardMode = 'draw' | 'pan'

// --- defensive limits: a stored blob is untrusted input ----------------------
const MAX_CURVES = 2000
const MAX_PARAMS = 64
const MAX_CANDIDATES = 24
/** Stored stroke resolution. Keeps boards small; plenty for refit and hit tests. */
export const MAX_STORED_STROKE = 120
const MAX_STROKE_IN = 20000
const STROKE_DP = 4
const CANDIDATE_DP = 6

// ---------------------------------------------------------------- stored shape

export interface StoredCandidate {
  modelId: string
  params: number[]
  kind: CurveKind
  domain: [number, number] | null
  error: number
  score: number
}

export interface StoredCurve {
  id: string
  modelId: string
  /** Full precision on purpose: typed exact values must round-trip exactly. */
  params: number[]
  kind: CurveKind
  domain: [number, number] | null
  color: string
  strokeWidth: number
  visible: boolean
  error: number
  /** Flat [x0,y0,x1,y1,...], rounded — flat halves the JSON size vs {x,y}. */
  stroke?: number[]
  /** Present iff this curve came from a typed equation. */
  exprSource?: string
  style?: CurveStyle
  candidates?: StoredCandidate[]
}

export interface StoredBoard {
  curves: StoredCurve[]
  viewport: { cx: number; cy: number; ppu: number }
  selectedId: string | null
  mode: BoardMode
}

export interface StoredDoc {
  version: number
  id: string
  name: string
  createdAt: number
  modifiedAt: number
  board: StoredBoard
}

export interface DocMeta {
  id: string
  name: string
  createdAt: number
  modifiedAt: number
}

// ---------------------------------------------------------------- live shape

export interface BoardInput {
  curves: FittedCurve[]
  styles: StyleMap
  candidates: Map<string, FitResult[]>
  /** curveId -> the equation the user typed. */
  exprSources: Record<string, string>
  viewport: { center: Vec2; pxPerUnit: number }
  selectedId: string | null
  mode: BoardMode
}

export interface HydratedBoard {
  curves: FittedCurve[]
  styles: StyleMap
  candidates: Map<string, FitResult[]>
  /** Rebuilt from source text — the closures the board needs to render. */
  extraModels: Record<string, ModelSpec>
  exprSources: Record<string, string>
  /** curveId -> why its equation could not be rebuilt. */
  brokenExpr: Record<string, string>
  viewport: { center: Vec2; pxPerUnit: number }
  selectedId: string | null
  mode: BoardMode
  /** Highest expr_N seen, so new equations don't collide with restored ones. */
  exprCounter: number
}

export interface LoadResult {
  /** Null only when nothing at all could be salvaged. */
  meta: DocMeta | null
  board: HydratedBoard | null
  /** Human-readable notes about anything dropped or repaired. */
  problems: string[]
  /** True when the document loaded but something was lost or repaired. */
  degraded: boolean
}

// ------------------------------------------------------------------- helpers

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

const isStr = (v: unknown): v is string => typeof v === 'string'

const KINDS: readonly CurveKind[] = ['explicit', 'polar', 'parametric', 'implicit']
const isKind = (v: unknown): v is CurveKind => isStr(v) && (KINDS as readonly string[]).includes(v)

const round = (v: number, dp: number): number => {
  const f = 10 ** dp
  return Math.round(v * f) / f
}

function numArray(v: unknown, max: number, dp?: number): number[] | null {
  if (!Array.isArray(v) || v.length > max) return null
  const out: number[] = []
  for (const n of v) {
    if (!isNum(n)) return null
    out.push(dp === undefined ? n : round(n, dp))
  }
  return out
}

function domainOf(v: unknown): [number, number] | null {
  if (v === null || v === undefined) return null
  if (Array.isArray(v) && v.length === 2 && isNum(v[0]) && isNum(v[1])) return [v[0], v[1]]
  return null
}

/** Uniformly thin a stroke to at most `max` points, always keeping the ends. */
export function decimate(points: Vec2[], max = MAX_STORED_STROKE): Vec2[] {
  if (points.length <= max) return points
  const out: Vec2[] = []
  const last = points.length - 1
  for (let i = 0; i < max - 1; i++) {
    out.push(points[Math.round((i * last) / (max - 1))])
  }
  out.push(points[last])
  return out
}

const newId = (): string =>
  `d${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

// ------------------------------------------------------------------ save side

function candidateToStored(c: FitResult): StoredCandidate {
  return {
    modelId: c.modelId,
    params: c.params.map((v) => round(v, CANDIDATE_DP)),
    kind: c.kind,
    domain: c.domain,
    error: round(c.error, CANDIDATE_DP),
    score: round(c.score, CANDIDATE_DP),
  }
}

export function boardToStored(input: BoardInput): StoredBoard {
  const curves: StoredCurve[] = input.curves.map((c) => {
    const stored: StoredCurve = {
      id: c.id,
      modelId: c.modelId,
      params: c.params.slice(),
      kind: c.kind,
      domain: c.domain,
      color: c.color,
      strokeWidth: c.strokeWidth,
      visible: c.visible,
      error: c.error,
    }
    if (c.sourceStroke && c.sourceStroke.length > 0) {
      const pts = decimate(c.sourceStroke)
      const flat: number[] = []
      for (const p of pts) {
        flat.push(round(p.x, STROKE_DP), round(p.y, STROKE_DP))
      }
      stored.stroke = flat
    }
    const src = input.exprSources[c.id]
    if (src !== undefined) stored.exprSource = src
    const st = input.styles[c.id]
    if (st && (st.dash !== undefined || st.opacity !== undefined)) stored.style = { ...st }
    const cands = input.candidates.get(c.id)
    if (cands && cands.length > 0) {
      stored.candidates = cands.slice(0, MAX_CANDIDATES).map(candidateToStored)
    }
    return stored
  })

  return {
    curves,
    viewport: {
      cx: round(input.viewport.center.x, 6),
      cy: round(input.viewport.center.y, 6),
      ppu: round(input.viewport.pxPerUnit, 6),
    },
    selectedId: input.selectedId,
    mode: input.mode,
  }
}

export function createDoc(name: string, board: StoredBoard, now = Date.now()): StoredDoc {
  return {
    version: SCHEMA_VERSION,
    id: newId(),
    name,
    createdAt: now,
    modifiedAt: now,
    board,
  }
}

export function emptyBoard(): StoredBoard {
  return {
    curves: [],
    viewport: { cx: 0, cy: 0, ppu: 60 },
    selectedId: null,
    mode: 'draw',
  }
}

export function serializeDoc(doc: StoredDoc): string {
  return JSON.stringify(doc)
}

// ------------------------------------------------------------------ load side

/** Rebuild the ModelSpec for one typed curve. Returns null with a reason. */
function rebuildExprModel(
  modelId: string,
  source: string,
): { spec: ModelSpec } | { error: string } {
  let outcome: ReturnType<typeof parseExpression>
  try {
    outcome = parseExpression(source)
  } catch {
    return { error: 'the parser could not read it' }
  }
  if (!outcome.ok) return { error: outcome.error }
  try {
    return { spec: outcome.plot.makeModel(modelId) }
  } catch {
    return { error: 'the equation could not be turned back into a plot' }
  }
}

function storedToCurve(
  raw: unknown,
  problems: string[],
): { curve: FittedCurve; stored: StoredCurve } | null {
  if (!isObj(raw)) return null
  const { id, modelId, kind, color } = raw
  if (!isStr(id) || !id) return null
  if (!isStr(modelId) || !modelId) return null
  if (!isKind(kind)) return null

  const params = numArray(raw.params, MAX_PARAMS)
  if (!params) return null

  const strokeFlat =
    raw.stroke === undefined ? null : numArray(raw.stroke, MAX_STROKE_IN * 2, STROKE_DP)
  if (raw.stroke !== undefined && !strokeFlat) {
    problems.push(`Curve ${id}: unreadable stroke data was dropped.`)
  }

  let sourceStroke: Vec2[] | undefined
  if (strokeFlat && strokeFlat.length >= 2) {
    sourceStroke = []
    for (let i = 0; i + 1 < strokeFlat.length; i += 2) {
      sourceStroke.push({ x: strokeFlat[i], y: strokeFlat[i + 1] })
    }
  }

  const curve: FittedCurve = {
    id,
    modelId,
    params,
    kind,
    domain: domainOf(raw.domain),
    color: isStr(color) && color ? color : '#4f9cf9',
    strokeWidth: isNum(raw.strokeWidth) ? raw.strokeWidth : 2.5,
    visible: typeof raw.visible === 'boolean' ? raw.visible : true,
    error: isNum(raw.error) ? raw.error : 0,
    ...(sourceStroke ? { sourceStroke } : {}),
  }

  const stored: StoredCurve = {
    ...(raw as unknown as StoredCurve),
    id,
    modelId,
    params,
    kind,
    domain: curve.domain,
    color: curve.color,
    strokeWidth: curve.strokeWidth,
    visible: curve.visible,
    error: curve.error,
  }
  return { curve, stored }
}

function storedToCandidates(raw: unknown): FitResult[] {
  if (!Array.isArray(raw)) return []
  const out: FitResult[] = []
  for (const c of raw.slice(0, MAX_CANDIDATES)) {
    if (!isObj(c)) continue
    const params = numArray(c.params, MAX_PARAMS)
    if (!params || !isStr(c.modelId) || !isKind(c.kind)) continue
    out.push({
      modelId: c.modelId,
      params,
      kind: c.kind,
      domain: domainOf(c.domain),
      error: isNum(c.error) ? c.error : 0,
      score: isNum(c.score) ? c.score : 0,
    })
  }
  return out
}

function styleOf(raw: unknown): CurveStyle | null {
  if (!isObj(raw)) return null
  const style: CurveStyle = {}
  const dash = numArray(raw.dash, 8)
  if (dash && dash.length > 0) style.dash = dash
  if (isNum(raw.opacity)) style.opacity = Math.min(1, Math.max(0, raw.opacity))
  return style.dash || style.opacity !== undefined ? style : null
}

/**
 * Turn a parsed (but untrusted) document into live board state.
 * Never throws: whatever is individually valid is kept, the rest is reported.
 */
export function hydrateDoc(rawDoc: unknown): LoadResult {
  const problems: string[] = []
  let degraded = false

  if (!isObj(rawDoc)) {
    return { meta: null, board: null, problems: ['The saved file is not a document.'], degraded: true }
  }

  const version = isNum(rawDoc.version) ? rawDoc.version : 0
  if (version > SCHEMA_VERSION) {
    problems.push(
      `This document was saved by a newer version of Grapher (format ${version}; this app reads ${SCHEMA_VERSION}). Anything it doesn't recognise was skipped.`,
    )
    degraded = true
  } else if (version < SCHEMA_VERSION) {
    problems.push(`Upgraded this document from format ${version} to ${SCHEMA_VERSION}.`)
  }

  const meta: DocMeta = {
    id: isStr(rawDoc.id) && rawDoc.id ? rawDoc.id : newId(),
    name: isStr(rawDoc.name) && rawDoc.name.trim() ? rawDoc.name : 'Untitled',
    createdAt: isNum(rawDoc.createdAt) ? rawDoc.createdAt : Date.now(),
    modifiedAt: isNum(rawDoc.modifiedAt) ? rawDoc.modifiedAt : Date.now(),
  }

  const rawBoard = isObj(rawDoc.board) ? rawDoc.board : null
  if (!rawBoard) {
    problems.push('The document had no board; started an empty one.')
    return { meta, board: blankHydrated(), problems, degraded: true }
  }

  // viewport — a silently reset view is confusing, so say when we had to
  const rawVp = isObj(rawBoard.viewport) ? rawBoard.viewport : {}
  if ('viewport' in rawBoard) {
    const readable = isObj(rawBoard.viewport) && isNum(rawVp.cx) && isNum(rawVp.cy) && isNum(rawVp.ppu)
    if (!readable) {
      problems.push('The saved view position was unreadable; the view was reset.')
      degraded = true
    }
  }
  const ppuRaw = isNum(rawVp.ppu) ? rawVp.ppu : 60
  const viewport = {
    center: { x: isNum(rawVp.cx) ? rawVp.cx : 0, y: isNum(rawVp.cy) ? rawVp.cy : 0 },
    pxPerUnit: Math.min(100000, Math.max(0.001, ppuRaw)),
  }

  // curves
  const curves: FittedCurve[] = []
  const styles: StyleMap = {}
  const candidates = new Map<string, FitResult[]>()
  const extraModels: Record<string, ModelSpec> = {}
  const exprSources: Record<string, string> = {}
  const brokenExpr: Record<string, string> = {}
  let exprCounter = 0

  const rawCurves = Array.isArray(rawBoard.curves) ? rawBoard.curves : []
  if (!Array.isArray(rawBoard.curves)) {
    problems.push('The curve list was unreadable.')
    degraded = true
  }
  if (rawCurves.length > MAX_CURVES) {
    problems.push(`Only the first ${MAX_CURVES} curves were loaded.`)
    degraded = true
  }

  let dropped = 0
  const seen = new Set<string>()
  for (const raw of rawCurves.slice(0, MAX_CURVES)) {
    const built = storedToCurve(raw, problems)
    if (!built) {
      dropped++
      continue
    }
    const { curve, stored } = built
    if (seen.has(curve.id)) {
      dropped++
      continue
    }
    seen.add(curve.id)

    // Typed equations: rebuild the model closure from its source text.
    if (isStr(stored.exprSource) && stored.exprSource.trim()) {
      const source = stored.exprSource
      exprSources[curve.id] = source
      const m = /^expr_(\d+)$/.exec(curve.modelId)
      if (m) exprCounter = Math.max(exprCounter, Number(m[1]))
      const rebuilt = rebuildExprModel(curve.modelId, source)
      if ('spec' in rebuilt) {
        extraModels[curve.modelId] = rebuilt.spec
      } else {
        brokenExpr[curve.id] = rebuilt.error
        problems.push(`“${source}” could not be restored: ${rebuilt.error}`)
        degraded = true
      }
    }

    const style = styleOf(stored.style)
    if (style) styles[curve.id] = style
    const cands = storedToCandidates(stored.candidates)
    if (cands.length > 0) candidates.set(curve.id, cands)
    curves.push(curve)
  }

  if (dropped > 0) {
    problems.push(`${dropped} damaged curve${dropped === 1 ? '' : 's'} could not be read.`)
    degraded = true
  }

  const selectedId =
    isStr(rawBoard.selectedId) && curves.some((c) => c.id === rawBoard.selectedId)
      ? rawBoard.selectedId
      : null
  const mode: BoardMode = rawBoard.mode === 'pan' ? 'pan' : 'draw'

  return {
    meta,
    board: {
      curves,
      styles,
      candidates,
      extraModels,
      exprSources,
      brokenExpr,
      viewport,
      selectedId,
      mode,
      exprCounter,
    },
    problems,
    degraded,
  }
}

function blankHydrated(): HydratedBoard {
  return {
    curves: [],
    styles: {},
    candidates: new Map(),
    extraModels: {},
    exprSources: {},
    brokenExpr: {},
    viewport: { center: { x: 0, y: 0 }, pxPerUnit: 60 },
    selectedId: null,
    mode: 'draw',
    exprCounter: 0,
  }
}

/** Parse a stored JSON string. Never throws — a hostile blob yields a report. */
export function deserializeDoc(json: string): LoadResult {
  if (typeof json !== 'string' || json.trim() === '') {
    return { meta: null, board: null, problems: ['The saved document was empty.'], degraded: true }
  }
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    return {
      meta: null,
      board: null,
      problems: ['The saved document is corrupted (it isn’t valid JSON) and could not be opened.'],
      degraded: true,
    }
  }
  return hydrateDoc(raw)
}

/** Round-trip helper used by save: live board -> full document record. */
export function docFromBoard(meta: DocMeta, input: BoardInput, now = Date.now()): StoredDoc {
  return {
    version: SCHEMA_VERSION,
    id: meta.id,
    name: meta.name,
    createdAt: meta.createdAt,
    modifiedAt: now,
    board: boardToStored(input),
  }
}
