// ============================================================================
// src/app/useCourseFocus.ts — the first run, the courses a teacher chose, and
// the honest-storage nudges (backup notice and reminder, restore, About).
//
//   * First run: a brand-new teacher (no saved documents, never asked, not a
//     share or gallery link) opens on "What do you teach?" instead of an
//     empty board (src/ui/FirstRun.tsx). Decided ONCE, from what storage and
//     the address said when the app opened (src/ui/courses.ts).
//   * The choice is Prefs.courses. It tailors Build ▾, the gallery's filter
//     and where the help sheet opens — and is changed under Settings → Your
//     courses or the help sheet's "Your courses".
//   * Teachers who were never asked (they had documents before) get a
//     one-time tip in the settings menu instead.
//   * After the first saved edit: "Your graphs are saved in this browser
//     only." once. With more than five documents, a gentle reminder in the
//     document menu every two weeks. Only timestamps are stored.
//
// Called once per render by App (src/App.tsx), in sequence with the other
// src/app hooks — after useExamples and useDocumentActions, before
// useCommands, which offers these as commands.
// ============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BRAND, FEEDBACK_URL, ISSUES_URL } from '../brand'
import { readDocJSON, listDocs, listWorksheets, readIndex, readPrefs, updatePrefs, writeDoc, writeWorksheet } from '../ui/storage'
import {
  backupFileName,
  makeBackup,
  parseBackup,
  restoreBackup,
  restoreSummary,
  serializeBackup,
} from '../ui/backup'
import type { BackupIO } from '../ui/backup'
import { backupReminderDue, coursesTipDue, shouldShowFirstRun } from '../ui/courses'
import type { CourseId } from '../ui/courses'
import type { FirstRunStart } from '../ui/FirstRun'
import type { DocumentStateApi } from './useDocumentState'
import type { NoticesApi } from './useNotices'
import type { DocumentPersistenceApi } from './useDocumentPersistence'
import type { DocumentActionsApi } from './useDocumentActions'
import type { ExamplesApi } from './useExamples'
import type { BoardRefsApi } from './useBoardRefs'


/** What useCourseFocus reads from the hooks App calls before it. */
export interface CourseFocusDeps {
  docState: DocumentStateApi
  refs: BoardRefsApi
  notices: NoticesApi
  persistence: DocumentPersistenceApi
  docActions: DocumentActionsApi
  examples: ExamplesApi
}

/** The storage this browser has, as a backup reads and writes it. */
export const storageBackupIO: BackupIO = {
  docIds: () => readIndex().docs.map((d) => d.id),
  readDoc: readDocJSON,
  writeDoc: (doc) => writeDoc(doc).ok,
  worksheets: listWorksheets,
  writeWorksheet: (w) => writeWorksheet(w).ok,
}

/** Where "Feedback" goes: the feedback address once it is set, the issue tracker until then. */
export const feedbackHref = (): string => FEEDBACK_URL || ISSUES_URL

