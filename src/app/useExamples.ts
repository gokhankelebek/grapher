// ============================================================================
// src/app/useExamples.ts — the examples gallery: open it, open an example.
//
// An example opens as a NEW document: a copy of the example's stored board
// under a fresh id and the name "Example: U5 — graph of f′" (numbered when
// that name is taken), written to the teacher's documents like an import.
// Nothing the teacher already has is read, changed or replaced — the open
// board is saved first, exactly as New graph saves it.
//
// Also the teacher note's fold state: a note can be folded down to a chip for
// the rest of the session, per document; the note itself stays in the file.
//
// Called once per render by App (src/App.tsx), in sequence with the other
// src/app hooks. The order of those calls is the order of every useState, ref,
// memo and effect on the board, so a new hook goes where its inputs exist.
// ============================================================================

import { useCallback, useState } from 'react'
import { createDoc, deserializeDoc, docFromBoard, emptyBoard } from '../core/persist'
import type { DocMeta } from '../core/persist'
import { buildExample, exampleById, exampleCopyName } from '../examples'
import type { ExampleWindow } from '../examples'
import { listDocs, setCurrentDoc, writeDoc } from '../ui/storage'
import type { DocumentStateApi } from './useDocumentState'
import type { BoardRefsApi } from './useBoardRefs'
import type { ModelsApi } from './useModels'
import type { NoticesApi } from './useNotices'
import type { DocumentPersistenceApi } from './useDocumentPersistence'
import type { ViewportApi } from './useViewport'

/** What useExamples reads from the hooks App calls before it. */
export interface ExamplesDeps {
  docState: DocumentStateApi
  refs: BoardRefsApi
  derived: ModelsApi
  notices: NoticesApi
  persistence: DocumentPersistenceApi
  viewport: ViewportApi
}

export function useExamples({ docState, refs, derived, notices, persistence, viewport }: ExamplesDeps) {
  const { setDocs, setSaveState, setSaveError, setLoadNotice, setConflict } = docState
  const { docMetaRef, docStoredRef } = refs
  const { resolveName, singularOf } = derived
  const { showToast } = notices
  const { saveBeforeSwitch, applyHydrated, currentBoardInput } = persistence
  const { frameBox } = viewport

  const [galleryOpen, setGalleryOpen] = useState(false)
  /** Documents whose teacher note is folded to a chip this session. */
  const [foldedNotes, setFoldedNotes] = useState<ReadonlySet<string>>(() => new Set())

  const openGallery = useCallback((): void => setGalleryOpen(true), [])
  const closeGallery = useCallback((): void => setGalleryOpen(false), [])

  /**
   * Open a built document (stored JSON) as a NEW document named `name`, framed
   * to `win` on this screen — an example's copy, or a board built from an item
   * bank record (src/ui/itemBank.ts). The open board is saved first. False
   * when nothing was opened.
   */
  const openBuilt = useCallback(
    (json: string, win: ExampleWindow, name: string, message: string): boolean => {
      const res = deserializeDoc(json, { resolve: resolveName, singularities: singularOf })
      if (!res.meta || !res.board) {
        showToast('That document could not be opened.')
        return false
      }
      // The board it replaces must be safely on disk first.
      if (!saveBeforeSwitch()) return false
      const fresh = createDoc(name, emptyBoard())
      const meta: DocMeta = { id: fresh.id, name, createdAt: fresh.createdAt, modifiedAt: fresh.modifiedAt }
      applyHydrated(meta, res.board)
      setConflict(null)
      setLoadNotice(res.problems.length > 0 ? { problems: res.problems, fatal: false } : null)
      // The window it was written for, framed on THIS screen.
      const y = win.y ?? [-0.5, 0.5]
      frameBox({ min: { x: win.x[0], y: y[0] }, max: { x: win.x[1], y: y[1] } })
      const doc = docFromBoard(meta, currentBoardInput())
      const written = writeDoc(doc)
      if (written.ok) {
        docMetaRef.current = { ...meta, modifiedAt: doc.modifiedAt }
        docStoredRef.current = true
        setSaveState('saved')
        setSaveError(null)
      } else {
        docStoredRef.current = false
        setSaveState('error')
        if (!('conflict' in written)) setSaveError(written.message)
      }
      setCurrentDoc(meta.id)
      setDocs(listDocs())
      showToast(message, { ms: 4500 })
      return true
    },
    [applyHydrated, currentBoardInput, frameBox, resolveName, saveBeforeSwitch, showToast, singularOf],
  )

  /** Open example `id` as a new document copy. False when nothing was opened. */
  const openExample = useCallback(
    (id: string): boolean => {
      const def = exampleById(id)
      if (!def) return false
      let json: string
      let win: ReturnType<typeof buildExample>['window']
      try {
        const built = buildExample(def)
        json = built.json
        win = built.window
      } catch {
        showToast('That example could not be built.')
        return false
      }
      const name = exampleCopyName(def, listDocs().map((d) => d.name))
      if (!openBuilt(json, win, name, `Opened “${name}” — a copy in your documents, yours to change.`)) return false
      setGalleryOpen(false)
      return true
    },
    [openBuilt, showToast],
  )

  const setNoteFolded = useCallback((docId: string, folded: boolean): void => {
    setFoldedNotes((prev) => {
      if (prev.has(docId) === folded) return prev
      const next = new Set(prev)
      if (folded) next.add(docId)
      else next.delete(docId)
      return next
    })
  }, [])

  return { galleryOpen, openGallery, closeGallery, openExample, openBuilt, foldedNotes, setNoteFolded }
}

export type ExamplesApi = ReturnType<typeof useExamples>
