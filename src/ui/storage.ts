// ============================================================================
// localStorage adapter for documents.
//
// Storage choice: localStorage, not IndexedDB. Writes are synchronous, so a
// document is committed the instant the debounce fires — there is no window in
// which a crash or a closed tab can lose an in-flight async transaction. With
// strokes thinned to 120 points and coordinates rounded to 4dp (see
// core/persist.ts), a busy 20-curve lesson serialises to well under 200KB, so
// the ~5MB budget holds dozens of documents. Documents are stored one key each,
// so a single oversized board can never block the others, and quota failures
// are surfaced loudly rather than swallowed.
// ============================================================================

import type { BoardKind } from '../core/types'
import type { DocCounts, DocMeta, StoredDoc } from '../core/persist'
import { countBoard, serializeDoc } from '../core/persist'
import { DEFAULT_EXPORT } from './renderBoard'
import type { FitExportSettings } from './exportFit'
import { clampFitSettings, defaultFit, isAspect } from './exportFit'
import type { WheelPref } from './gestures'

const PREFIX = 'grapher.v1'
const INDEX_KEY = `${PREFIX}.index`
const PREFS_KEY = `${PREFIX}.prefs`
const docKey = (id: string): string => `${PREFIX}.doc.${id}`

export interface DocIndex {
  currentId: string | null
  docs: DocMeta[]
}

export type SaveOutcome =
  | { ok: true }
  | { ok: false; quota: boolean; message: string }
  /**
   * Another tab got there first. 'stale' = the stored record is newer than the
   * one this tab loaded; 'deleted' = the record this tab is editing is gone.
   * Either way NOTHING was written: overwriting would destroy the other tab's
   * work, and re-writing a deleted document would resurrect it.
   */
  | { ok: false; quota: false; conflict: 'stale' | 'deleted'; message: string }

/** Keys this app owns — used to filter cross-tab `storage` events. */
export const STORAGE_PREFIX = PREFIX

export const isGrapherKey = (key: string | null): boolean =>
  key === null || key.startsWith(PREFIX)

export interface DocStamp {
  exists: boolean
  modifiedAt: number
}

/** What storage currently holds for one document, without hydrating it. */
export function readDocStamp(id: string): DocStamp {
  const raw = readDocJSON(id)
  if (raw === null) return { exists: false, modifiedAt: 0 }
  try {
    const parsed: unknown = JSON.parse(raw)
    const at = isObj(parsed) ? parsed.modifiedAt : undefined
    return { exists: true, modifiedAt: typeof at === 'number' && Number.isFinite(at) ? at : 0 }
  } catch {
    // Unreadable but present: treat it as existing and infinitely old, so a
    // corrupted record is never mistaken for "someone deleted my document".
    return { exists: true, modifiedAt: 0 }
  }
}

/** Storage can be entirely absent (SSR) or throw on write (Safari private). */
function storage(): Storage | null {
  try {
    const s = globalThis.localStorage
    if (!s) return null
    return s
  } catch {
    return null
  }
}

function isQuotaError(e: unknown): boolean {
  if (!(e instanceof Error)) return false
  const anyErr = e as { name?: string; code?: number }
  return (
    anyErr.name === 'QuotaExceededError' ||
    anyErr.name === 'NS_ERROR_DOM_QUOTA_REACHED' || // Firefox
    anyErr.code === 22 ||
    anyErr.code === 1014
  )
}

function write(key: string, value: string): SaveOutcome {
  const s = storage()
  if (!s) {
    return {
      ok: false,
      quota: false,
      message: 'This browser is blocking local storage, so your work can’t be saved here.',
    }
  }
  try {
    s.setItem(key, value)
    return { ok: true }
  } catch (e) {
    if (isQuotaError(e)) {
      return {
        ok: false,
        quota: true,
        message: 'Couldn’t save — browser storage is full.',
      }
    }
    return { ok: false, quota: false, message: 'Couldn’t save to browser storage.' }
  }
}

// ------------------------------------------------------------------- index

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const countsOf = (v: unknown): DocCounts | undefined => {
  if (!isObj(v)) return undefined
  const n = (x: unknown): number =>
    typeof x === 'number' && Number.isFinite(x) && x >= 0 ? Math.round(x) : 0
  return { curves: n(v.curves), points: n(v.points), intervals: n(v.intervals) }
}

