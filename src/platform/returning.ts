// ============================================================================
// Has this browser been here before? The landing page asks, read-only, so it
// can offer "Continue where you left off".
//
// The app's document index lives at `grapher.v1.index` (src/ui/storage.ts):
// { currentId, docs: [{ id, name, … }] }. This reads that one key and nothing
// else, never writes, and never imports the app's storage module (which would
// pull the app into the landing chunk). A damaged or missing index — or a
// browser that refuses storage — reads as "no saved documents".
// ============================================================================

/** The app's document index key (src/ui/storage.ts: `${PREFIX}.index`). */
export const DOC_INDEX_KEY = 'grapher.v1.index'

/** A read-only view of storage: only getItem. */
export type ReadStorage = (key: string) => string | null

/** How many saved documents the index lists. Pure; never throws, never writes. */
export function savedDocCount(read: ReadStorage): number {
  let raw: string | null
  try {
    raw = read(DOC_INDEX_KEY)
  } catch {
    return 0
  }
  if (!raw) return 0
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return 0
    const docs = (parsed as { docs?: unknown }).docs
    if (!Array.isArray(docs)) return 0
    return docs.filter(
      (d: unknown) => typeof d === 'object' && d !== null && typeof (d as { id?: unknown }).id === 'string',
    ).length
  } catch {
    return 0
  }
}

/** The browser's localStorage as a ReadStorage, or null when it is unavailable. */
export function browserStorage(): ReadStorage | null {
  try {
    const s = globalThis.localStorage
    if (!s) return null
    return (key) => s.getItem(key)
  } catch {
    return null // a sandboxed frame or blocked site data throws on access
  }
}
