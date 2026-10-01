// ============================================================================
// src/app/useDocumentActions.ts — the document menu: new, open, rename, duplicate, delete, import, export.
//
// Also the worksheet editor, the shared copy and the share dialog.
//
// Called once per render by App (src/App.tsx), in sequence with the other
// src/app hooks. The order of those calls is the order of every useState, ref,
// memo and effect on the board, so a new hook goes where its inputs exist.
// ============================================================================

import { useCallback, useState } from 'react'
import { createDoc, deserializeDoc, docFromBoard, emptyBoard, serializeDoc } from '../core/persist'
import type { DocMeta } from '../core/persist'
import type { BoardKind } from '../core/types'
import { copyDocName, nextDocName } from '../ui/docName'
import {
  copyExportSettings,
  listDocs,
  readDocJSON,
  removeDoc,
  setCurrentDoc,
  updatePrefs,
  writeDoc,
} from '../ui/storage'
import type { BoardStateApi } from './useBoardState'
import type { DocumentStateApi } from './useDocumentState'
import type { SessionStateApi } from './useSessionState'
import type { BoardRefsApi } from './useBoardRefs'
import type { ModelsApi } from './useModels'
import type { NoticesApi } from './useNotices'
import type { HistoryApi } from './useHistory'
import type { DocumentPersistenceApi } from './useDocumentPersistence'

/** What useDocumentActions reads from the hooks App calls before it. */
export interface DocumentActionsDeps {
  board: BoardStateApi
  docState: DocumentStateApi
  session: SessionStateApi
  refs: BoardRefsApi
  derived: ModelsApi
  notices: NoticesApi
  history: HistoryApi
  persistence: DocumentPersistenceApi
}