function metaOf(v: unknown): DocMeta | null {
  if (!isObj(v)) return null
  const { id, name, createdAt, modifiedAt } = v
  if (typeof id !== 'string' || !id) return null
  const counts = countsOf(v.counts)
  return {
    id,
    name: typeof name === 'string' && name.trim() ? name : 'Untitled',
    createdAt: typeof createdAt === 'number' && Number.isFinite(createdAt) ? createdAt : 0,
    modifiedAt: typeof modifiedAt === 'number' && Number.isFinite(modifiedAt) ? modifiedAt : 0,
    ...(v.kind === 'number-line' || v.kind === 'cartesian' ? { kind: v.kind } : {}),
    ...(counts ? { counts } : {}),
  }
}

/**
 * What KIND of board a stored document is, and what is on it — read straight
 * out of the record for an index entry that predates those fields.
 *
 * The documents list is where a teacher picks between four boards called
 * "Untitled", so it has to be able to say "Graph · 4 curves" about a document
 * that has not been saved since this existed. Every new save writes them into
 * the index (see writeDoc), so this runs once per legacy document.
 */
function describeStored(id: string): { kind: BoardKind; counts: DocCounts } | null {
  const raw = readDocJSON(id)
  if (raw === null) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isObj(parsed) || !isObj(parsed.board)) return null
    const board = parsed.board as unknown as Parameters<typeof countBoard>[0]
    return {
      kind: board.kind === 'number-line' ? 'number-line' : 'cartesian',
      counts: countBoard(board),
    }
  } catch {
    return null
  }
}

/** Read the document index. A damaged index never throws — it reads as empty. */
export function readIndex(): DocIndex {
  const s = storage()
  if (!s) return { currentId: null, docs: [] }
  let raw: string | null = null
  try {
    raw = s.getItem(INDEX_KEY)
  } catch {
    return { currentId: null, docs: [] }
  }
  if (!raw) return { currentId: null, docs: [] }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isObj(parsed)) return { currentId: null, docs: [] }
    const docs: DocMeta[] = []
    const seen = new Set<string>()
    if (Array.isArray(parsed.docs)) {
      for (const d of parsed.docs) {
        const m = metaOf(d)
        if (m && !seen.has(m.id)) {
          seen.add(m.id)
          docs.push(m)
        }
      }
    }
    const currentId =
      typeof parsed.currentId === 'string' && seen.has(parsed.currentId) ? parsed.currentId : null
    return { currentId, docs }
  } catch {
    return { currentId: null, docs: [] }
  }
}

export function writeIndex(index: DocIndex): SaveOutcome {
  return write(INDEX_KEY, JSON.stringify(index))
}

/**
 * Documents newest-modified first — the order the Open menu wants.
 *
 * Entries written before the index carried a kind and a count are filled in
 * from the record itself and the index is rewritten, so the cost is paid once
 * per document rather than on every listing.
 */
export function listDocs(): DocMeta[] {
  const index = readIndex()
  let changed = false
  const docs = index.docs.map((d) => {
    if (d.kind !== undefined && d.counts !== undefined) return d
    const described = describeStored(d.id)
    if (!described) return d
    changed = true
    return { ...d, ...described }
  })
  if (changed) writeIndex({ ...index, docs })
  return docs.slice().sort((a, b) => b.modifiedAt - a.modifiedAt)
}

// --------------------------------------------------------------- documents

export function readDocJSON(id: string): string | null {
  const s = storage()
  if (!s) return null
  try {
    return s.getItem(docKey(id))
  } catch {
    return null
  }
}

export interface WriteOptions {
  /**
   * The `modifiedAt` this tab last saw for this document. When given, the
   * stored record is re-read first and the write is REFUSED if storage has
   * moved on (another tab saved, or deleted the document). Omit only for a
   * document this tab is creating, which nothing else can have touched yet.
   */
  expectModifiedAt?: number
}

/** Persist one document and refresh its entry in the index. */
export function writeDoc(doc: StoredDoc, opts: WriteOptions = {}): SaveOutcome {
  // Last-writer-wins across tabs silently destroyed whole boards, so a write
  // that would clobber a newer record is refused and reported instead.
  if (opts.expectModifiedAt !== undefined) {
    const stamp = readDocStamp(doc.id)
    if (!stamp.exists) {
      return {
        ok: false,
        quota: false,
        conflict: 'deleted',
        message: 'This document was deleted in another tab.',
      }
    }
    if (stamp.modifiedAt > opts.expectModifiedAt) {
      return {
        ok: false,
        quota: false,
        conflict: 'stale',
        message: 'This document was changed in another tab.',
      }
    }
  }

  const outcome = write(docKey(doc.id), serializeDoc(doc))
  if (!outcome.ok) return outcome

  const index = readIndex()
  const meta: DocMeta = {
    id: doc.id,
    name: doc.name,
    createdAt: doc.createdAt,
    modifiedAt: doc.modifiedAt,
    kind: doc.board.kind === 'number-line' ? 'number-line' : 'cartesian',
    counts: countBoard(doc.board),
  }
  const docs = index.docs.filter((d) => d.id !== doc.id)
  docs.push(meta)
  // Index write failing is not fatal: the document itself is already committed.
  // currentId is deliberately NOT claimed here: a background autosave in one
  // tab must not decide which document every other tab opens next. Callers that
  // genuinely switch documents call setCurrentDoc themselves.
  writeIndex({ currentId: index.currentId ?? doc.id, docs })
  return { ok: true }
}

