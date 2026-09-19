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

import type {
  BoardKind,
  CurveKind,
  FitResult,
  FittedCurve,
  ModelSpec,
  NLItem,
  Vec2,
} from './types'
import { parseExpression } from './parse'

/**
 * Bump when the on-disk shape changes in a way older readers can't handle.
 *
 * 1 -> 2 added the board KIND and its number-line items. The change is purely
 * additive: a version-1 document has no `kind` and no `items`, which is exactly
 * what a cartesian board serialises to today, so reading one is not a repair
 * and must not be reported as one (see SILENT_UPGRADE_FROM). In the other
 * direction a cartesian board still writes neither field, so a document this
 * reader saves stays readable by a version-1 reader unless it is actually a
 * number line — the only case where the older reader would genuinely be lost.
 */
export const SCHEMA_VERSION = 2

/**
 * The oldest format this reader upgrades with nothing lost or repaired. Below
 * it, a load says so; at or above it, the upgrade is invisible because there is
 * nothing to tell the user about.
 */
const SILENT_UPGRADE_FROM = 1

/** Per-curve style extras that FittedCurve itself doesn't carry. */
export interface CurveStyle {
  dash?: number[]
  opacity?: number
  /** Number-line items only: bar thickness in px (curves use strokeWidth). */
  width?: number
  /**
   * Number-line items only: which ANSWER this piece belongs to.
   *
   * "x < −2 or x ≥ 3" is one answer in two pieces, and the things that belong
   * to the answer rather than to a piece — its label, its interval notation —
   * need to know which pieces are in it. The stamp lives here because the
   * style map is already carried through history, export and this file; an
   * item with no stamp is an answer of one, which is what it is.
   */
  group?: string
}
export type StyleMap = Record<string, CurveStyle>

export type BoardMode = 'draw' | 'pan'

// --- defensive limits: a stored blob is untrusted input ----------------------
const MAX_CURVES = 2000
const MAX_ITEMS = 500
const MAX_LABEL_CHARS = 120
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
  /**
   * The user's own typed form for a curve that is still a FAMILY — the
   * factored cubic they wrote, which the card keeps printing while the
   * family's params drive the curve.
   *
   * Deliberately NOT exprSource. That field means "this curve IS a typed
   * expression", and the loader rebuilds a model closure from it; putting a
   * family's display text there would overwrite the family with a generic
   * expr_N model on the next load, losing its handles and its interpretation.
   * Absent field = no source, so every document already on disk is unchanged.
   */
  displaySource?: string
  style?: CurveStyle
  candidates?: StoredCandidate[]
}

/**
 * An NLItem is already plain JSON, so it is stored as it lives — plus the same
 * per-id style record a curve carries, which lives beside the item rather than
 * in a second map so an item and its styling can never be separated.
 */
export type StoredNLItem = NLItem & { style?: CurveStyle }

export interface StoredBoard {
  curves: StoredCurve[]
  viewport: { cx: number; cy: number; ppu: number }
  selectedId: string | null
  mode: BoardMode
  /**
   * Omitted entirely for a cartesian board, which is what every version-1
   * document is: a board that has never been a number line therefore
   * serialises byte-for-byte as it did before this field existed.
   */
  kind?: BoardKind
  /** Omitted when empty, for the same reason. */
  items?: StoredNLItem[]
}

export interface StoredDoc {
  version: number
  id: string
  name: string
  createdAt: number
  modifiedAt: number
  board: StoredBoard
}

/** What a board holds, so the documents list can say so without opening it. */
export interface DocCounts {
  curves: number
  points: number
  intervals: number
}

export interface DocMeta {
  id: string
  name: string
  createdAt: number
  modifiedAt: number
  /**
   * Index-only, both optional: the documents list shows a board's kind and
   * what is on it, and neither is worth opening a 200KB record to find out.
   * They live in the index (src/ui/storage.ts), never in the document itself,
   * so the on-disk document schema is untouched. Absent = not known yet.
   */
  kind?: BoardKind
  counts?: DocCounts
}

/** Count what a stored board holds. Cheap: it never touches stroke data. */
export function countBoard(board: StoredBoard): DocCounts {
  const items = Array.isArray(board.items) ? board.items : []
  let points = 0
  let intervals = 0
  for (const it of items) {
    if (it && it.kind === 'point') points++
    else if (it && it.kind === 'interval') intervals++
  }
  return {
    curves: Array.isArray(board.curves) ? board.curves.length : 0,
    points,
    intervals,
  }
}