export function useCourseFocus({ docState, refs, notices, persistence, docActions, examples }: CourseFocusDeps) {
  const { docs, setDocs, saveState, shared, setLoadNotice } = docState
  const { docStoredRef, undoRef } = refs
  const { showToast } = notices
  const { saveNow } = persistence
  const { importDocument, openWorksheet } = docActions
  const { openGallery } = examples

  const [courses, setCoursesState] = useState<CourseId[] | undefined>(() => readPrefs().courses)
  /** 'first': the first-run chooser; 'settings': "Your courses" from a menu. */
  const [chooser, setChooser] = useState<null | 'first' | 'settings'>(() => {
    let savedDocs = 0
    try {
      savedDocs = readIndex().docs.length
    } catch {
      savedDocs = 0
    }
    return shouldShowFirstRun({
      savedDocs,
      courses: readPrefs().courses,
      search: window.location.search,
      hash: window.location.hash,
    })
      ? 'first'
      : null
  })
  const [tipDismissed, setTipDismissed] = useState<boolean>(() => readPrefs().coursesTipDone === true)
  const [aboutOpen, setAboutOpen] = useState(false)

  /** Store a choice; choosing also retires the settings tip. */
  const chooseCourses = useCallback((next: CourseId[]): void => {
    setCoursesState(next)
    setTipDismissed(true)
    updatePrefs({ courses: next, coursesTipDone: true })
  }, [])

  const openCourses = useCallback((): void => setChooser('settings'), [])
  const closeChooser = useCallback((): void => setChooser(null), [])

  /** The first run's end: the courses (skip stores what was picked, maybe nothing), then where to start. */
  const finishFirstRun = useCallback(
    (picked: CourseId[], start: FirstRunStart | null): void => {
      chooseCourses(picked)
      setChooser(null)
      if (start === 'examples') openGallery()
      else if (start === 'worksheet') openWorksheet()
      else window.setTimeout(() => document.getElementById('board-canvas')?.focus({ preventScroll: true }), 0)
    },
    [chooseCourses, openGallery, openWorksheet],
  )

  const dismissTip = useCallback((): void => {
    setTipDismissed(true)
    updatePrefs({ coursesTipDone: true })
  }, [])

  // ------------------------------------------------------------- backups

  const [lastBackupAt, setLastBackupAt] = useState<number | undefined>(() => readPrefs().lastBackupAt)
  const [backupRemindAt, setBackupRemindAt] = useState<number | undefined>(() => readPrefs().backupRemindAt)
  const [storageNotice, setStorageNotice] = useState(false)

  /** Save a backup: every document and worksheet, as one .json download. */
  const saveBackup = useCallback((): void => {
    // The open board's latest edits go into the file too.
    saveNow()
    const now = Date.now()
    const { backup, skipped } = makeBackup(storageBackupIO, now)
    const blob = new Blob([serializeBackup(backup)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = backupFileName(now, BRAND)
    a.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    setLastBackupAt(now)
    updatePrefs({ lastBackupAt: now })
    setStorageNotice(false)
    const n = backup.docs.length
    showToast(
      `Saved a backup of ${n} document${n === 1 ? '' : 's'}${skipped > 0 ? ` (${skipped} unreadable left out)` : ''}. Keep the file somewhere safe — Restore from backup brings them back.`,
      { ms: 6000 },
    )
  }, [saveNow, showToast])

  /** Restore from a file: a full backup comes back beside what is here; a single document is imported. */
  const restoreFromFile = useCallback(
    (file: File): void => {
      file
        .text()
        .then((text) => {
          const parsed = parseBackup(text)
          if (parsed.kind === 'not-backup') {
            importDocument(file)
            return
          }
          if (parsed.kind === 'error') {
            setLoadNotice({ problems: [parsed.message], fatal: true })
            return
          }
          saveNow()
          const report = restoreBackup(parsed.backup, storageBackupIO)
          setDocs(listDocs())
          if (parsed.problems.length > 0) setLoadNotice({ problems: parsed.problems, fatal: false })
          showToast(`${restoreSummary(report)} Open them from the document menu.`, { ms: 7000 })
        })
        .catch(() => setLoadNotice({ problems: ['That file could not be read.'], fatal: true }))
    },
    [importDocument, saveNow, setDocs, setLoadNotice, showToast],
  )

  /** Restore from backup…: the file picker. */
  const pickRestore = useCallback((): void => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'application/json,.json'
    input.onchange = () => {
      const file = input.files?.[0]
      if (file) restoreFromFile(file)
    }
    input.click()
  }, [restoreFromFile])

  // "Saved in this browser only": once, after the first edit that is saved.
  const prevSave = useRef(saveState)
  useEffect(() => {
    const was = prevSave.current
    prevSave.current = saveState
    if (was !== 'saving' || saveState !== 'saved') return
    // A real edit (something to undo), written to this browser — not a
    // document that was merely opened, framed or created.
    if (shared || !docStoredRef.current || undoRef.current.length === 0) return
    if (readPrefs().storageNoticeDone) return
    updatePrefs({ storageNoticeDone: true })
    setStorageNotice(true)
  }, [saveState, shared])
  const dismissStorageNotice = useCallback((): void => setStorageNotice(false), [])

  /** The document menu's gentle reminder: due every two weeks with more than five documents. */
  const backupDue = useMemo(
    () =>
      !shared &&
      backupReminderDue({
        now: Date.now(),
        docs: docs.length,
        oldestCreatedAt: docs.reduce((m, d) => (d.createdAt > 0 && (m === 0 || d.createdAt < m) ? d.createdAt : m), 0),
        lastBackupAt,
        backupRemindAt,
      }),
    [docs, lastBackupAt, backupRemindAt, shared],
  )
  const snoozeBackup = useCallback((): void => {
    const now = Date.now()
    setBackupRemindAt(now)
    updatePrefs({ backupRemindAt: now })
  }, [])

  const openAbout = useCallback((): void => setAboutOpen(true), [])
  const closeAbout = useCallback((): void => setAboutOpen(false), [])
  const openFeedback = useCallback((): void => {
    window.open(feedbackHref(), '_blank', 'noopener')
  }, [])

  return {
    courses,
    chooseCourses,
    /** The chooser, unless a share link is open (a student never sees it). */
    chooser: shared ? null : chooser,
    openCourses,
    closeChooser,
    finishFirstRun,
    tipDue: !shared && coursesTipDue(courses, tipDismissed),
    dismissTip,
    saveBackup,
    restoreFromFile,
    pickRestore,
    storageNotice: storageNotice && !shared,
    dismissStorageNotice,
    backupDue,
    snoozeBackup,
    aboutOpen,
    openAbout,
    closeAbout,
    openFeedback,
  }
}

export type CourseFocusApi = ReturnType<typeof useCourseFocus>