export function removeDoc(id: string): void {
  forgetExportSettings(id)
  const s = storage()
  if (s) {
    try {
      s.removeItem(docKey(id))
    } catch {
      /* nothing useful to do */
    }
  }
  const index = readIndex()
  const docs = index.docs.filter((d) => d.id !== id)
  writeIndex({ currentId: index.currentId === id ? (docs[0]?.id ?? null) : index.currentId, docs })
}

export function setCurrentDoc(id: string | null): void {
  const index = readIndex()
  writeIndex({ ...index, currentId: id })
}

// ------------------------------------------------------------- preferences
//
// View preferences belong to the person, not to the lesson: a teacher who
// hides the analysis markers wants them hidden in every document, and an
// imported file must never silently flip their setting. So preferences live
// under their own key, outside the document schema — which also means no
// schema bump and no risk to documents already on disk.

export interface Prefs {
  showAnalysis: boolean
  /** Ground the ON-SCREEN canvas is drawn on. Export has its own setting. */
  canvasTheme: 'dark' | 'light'
  /**
   * Export size/margin/theme/framing, per document id. Worksheet figures have
   * to be consistent across a document, so the choice is remembered with the
   * document rather than globally.
   *
   * It lives here, beside the other preferences, and NOT inside StoredDoc:
   * core/persist.ts owns the document schema, its hydrator validates a closed
   * shape, and an unknown field would be dropped on the next save. Keeping it
   * out also means an exported .grapher.json file stays byte-compatible with
   * every document already on disk — no schema bump, nothing to migrate.
   */
  exportByDoc: Record<string, FitExportSettings>
  /** The last settings used, inherited by a document that has none yet. */
  exportDefaults: FitExportSettings
  /**
   * The presentation type scale last used, so a teacher who sized the board
   * for their room does not resize it at the start of every lesson. Nothing
   * else about presentation mode is remembered: it is a thing you enter for a
   * demo and leave, not a state a document is in.
   */
  presentScale: number
  /**
   * What a plain mouse wheel does on the board. 'auto' zooms for a wheel and
   * pans for a trackpad's two-finger scroll; the other two are for hardware
   * the guess gets wrong.
   */
  wheel: WheelPref
}

export const DEFAULT_PREFS: Prefs = {
  showAnalysis: true,
  canvasTheme: 'dark',
  exportByDoc: {},
  exportDefaults: { ...DEFAULT_EXPORT, ...defaultFit('cartesian') },
  presentScale: 2.5,
  wheel: 'auto',
}

/** Never trust what came back from storage: a bad value falls back silently. */
function exportOf(v: unknown, fallback: FitExportSettings): FitExportSettings {
  if (!isObj(v)) return { ...fallback }
  const scale = typeof v.scale === 'number' ? v.scale : fallback.scale
  const width =
    v.width === null ? null : typeof v.width === 'number' ? v.width : fallback.width
  const margin = typeof v.margin === 'number' ? v.margin : fallback.margin
  const theme = v.theme === 'dark' || v.theme === 'light' ? v.theme : fallback.theme
  const fit = typeof v.fit === 'boolean' ? v.fit : fallback.fit
  const aspect = isAspect(v.aspect) ? v.aspect : fallback.aspect
  return clampFitSettings({ scale, width, margin, theme, fit, aspect })
}

