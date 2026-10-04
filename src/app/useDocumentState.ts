// ============================================================================
// src/app/useDocumentState.ts — the open document: its meta, the list, save state and shared-link state.
//
// Also the typed-line maps that travel with the document (sources, edits,
// names, calls, inverses) and the Shared banner's measured offset.
//
// Called once per render by App (src/App.tsx), in sequence with the other
// src/app hooks. The order of those calls is the order of every useState, ref,
// memo and effect on the board, so a new hook goes where its inputs exist.
// ============================================================================

import type { ShareView } from '../core/share'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { DocMeta, InverseLink } from '../core/persist'
import type { SaveState } from '../ui/DocMenu'
import type { CurveEdit } from './types'

/**
 * How the open document came from a share link (null: it did not) — see
 * src/core/share.ts shareViewOf: view only, a student (view only in reveal
 * mode), the teacher note hidden, the question for the banner.
 */
export type SharedState = ShareView

export function useDocumentState() {
  // ---- documents / persistence
  const [docMeta, setDocMeta] = useState<DocMeta>(() => ({
    id: '',
    name: 'Untitled',
    createdAt: Date.now(),
    modifiedAt: Date.now(),
  }))
  const [docs, setDocs] = useState<DocMeta[]>([])
  const [saveState, setSaveState] = useState<SaveState>('saved')
  /** Sticky banner for a failed save (quota) — must not be missable. */
  const [saveError, setSaveError] = useState<string | null>(null)
  /** Set when the last load lost or repaired something. */
  const [loadNotice, setLoadNotice] = useState<{ problems: string[]; fatal: boolean } | null>(null)
  /** Another tab changed or deleted the document this tab has open. */
  const [conflict, setConflict] = useState<'stale' | 'deleted' | null>(null)
  /**
   * The open document came from a share link (src/ui/shareOpen.ts). It is a
   * TEMPORARY document: a fresh id, never written, never "current" in the
   * index, so it can never overwrite one of this browser's documents. It is
   * saved only by Make a copy — or automatically, as a copy, when it has been
   * edited and the board is about to be switched away from it. `viewOnly` is
   * the student view: nothing on the board or in the cards can be changed.
   * `student` (view only AND reveal mode) also takes away the teacher's
   * tools and the reveal-everything buttons; `noteHidden` keeps the teacher
   * note off the sidebar; `question` is the banner the link carried.
   */
  const [shared, setShared] = useState<SharedState | null>(null)
  const sharedRef = useRef(shared)
  const setSharedState = useCallback((v: SharedState | null): void => {
    sharedRef.current = v
    setShared(v)
  }, [])
  /** Set by makeSharedCopy once it exists (it is declared below saveBeforeSwitch). */
  const makeSharedCopyRef = useRef<(why: 'asked' | 'switch') => boolean>(() => true)
  /** The share dialog, with the document as it was when the dialog opened. */
  const [shareDialog, setShareDialog] = useState<{ json: string } | null>(null)
  /**
   * Where the Shared banner sits: just under the toolbar, wherever the toolbar
   * is. It wraps to two rows on a narrow board and docks to the bottom on a
   * phone, so the offset is measured rather than assumed.
   */
  const [bannerTop, setBannerTop] = useState(12)
  useEffect(() => {
    if (!shared) return
    const bar = document.querySelector<HTMLElement>('.toolbar')
    const area = document.querySelector<HTMLElement>('.canvas-area')
    if (!bar || !area || typeof ResizeObserver === 'undefined') return
    const measure = (): void => {
      const b = bar.getBoundingClientRect()
      const a = area.getBoundingClientRect()
      const docked = b.top - a.top > a.height / 2
      setBannerTop(docked ? 12 : Math.round(b.bottom - a.top + 8))
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(bar)
    ro.observe(area)
    return () => ro.disconnect()
  }, [shared])
  /** Set when a document switch was refused because this board isn't saved. */
  const [switchBlocked, setSwitchBlocked] = useState<string | null>(null)
  /** curveId -> the equation text the user typed (rebuilt into models on load). */
  const [exprSources, setExprSources] = useState<Record<string, string>>({})
  /** curveId -> why its equation could not be restored. */
  const [brokenExpr, setBrokenExpr] = useState<Record<string, string>>({})
  /** curveId -> the typed form the user wrote for a curve that is still a family. */
  const [displaySources, setDisplaySources] = useState<Record<string, string>>({})
  /** curveId -> what has been done to it since it was recognised. */
  const [edits, setEdits] = useState<Record<string, CurveEdit[]>>({})
  /**
   * curveId -> its letter. STORED and stable (src/ui/nameLinks.ts): a line
   * that says f(x − 1) has to keep meaning the same f when a curve above it
   * is deleted, so letters are handed out once and never reshuffled.
   */
  const [names, setNames] = useState<Record<string, string>>({})
  /** curveId -> the letters that typed line calls (fixed when it was typed). */
  const [calls, setCalls] = useState<Record<string, string[]>>({})
  /** "Show inverse" on any function: the links (the curves are ordinary curves). */
  const [inverses, setInverses] = useState<InverseLink[]>([])
  const [dropActive, setDropActive] = useState(false)

  return {
    docMeta, setDocMeta, docs, setDocs, saveState, setSaveState, saveError, setSaveError,
    loadNotice, setLoadNotice, conflict, setConflict, shared, setShared, sharedRef, setSharedState,
    makeSharedCopyRef, shareDialog, setShareDialog, bannerTop, switchBlocked, setSwitchBlocked,
    exprSources, setExprSources, brokenExpr, setBrokenExpr, displaySources, setDisplaySources,
    edits, setEdits, names, setNames, calls, setCalls, inverses, setInverses, dropActive,
    setDropActive,
  }
}

export type DocumentStateApi = ReturnType<typeof useDocumentState>