export function useDocumentActions({ board, docState, session, refs, derived, notices, history, persistence }: DocumentActionsDeps) {
  const { setSelectedId } = board
  const {
    setDocMeta, setDocs, setSaveState, setSaveError, setLoadNotice, setConflict, sharedRef,
    setSharedState, makeSharedCopyRef, setShareDialog, setSwitchBlocked,
  } = docState
  const { setShowAnalysis, revealRef, revealByDocRef } = session
  const { kindRef, docMetaRef, docStoredRef } = refs
  const { resolveName, singularOf, vpRef, stageRef, nlStageRef } = derived
  const { showToast } = notices
  const { commitState } = history
  const { blankBoard, currentBoardInput, saveBeforeSwitch, applyHydrated } = persistence

  // ------------------------------------------------------------ worksheets
  //
  // The sheet reads documents from STORAGE, so the open one is written first
  // (when it has unsaved changes) — otherwise its figure on the sheet would be
  // the version from before the last edit. The board itself is untouched
  // underneath and is exactly as it was when the sheet closes.
  const [worksheetOpen, setWorksheetOpen] = useState(false)
  const openWorksheet = useCallback((): void => {
    saveBeforeSwitch()
    setDocs(listDocs())
    setWorksheetOpen(true)
  }, [saveBeforeSwitch])

  const renameDoc = useCallback((name: string): void => {
    const next = { ...docMetaRef.current, name }
    docMetaRef.current = next
    setDocMeta(next)
  }, [])

  const newDocument = useCallback(
    (nextKind: BoardKind = 'cartesian'): void => {
      // Refuse to replace the board when the work on it isn't on disk.
      if (!saveBeforeSwitch()) return
      // "Untitled / Untitled copy / Untitled copy copy", told apart only by
      // "just now" and "4 min ago", was the whole documents list. A board is
      // named for what it IS and numbered from what is already there.
      const doc = createDoc(
        nextDocName(nextKind, listDocs().map((d) => d.name)),
        emptyBoard(nextKind),
      )
      const meta: DocMeta = {
        id: doc.id,
        name: doc.name,
        createdAt: doc.createdAt,
        modifiedAt: doc.modifiedAt,
      }
      applyHydrated(meta, blankBoard(nextKind))
      setLoadNotice(null)
      setConflict(null)
      docStoredRef.current = writeDoc(doc).ok
      setCurrentDoc(meta.id)
      setDocs(listDocs())
    },
    [applyHydrated, blankBoard, saveBeforeSwitch],
  )

  /**
   * Turn this document into the other kind of board.
   *
   * Nothing is thrown away: a board keeps both its curves and its items, and
   * the kind only decides which of the two it is showing and editing. Switching
   * back brings the other set straight back, which is the only behaviour that
   * makes the switch safe to try — and it is one undo step either way.
   */
  const setBoardKind = useCallback(
    (nextKind: BoardKind): void => {
      if (nextKind === kindRef.current) return
      commitState({ kind: nextKind })
      setSelectedId(null)
      if (nextKind === 'number-line') vpRef.current.center = { x: vpRef.current.center.x, y: 0 }
      stageRef.current?.redraw()
      nlStageRef.current?.redraw()
    },
    [commitState],
  )

  const openDocument = useCallback(
    (id: string): void => {
      if (id === docMetaRef.current.id) return
      if (!saveBeforeSwitch()) return
      const json = readDocJSON(id)
      const res = json === null ? null : deserializeDoc(json, { resolve: resolveName, singularities: singularOf })
      if (!res || !res.meta || !res.board) {
        setLoadNotice({
          problems: res?.problems ?? ['That document could not be found.'],
          fatal: true,
        })
        return
      }
      applyHydrated(res.meta, res.board)
      docStoredRef.current = true
      setConflict(null)
      setLoadNotice(res.problems.length > 0 ? { problems: res.problems, fatal: false } : null)
      setCurrentDoc(res.meta.id)
      setDocs(listDocs())
    },
    [applyHydrated, saveBeforeSwitch],
  )

  /**
   * Re-target the board in memory at a brand-new document record and write it.
   * Used both by Duplicate and by the "save a copy" escape from a cross-tab
   * conflict, where the current record must not be overwritten.
   */
  const saveBoardAsNewDoc = useCallback(
    (name: string): boolean => {
      const from = docMetaRef.current.id
      const fresh = createDoc(name, emptyBoard())
      const meta: DocMeta = {
        id: fresh.id,
        name: fresh.name,
        createdAt: fresh.createdAt,
        modifiedAt: fresh.modifiedAt,
      }
      const doc = docFromBoard(meta, currentBoardInput())
      const res = writeDoc(doc)
      if (!res.ok) {
        setSaveState('error')
        if (!('conflict' in res)) setSaveError(res.message)
        return false
      }
      // Keep the stamp we just wrote, or the next autosave reads storage as
      // "newer than us" and reports a conflict against our own write.
      docMetaRef.current = { ...meta, modifiedAt: doc.modifiedAt }
      docStoredRef.current = true
      // A copy is the same figure under a new id, so it has to come out the
      // same size. Leaving that to the global "last used" defaults is what
      // reset a 1x document to 2x when it was saved as a copy from the
      // conflict banner — the copy must carry its own settings across.
      copyExportSettings(from, meta.id)
      setDocMeta(meta)
      setCurrentDoc(meta.id)
      setDocs(listDocs())
      setSaveState('saved')
      setSaveError(null)
      setConflict(null)
      setSwitchBlocked(null)
      return true
    },
    [currentBoardInput],
  )

  const copyName = useCallback(
    (): string =>
      copyDocName(kindRef.current, docMetaRef.current.name, listDocs().map((d) => d.name)),
    [],
  )

  /**
   * Keep the shared document: write it into this browser's documents under a
   * fresh id, and from then on it is an ordinary document of theirs. The
   * reveal state comes along (the class is mid-lesson), and so does undo.
   */
  const makeSharedCopy = useCallback(
    (why: 'asked' | 'switch'): boolean => {
      const was = sharedRef.current
      if (!was) return true
      const names = listDocs().map((d) => d.name)
      const base = docMetaRef.current.name
      const taken = names.some((n) => n.trim().toLowerCase() === base.trim().toLowerCase())
      const name = taken ? copyDocName(kindRef.current, base, names) : base
      const revealNow = revealRef.current
      // No longer shared BEFORE the write, or the save path would refuse it.
      setSharedState(null)
      if (!saveBoardAsNewDoc(name)) {
        setSharedState(was)
        showToast('Couldn’t save a copy — browser storage refused it. Use Save a backup… instead.', { ms: 6000 })
        return false
      }
      revealByDocRef.current.set(docMetaRef.current.id, revealNow)
      showToast(
        why === 'switch'
          ? `Your changes to the shared graph were saved to your documents as “${name}”.`
          : `Saved “${name}” to your documents — it’s yours to edit.`,
        { ms: 4500 },
      )
      return true
    },
    [saveBoardAsNewDoc, setSharedState, showToast],
  )
  makeSharedCopyRef.current = makeSharedCopy

  const duplicateDocument = useCallback((): void => {
    // Duplicating a shared document is keeping it.
    if (sharedRef.current) {
      makeSharedCopy('asked')
      return
    }
    if (!saveBeforeSwitch()) return
    saveBoardAsNewDoc(copyName())
  }, [saveBeforeSwitch, saveBoardAsNewDoc, copyName, makeSharedCopy])

  /** Document menu → Share link…: the board as it is right now. */
  const openShareDialog = useCallback((): void => {
    setShareDialog({ json: serializeDoc(docFromBoard(docMetaRef.current, currentBoardInput())) })
  }, [currentBoardInput])

  const deleteDocument = useCallback(
    (id: string): void => {
      removeDoc(id)
      const remaining = listDocs()
      setDocs(remaining)
      if (id !== docMetaRef.current.id) return
      const next = remaining[0]
      if (next) {
        const json = readDocJSON(next.id)
        const res = json === null ? null : deserializeDoc(json, { resolve: resolveName, singularities: singularOf })
        if (res?.meta && res.board) {
          applyHydrated(res.meta, res.board)
          docStoredRef.current = true
          setConflict(null)
          setLoadNotice(res.problems.length > 0 ? { problems: res.problems, fatal: false } : null)
          setCurrentDoc(res.meta.id)
          return
        }
      }
      newDocument()
    },
    [applyHydrated, newDocument],
  )

  const toggleAnalysis = useCallback((): void => {
    setShowAnalysis((v) => {
      const next = !v
      updatePrefs({ showAnalysis: next })
      return next
    })
  }, [])

  const exportDocument = useCallback((): void => {
    const meta = docMetaRef.current
    const json = serializeDoc(docFromBoard(meta, currentBoardInput()))
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const safe = meta.name.replace(/[^\w\d\-. ]+/g, '_').trim() || 'grapher'
    const a = document.createElement('a')
    a.href = url
    a.download = `${safe}.grapher.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }, [currentBoardInput])

  const importDocument = useCallback(
    (file: File): void => {
      file
        .text()
        .then((text) => {
          const res = deserializeDoc(text, { resolve: resolveName, singularities: singularOf })
          if (!res.board || !res.meta) {
            setLoadNotice({
              problems: res.problems.length ? res.problems : ['That file could not be read.'],
              fatal: true,
            })
            return
          }
          // The import replaces the board, so the board it replaces must be
          // safely on disk first.
          if (!saveBeforeSwitch()) return
          // Always mint a new id so an import can never overwrite a document
          // that happens to share an id with the file.
          const fallback = file.name.replace(/\.(grapher\.)?json$/i, '')
          const fresh = createDoc(res.meta.name || fallback || 'Imported', emptyBoard())
          const meta: DocMeta = {
            id: fresh.id,
            name: fresh.name,
            createdAt: res.meta.createdAt || fresh.createdAt,
            modifiedAt: Date.now(),
          }
          applyHydrated(meta, res.board)
          setConflict(null)
          setLoadNotice(res.problems.length > 0 ? { problems: res.problems, fatal: false } : null)
          const doc = docFromBoard(meta, currentBoardInput())
          const written = writeDoc(doc)
          if (written.ok) {
            docMetaRef.current = { ...meta, modifiedAt: doc.modifiedAt }
            docStoredRef.current = true
            setSaveState('saved')
          } else {
            docStoredRef.current = false
            setSaveState('error')
            if (!('conflict' in written)) setSaveError(written.message)
          }
          setCurrentDoc(meta.id)
          setDocs(listDocs())
        })
        .catch(() => {
          setLoadNotice({ problems: ['That file could not be read.'], fatal: true })
        })
    },
    [applyHydrated, currentBoardInput, saveBeforeSwitch],
  )

  return {
    worksheetOpen, setWorksheetOpen, openWorksheet, renameDoc, newDocument, setBoardKind,
    openDocument, saveBoardAsNewDoc, copyName, makeSharedCopy, duplicateDocument, openShareDialog,
    deleteDocument, toggleAnalysis, exportDocument, importDocument,
  }
}

export type DocumentActionsApi = ReturnType<typeof useDocumentActions>
