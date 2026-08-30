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

import type { DocMeta, StoredDoc } from '../core/persist'
import { serializeDoc } from '../core/persist'

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

function metaOf(v: unknown): DocMeta | null {
  if (!isObj(v)) return null
  const { id, name, createdAt, modifiedAt } = v
  if (typeof id !== 'string' || !id) return null
  return {
    id,
    name: typeof name === 'string' && name.trim() ? name : 'Untitled',
    createdAt: typeof createdAt === 'number' && Number.isFinite(createdAt) ? createdAt : 0,
    modifiedAt: typeof modifiedAt === 'number' && Number.isFinite(modifiedAt) ? modifiedAt : 0,
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

/** Documents newest-modified first — the order the Open menu wants. */
export function listDocs(): DocMeta[] {
  return readIndex().docs.slice().sort((a, b) => b.modifiedAt - a.modifiedAt)
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

/** Persist one document and refresh its entry in the index. */
export function writeDoc(doc: StoredDoc): SaveOutcome {
  const outcome = write(docKey(doc.id), serializeDoc(doc))
  if (!outcome.ok) return outcome

  const index = readIndex()
  const meta: DocMeta = {
    id: doc.id,
    name: doc.name,
    createdAt: doc.createdAt,
    modifiedAt: doc.modifiedAt,
  }
  const docs = index.docs.filter((d) => d.id !== doc.id)
  docs.push(meta)
  // Index write failing is not fatal: the document itself is already committed.
  writeIndex({ currentId: doc.id, docs })
  return { ok: true }
}

export function removeDoc(id: string): void {
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
}

export const DEFAULT_PREFS: Prefs = { showAnalysis: true }

export function readPrefs(): Prefs {
  const s = storage()
  if (!s) return { ...DEFAULT_PREFS }
  try {
    const raw = s.getItem(PREFS_KEY)
    if (!raw) return { ...DEFAULT_PREFS }
    const parsed: unknown = JSON.parse(raw)
    if (!isObj(parsed)) return { ...DEFAULT_PREFS }
    return {
      showAnalysis:
        typeof parsed.showAnalysis === 'boolean'
          ? parsed.showAnalysis
          : DEFAULT_PREFS.showAnalysis,
    }
  } catch {
    return { ...DEFAULT_PREFS }
  }
}

export function writePrefs(prefs: Prefs): void {
  // A preference failing to save must never surface as a "work not saved"
  // alarm — it is not the user's work.
  write(PREFS_KEY, JSON.stringify(prefs))
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