export function readPrefs(): Prefs {
  const s = storage()
  if (!s) return { ...DEFAULT_PREFS, exportByDoc: {} }
  try {
    const raw = s.getItem(PREFS_KEY)
    if (!raw) return { ...DEFAULT_PREFS, exportByDoc: {} }
    const parsed: unknown = JSON.parse(raw)
    if (!isObj(parsed)) return { ...DEFAULT_PREFS, exportByDoc: {} }
    const exportDefaults = exportOf(parsed.exportDefaults, DEFAULT_PREFS.exportDefaults)
    const exportByDoc: Record<string, FitExportSettings> = {}
    if (isObj(parsed.exportByDoc)) {
      for (const [id, v] of Object.entries(parsed.exportByDoc)) {
        if (typeof id === 'string' && id) exportByDoc[id] = exportOf(v, exportDefaults)
      }
    }
    return {
      showAnalysis:
        typeof parsed.showAnalysis === 'boolean'
          ? parsed.showAnalysis
          : DEFAULT_PREFS.showAnalysis,
      canvasTheme: parsed.canvasTheme === 'light' ? 'light' : 'dark',
      exportByDoc,
      exportDefaults,
      presentScale: clampPresentScale(parsed.presentScale),
      wheel: parsed.wheel === 'zoom' || parsed.wheel === 'pan' ? parsed.wheel : 'auto',
    }
  } catch {
    return { ...DEFAULT_PREFS, exportByDoc: {} }
  }
}

/** Projected type is useful between 1.5x and 4x; outside that it is a mistake. */
export const MIN_PRESENT_SCALE = 1.5
export const MAX_PRESENT_SCALE = 4

export function clampPresentScale(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return DEFAULT_PREFS.presentScale
  return Math.min(MAX_PRESENT_SCALE, Math.max(MIN_PRESENT_SCALE, v))
}

export function writePrefs(prefs: Prefs): void {
  // A preference failing to save must never surface as a "work not saved"
  // alarm — it is not the user's work.
  write(PREFS_KEY, JSON.stringify(prefs))
}

/** Change some preferences without having to restate the rest. */
export function updatePrefs(patch: Partial<Prefs>): Prefs {
  const next: Prefs = { ...readPrefs(), ...patch }
  writePrefs(next)
  return next
}

/**
 * The export settings for one document.
 *
 * Size, margin and background are inherited from the last document worked on,
 * because a worksheet's figures should match. FRAMING is not: whether to crop
 * to the content follows the KIND of board, since a number line is nearly all
 * whitespace in any window and a graph's window is usually the framing the
 * teacher chose. A document that has its own answer keeps it.
 */
export function readExportSettings(docId: string, kind: BoardKind): FitExportSettings {
  const prefs = readPrefs()
  const own = docId ? prefs.exportByDoc[docId] : undefined
  if (own) return { ...own }
  return { ...prefs.exportDefaults, ...defaultFit(kind) }
}

/** True once this document has export settings of its own, stated by the user. */
export function hasExportSettings(docId: string): boolean {
  return !!docId && docId in readPrefs().exportByDoc
}

/**
 * Remember a document's export settings, and make them the default the next
 * new document starts from.
 */
export function writeExportSettings(docId: string, settings: FitExportSettings): void {
  const prefs = readPrefs()
  const clean = clampFitSettings(settings)
  const byDoc = { ...prefs.exportByDoc }
  if (docId) byDoc[docId] = clean
  writePrefs({ ...prefs, exportByDoc: byDoc, exportDefaults: clean })
}

/**
 * Carry one document's export settings across to another.
 *
 * A copy of a document is the same figure under a new id, so it must come out
 * the same size. Relying on `exportDefaults` to do this quietly failed: the
 * defaults are whatever was touched LAST anywhere in the app, so a copy made
 * after visiting another board inherited that board's size instead — measured
 * as a document set to 1x coming back as 2x, the built-in default, the moment
 * it was saved as a copy from the conflict banner. Duplicate had the same hole
 * and only looked healthy because it was usually used straight away.
 */
export function copyExportSettings(fromId: string, toId: string): void {
  if (!fromId || !toId || fromId === toId) return
  const prefs = readPrefs()
  const own = prefs.exportByDoc[fromId]
  if (!own) return
  writePrefs({ ...prefs, exportByDoc: { ...prefs.exportByDoc, [toId]: { ...own } } })
}

/** Drop a deleted document's export settings so the map can't grow forever. */
export function forgetExportSettings(docId: string): void {
  const prefs = readPrefs()
  if (!docId || !(docId in prefs.exportByDoc)) return
  const { [docId]: _gone, ...rest } = prefs.exportByDoc
  writePrefs({ ...prefs, exportByDoc: rest })
}

/** Rough bytes used by this app's keys — shown when storage runs out. */
export function usedBytes(): number {
  const s = storage()
  if (!s) return 0
  let total = 0
  try {
    for (let i = 0; i < s.length; i++) {
      const k = s.key(i)
      if (!k || !k.startsWith(PREFIX)) continue
      total += k.length + (s.getItem(k)?.length ?? 0)
    }
  } catch {
    return total
  }
  return total
}
