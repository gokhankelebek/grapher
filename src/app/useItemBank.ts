// ============================================================================
// src/app/useItemBank.ts — the AP item-bank bridge: "Copy for item bank…"
// (Download ▾, ⌘K) and "Graph from item…" (Document menu, ⌘K).
//
// Copy for item bank draws the OPEN document's figure for a stem: the board as
// it would be saved (serializeDoc of currentBoardInput), loaded back through
// docScene — the worksheet's student / key path — and written as a block
// (src/ui/itemBank.ts). Nothing on the board, and no preference, changes.
//
// Graph from item reads pasted LaTeX (a stem or a whole %%% ITEM record) and
// opens what it defines as a NEW document named from the item id, through the
// examples gallery's openBuilt: the open board is saved first, nothing the
// teacher already has is touched.
//
// Called once per render by App (src/App.tsx), in sequence with the other
// src/app hooks. The order of those calls is the order of every useState, ref,
// memo and effect on the board, so a new hook goes where its inputs exist.
// ============================================================================

import { useCallback, useState } from 'react'
import { docFromBoard, serializeDoc } from '../core/persist'
import { docModelFromJSON } from '../ui/docScene'
import { clampFitSettings } from '../ui/exportFit'
import type { BankFigure, BankOptions, ItemPlan } from '../ui/itemBank'
import { lazyModule } from '../ui/lazyLoad'
import { listDocs } from '../ui/storage'
import type { BoardRefsApi } from './useBoardRefs'
import type { ModelsApi } from './useModels'
import type { NoticesApi } from './useNotices'
import type { DocumentPersistenceApi } from './useDocumentPersistence'
import type { BoardOverlaysApi } from './useBoardOverlays'
import type { ExamplesApi } from './useExamples'

/**
 * The item bank (src/ui/itemBank.ts, with the LaTeX importer and the TikZ /
 * pgfplots writers it uses) loads with its dialogs — App's lazy dialogs wait
 * for this, and nothing else calls into it.
 */
export const itemBankLib = lazyModule(() => import('../ui/itemBank'))

/** What useItemBank reads from the hooks App calls before it. */
export interface ItemBankDeps {
  refs: BoardRefsApi
  derived: ModelsApi
  notices: NoticesApi
  persistence: DocumentPersistenceApi
  overlaysApi: BoardOverlaysApi
  examples: ExamplesApi
}

/** How a copy went: on the clipboard, or downloaded because the clipboard refused. */
export type BankCopyResult = { ok: true } | { ok: false; reason: string }

export function useItemBank({ refs, derived, notices, persistence, overlaysApi, examples }: ItemBankDeps) {
  const { docMetaRef } = refs
  const { vpRef } = derived
  const { showToast } = notices
  const { currentBoardInput } = persistence
  const { exportSettingsRef } = overlaysApi
  const { openBuilt } = examples

  const [bankOpen, setBankOpen] = useState(false)
  const [itemOpen, setItemOpen] = useState(false)

  const openBankCopy = useCallback((): void => {
    setItemOpen(false)
    setBankOpen(true)
  }, [])
  const closeBankCopy = useCallback((): void => setBankOpen(false), [])
  const openGraphFromItem = useCallback((): void => {
    setBankOpen(false)
    setItemOpen(true)
  }, [])
  const closeGraphFromItem = useCallback((): void => setItemOpen(false), [])

  /** The open document's bank figure for these options; null when it cannot be drawn. */
  const buildBankFigure = useCallback((opts: BankOptions): BankFigure | null => {
    try {
      const json = serializeDoc(docFromBoard(docMetaRef.current, currentBoardInput()))
      const vp = vpRef.current
      const model = docModelFromJSON(json, {
        screen: { widthPx: vp.widthPx, heightPx: vp.heightPx },
        settings: clampFitSettings(exportSettingsRef.current),
      })
      const lib = itemBankLib.get()
      return model && lib ? lib.bankFigure(model, opts) : null
    } catch {
      return null
    }
  }, [currentBoardInput])

  /** Save text as a .tex download (the clipboard's fallback). */
  const downloadTex = useCallback((text: string, fileName: string): void => {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/x-tex' }))
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }, [])

  /**
   * Put text on the clipboard; when the browser refuses, download it as a
   * .tex file and say why — the same contract as Copy LaTeX.
   */
  const copyBankText = useCallback(
    (text: string, fileName: string, what: string): Promise<BankCopyResult> => {
      const fallBack = (reason: string): BankCopyResult => {
        downloadTex(text, fileName)
        showToast(`Couldn’t copy — ${reason}. Downloaded ${fileName} instead.`)
        return { ok: false, reason }
      }
      if (typeof navigator === 'undefined' || !navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
        return Promise.resolve(fallBack('this browser has no clipboard write access'))
      }
      return navigator.clipboard.writeText(text).then(
        (): BankCopyResult => {
          showToast(`Copied ${what} — paste it into the item’s record in bank.tex.`, { ms: 2600 })
          return { ok: true }
        },
        (err: unknown) =>
          fallBack(
            err instanceof Error && err.name === 'NotAllowedError'
              ? 'the browser blocked it (the page has to be focused)'
              : 'the browser refused',
          ),
      )
    },
    [downloadTex, showToast],
  )

  /** Open the plan as a new document. True when it opened. */
  const graphItem = useCallback(
    (plan: ItemPlan): boolean => {
      if (plan.empty) return false
      const lib = itemBankLib.get()
      if (!lib) return false
      const name = lib.itemDocName(plan.baseName, listDocs().map((d) => d.name))
      let built: ReturnType<typeof lib.buildItemDoc>
      try {
        built = lib.buildItemDoc(plan, name)
      } catch {
        showToast('That item could not be graphed.')
        return false
      }
      const tail = plan.needsFigure ? ' This item needs a figure — build it, then use Copy for item bank.' : ''
      const refused = built.problems.length > 0 ? ` (${built.problems.length} line${built.problems.length === 1 ? '' : 's'} could not be graphed)` : ''
      const ok = openBuilt(built.json, built.window, name, `Opened “${name}”${refused}.${tail}`)
      if (ok) setItemOpen(false)
      return ok
    },
    [openBuilt, showToast],
  )

  return {
    bankOpen, openBankCopy, closeBankCopy, itemOpen, openGraphFromItem, closeGraphFromItem,
    buildBankFigure, copyBankText, downloadTex, graphItem,
  }
}

export type ItemBankApi = ReturnType<typeof useItemBank>