// ---------------------------------------------------------------- live shape

export interface BoardInput {
  curves: FittedCurve[]
  /** Absent means 'cartesian' — every pre-number-line caller keeps working. */
  kind?: BoardKind
  items?: NLItem[]
  styles: StyleMap
  candidates: Map<string, FitResult[]>
  /** curveId -> the equation the user typed. */
  exprSources: Record<string, string>
  /** curveId -> the typed form to PRINT while the family still means it. */
  displaySources?: Record<string, string>
  viewport: { center: Vec2; pxPerUnit: number }
  selectedId: string | null
  mode: BoardMode
}

export interface HydratedBoard {
  curves: FittedCurve[]
  kind: BoardKind
  items: NLItem[]
  styles: StyleMap
  candidates: Map<string, FitResult[]>
  /** Rebuilt from source text — the closures the board needs to render. */
  extraModels: Record<string, ModelSpec>
  exprSources: Record<string, string>
  /** curveId -> the typed form the card prints instead of the generated one. */
  displaySources: Record<string, string>
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
    // Written only when there is one, so a board without any typed display
    // forms serialises byte-for-byte as it did before this field existed.
    const shown = input.displaySources?.[c.id]
    if (typeof shown === 'string' && shown.trim() !== '') stored.displaySource = shown
    const st = input.styles[c.id]
    if (st && (st.dash !== undefined || st.opacity !== undefined)) stored.style = { ...st }
    const cands = input.candidates.get(c.id)
    if (cands && cands.length > 0) {
      stored.candidates = cands.slice(0, MAX_CANDIDATES).map(candidateToStored)
    }
    return stored
  })

  const board: StoredBoard = {
    curves,
    viewport: {
      cx: round(input.viewport.center.x, 6),
      cy: round(input.viewport.center.y, 6),
      ppu: round(input.viewport.pxPerUnit, 6),
    },
    selectedId: input.selectedId,
    mode: input.mode,
  }

  // Written only when they carry information. A cartesian board with no items
  // produces the same JSON it produced before either field existed.
  if (input.kind === 'number-line') board.kind = 'number-line'
  const items = input.items ?? []
  if (items.length > 0) {
    board.items = items.slice(0, MAX_ITEMS).map((it) => itemToStored(it, input.styles[it.id]))
  }

  return board
}

