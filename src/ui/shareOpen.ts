// ============================================================================
// Opening a share link: fragment -> a NEW, temporary document.
//
// The rules a link has to keep:
//   - it never overwrites anything: the document gets a fresh id, so even the
//     teacher opening their own link gets a separate temporary copy, never
//     the record it was made from;
//   - it goes through deserializeDoc like any saved document, so a damaged
//     link is repaired-and-reported or refused exactly as a damaged document
//     would be;
//   - a garbage link is an error MESSAGE, never a throw — the app must stay
//     usable whatever was pasted into the address bar.
//
// The App owns what happens next (marking it Shared, view-only, reveal mode,
// clearing the fragment); this file only turns a hash into an outcome.
// ============================================================================

import type { DocMeta, HydratedBoard, LoadResult } from '../core/persist'
import type { ShareFlags, StreamCodecs } from '../core/share'
import { decodeSharePayload, parseShareHash } from '../core/share'

export interface OpenShareDeps {
  /** deserializeDoc, with whatever options the board loads with. */
  load(json: string): LoadResult
  /** A brand-new document id. */
  newId(): string
  now(): number
}

export type OpenShareOutcome =
  | { kind: 'none' }
  | { kind: 'error'; message: string; problems: string[] }
  | { kind: 'open'; meta: DocMeta; board: HydratedBoard; flags: ShareFlags; problems: string[] }

/** What a shared document is called when the link did not say. */
export function sharedDocName(name: string | null | undefined): string {
  const n = typeof name === 'string' ? name.trim() : ''
  return n || 'Shared graph'
}

export async function openShare(
  hash: string,
  deps: OpenShareDeps,
  codecs?: StreamCodecs,
): Promise<OpenShareOutcome> {
  const parsed = parseShareHash(hash)
  if (parsed.kind === 'none') return { kind: 'none' }
  let decoded: Awaited<ReturnType<typeof decodeSharePayload>>
  try {
    decoded = await decodeSharePayload(parsed.payload, codecs)
  } catch {
    decoded = { ok: false, error: 'This share link could not be read.' }
  }
  if (!decoded.ok) return { kind: 'error', message: decoded.error, problems: [] }
  let res: LoadResult
  try {
    res = deps.load(decoded.json)
  } catch {
    return { kind: 'error', message: 'This share link could not be opened.', problems: [] }
  }
  if (!res.meta || !res.board) {
    return {
      kind: 'error',
      message: 'This share link does not contain a document Grapher can open.',
      problems: res.problems,
    }
  }
  const now = deps.now()
  const meta: DocMeta = {
    id: deps.newId(),
    name: sharedDocName(res.meta.name),
    createdAt: res.meta.createdAt || now,
    modifiedAt: now,
  }
  return { kind: 'open', meta, board: res.board, flags: parsed.flags, problems: res.problems }
}