/** Copy an item into a fresh, own-property-only record (no aliasing, no extras). */
function itemToStored(it: NLItem, style: CurveStyle | undefined): StoredNLItem {
  const styled =
    style &&
    (style.dash !== undefined ||
      style.opacity !== undefined ||
      style.width !== undefined ||
      style.group !== undefined)
      ? { style: { ...style } }
      : {}
  if (it.kind === 'point') {
    return {
      ...styled,
      kind: 'point',
      id: it.id,
      x: round(it.x, 6),
      closed: it.closed === true,
      color: it.color,
      ...(it.label !== undefined ? { label: it.label } : {}),
    }
  }
  return {
    ...styled,
    kind: 'interval',
    id: it.id,
    lo: it.lo === null ? null : round(it.lo, 6),
    hi: it.hi === null ? null : round(it.hi, 6),
    loClosed: it.loClosed === true,
    hiClosed: it.hiClosed === true,
    color: it.color,
    ...(it.label !== undefined ? { label: it.label } : {}),
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

export function emptyBoard(kind: BoardKind = 'cartesian'): StoredBoard {
  const board: StoredBoard = {
    curves: [],
    viewport: { cx: 0, cy: 0, ppu: 60 },
    selectedId: null,
    mode: 'draw',
  }
  if (kind === 'number-line') board.kind = 'number-line'
  return board
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

/**
 * One stored item, validated. Returns null when it is not salvageable — an
 * interval with no finite ends at all, say, which would draw as the whole line
 * and silently claim every number.
 */
function storedToItem(raw: unknown): NLItem | null {
  if (!isObj(raw)) return null
  const id = raw.id
  if (!isStr(id) || !id) return null
  const color = isStr(raw.color) && raw.color ? raw.color : '#4f9cf9'
  const label =
    isStr(raw.label) && raw.label.trim() ? raw.label.slice(0, MAX_LABEL_CHARS) : undefined

  if (raw.kind === 'point') {
    if (!isNum(raw.x)) return null
    return {
      kind: 'point',
      id,
      x: raw.x,
      closed: raw.closed !== false,
      color,
      ...(label !== undefined ? { label } : {}),
    }
  }
  if (raw.kind !== 'interval') return null
  const lo = raw.lo === null ? null : isNum(raw.lo) ? raw.lo : undefined
  const hi = raw.hi === null ? null : isNum(raw.hi) ? raw.hi : undefined
  if (lo === undefined || hi === undefined) return null
  // (-inf, inf) is not an interval a teacher draws; it is a damaged record.
  if (lo === null && hi === null) return null
  if (lo !== null && hi !== null && hi < lo) return null
  return {
    kind: 'interval',
    id,
    lo,
    hi,
    loClosed: raw.loClosed === true,
    hiClosed: raw.hiClosed === true,
    color,
    ...(label !== undefined ? { label } : {}),
  }
}

function styleOf(raw: unknown): CurveStyle | null {
  if (!isObj(raw)) return null
  const style: CurveStyle = {}
  const dash = numArray(raw.dash, 8)
  if (dash && dash.length > 0) style.dash = dash
  if (isNum(raw.opacity)) style.opacity = Math.min(1, Math.max(0, raw.opacity))
  if (isNum(raw.width)) style.width = Math.min(64, Math.max(0.5, raw.width))
  if (isStr(raw.group) && raw.group.trim()) style.group = raw.group.slice(0, 64)
  return style.dash ||
    style.opacity !== undefined ||
    style.width !== undefined ||
    style.group !== undefined
    ? style
    : null
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
  } else if (version < SILENT_UPGRADE_FROM) {
    problems.push(`Upgraded this document from format ${version} to ${SCHEMA_VERSION}.`)
  }
  // Between SILENT_UPGRADE_FROM and current the formats differ only by fields
  // that were added, never moved or reinterpreted, so there is nothing to say:
  // announcing an upgrade that changed nothing would put a "restored with
  // changes" banner over every document a teacher already had.

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
  const displaySources: Record<string, string> = {}
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

    // A family's own typed form. It never builds a model — it is only what
    // the card prints — so it is read for every curve, expression or not.
    if (isStr(stored.displaySource) && stored.displaySource.trim()) {
      displaySources[curve.id] = stored.displaySource
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

  // ---- board kind + number-line items
  // An unknown kind is read as cartesian: that is the board every document was
  // before this field existed, and it never loses anything that is on disk.
  const kind: BoardKind = rawBoard.kind === 'number-line' ? 'number-line' : 'cartesian'
  const items: NLItem[] = []
  const rawItems = Array.isArray(rawBoard.items) ? rawBoard.items : []
  if (rawBoard.items !== undefined && !Array.isArray(rawBoard.items)) {
    problems.push('The number-line item list was unreadable.')
    degraded = true
  }
  if (rawItems.length > MAX_ITEMS) {
    problems.push(`Only the first ${MAX_ITEMS} number-line items were loaded.`)
    degraded = true
  }
  let droppedItems = 0
  for (const raw of rawItems.slice(0, MAX_ITEMS)) {
    const item = storedToItem(raw)
    if (!item || seen.has(item.id)) {
      droppedItems++
      continue
    }
    seen.add(item.id)
    const st = isObj(raw) ? styleOf(raw.style) : null
    if (st) styles[item.id] = st
    items.push(item)
  }
  if (droppedItems > 0) {
    problems.push(
      `${droppedItems} damaged number-line item${droppedItems === 1 ? '' : 's'} could not be read.`,
    )
    degraded = true
  }

  const selectable = new Set<string>([...curves.map((c) => c.id), ...items.map((i) => i.id)])
  const selectedId =
    isStr(rawBoard.selectedId) && selectable.has(rawBoard.selectedId)
      ? rawBoard.selectedId
      : null
  const mode: BoardMode = rawBoard.mode === 'pan' ? 'pan' : 'draw'

  return {
    meta,
    board: {
      curves,
      kind,
      items,
      styles,
      candidates,
      extraModels,
      exprSources,
      displaySources,
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
    kind: 'cartesian',
    items: [],
    styles: {},
    candidates: new Map(),
    extraModels: {},
    exprSources: {},
    displaySources: {},
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
