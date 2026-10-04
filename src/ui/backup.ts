// ============================================================================
// src/ui/backup.ts — "Save a backup" and "Restore from backup": every
// document and worksheet in this browser, in one .json file.
//
// Grapher keeps everything in this browser's storage (src/ui/storage.ts), and
// a school Chromebook can clear that overnight. A backup is the honest answer:
// one file the teacher keeps, that brings every board back.
//
// THE FILE. { app: 'grapher-backup', version: 1, savedAt, docs: [...],
// worksheets: [...] }. Each entry of `docs` is a stored document exactly as
// storage holds it — the record is parsed, never rebuilt — so a document that
// goes out and comes back is BYTE-IDENTICAL (serializeDoc is JSON.stringify,
// and JSON.parse → JSON.stringify of its own output is the identity).
//
// RESTORE never overwrites and never deletes. A document already here with
// the same bytes is skipped; one that is here and newer (or as new) is kept
// as it is; one whose backup copy is newer comes back BESIDE it under a new
// id and "(restored)" name. Worksheets are added when their id is new. The
// open board is not touched.
//
// A single document file (Download this document) is not a backup; the App
// routes it to the ordinary import.
// ============================================================================

import type { StoredDoc, Worksheet } from '../core/persist'
import { createDoc, deserializeWorksheets, serializeDoc } from '../core/persist'

export const BACKUP_APP = 'grapher-backup'
export const BACKUP_VERSION = 1

export interface LibraryBackup {
  app: typeof BACKUP_APP
  version: number
  savedAt: number
  docs: StoredDoc[]
  worksheets: Worksheet[]
}

/** What a backup reads from and writes to (storage.ts in the App; a map in tests). */
export interface BackupIO {
  /** Every document id in the index. */
  docIds(): string[]
  /** One stored record, raw, or null. */
  readDoc(id: string): string | null
  /** Write one document (the index entry with it). False when storage refused. */
  writeDoc(doc: StoredDoc): boolean
  worksheets(): Worksheet[]
  writeWorksheet(sheet: Worksheet): boolean
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * The shape every stored document has. Deliberately shallow: the board inside
 * is validated by the loader when the document is OPENED (which repairs and
 * reports), and is kept here exactly as it was.
 */
export function isStoredDocShape(v: unknown): v is StoredDoc {
  return (
    isObj(v) &&
    typeof v.version === 'number' &&
    typeof v.id === 'string' &&
    v.id.length > 0 &&
    typeof v.name === 'string' &&
    typeof v.createdAt === 'number' &&
    typeof v.modifiedAt === 'number' &&
    isObj(v.board)
  )
}

/** Every document and worksheet, as a backup. Unreadable records are skipped (and counted). */
export function makeBackup(io: BackupIO, now = Date.now()): { backup: LibraryBackup; skipped: number } {
  const docs: StoredDoc[] = []
  let skipped = 0
  for (const id of io.docIds()) {
    const raw = io.readDoc(id)
    if (raw === null) continue
    try {
      const parsed: unknown = JSON.parse(raw)
      if (isStoredDocShape(parsed)) docs.push(parsed)
      else skipped++
    } catch {
      skipped++
    }
  }
  return {
    backup: { app: BACKUP_APP, version: BACKUP_VERSION, savedAt: now, docs, worksheets: io.worksheets() },
    skipped,
  }
}

export function serializeBackup(b: LibraryBackup): string {
  return JSON.stringify(b)
}

/** "grapher-backup-2026-10-04.json". */
export function backupFileName(now: number, brand = 'grapher'): string {
  const d = new Date(now)
  const pad = (n: number): string => String(n).padStart(2, '0')
  const slug = brand.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'grapher'
  return `${slug}-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.json`
}

export type ParsedBackup =
  | { kind: 'backup'; backup: LibraryBackup; problems: string[] }
  /** Not a backup: a single document file, or something else for the ordinary import to judge. */
  | { kind: 'not-backup' }
  | { kind: 'error'; message: string }

/** Read a file's text. Never throws. */
export function parseBackup(text: string): ParsedBackup {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { kind: 'not-backup' }
  }
  if (!isObj(raw) || raw.app !== BACKUP_APP) return { kind: 'not-backup' }
  if (typeof raw.version !== 'number' || !Array.isArray(raw.docs)) {
    return { kind: 'error', message: 'That backup file is damaged and could not be read.' }
  }
  const problems: string[] = []
  if (raw.version > BACKUP_VERSION) problems.push('This backup was made by a newer version; anything unknown was skipped.')
  const docs: StoredDoc[] = []
  let bad = 0
  for (const d of raw.docs) {
    if (isStoredDocShape(d)) docs.push(d)
    else bad++
  }
  if (bad > 0) problems.push(`${bad} damaged document${bad === 1 ? ' was' : 's were'} skipped.`)
  const sheets = deserializeWorksheets(JSON.stringify({ version: 1, sheets: Array.isArray(raw.worksheets) ? raw.worksheets : [] }))
  problems.push(...sheets.problems)
  return {
    kind: 'backup',
    backup: {
      app: BACKUP_APP,
      version: raw.version,
      savedAt: typeof raw.savedAt === 'number' ? raw.savedAt : 0,
      docs,
      worksheets: sheets.sheets,
    },
    problems,
  }
}

export interface RestoreReport {
  /** Documents that were not here and now are. */
  added: number
  /** Backup copies newer than the document here: added beside it, renamed. */
  restoredBeside: number
  /** Already here, the same or newer. */
  kept: number
  /** Storage refused them (full?). */
  failed: number
  worksheets: number
}

/** The name a backup copy takes beside a newer-or-different document here. */
export function restoredName(name: string): string {
  return `${name} (restored)`
}

/** Bring a backup back. Never overwrites, never deletes (see the header). */
export function restoreBackup(b: LibraryBackup, io: BackupIO, now = Date.now()): RestoreReport {
  const report: RestoreReport = { added: 0, restoredBeside: 0, kept: 0, failed: 0, worksheets: 0 }
  const here = new Set(io.docIds())
  for (const doc of b.docs) {
    if (!here.has(doc.id)) {
      if (io.writeDoc(doc)) {
        report.added++
        here.add(doc.id)
      } else report.failed++
      continue
    }
    const stored = io.readDoc(doc.id)
    if (stored === serializeDoc(doc)) {
      report.kept++
      continue
    }
    let storedAt = 0
    try {
      const p: unknown = stored === null ? null : JSON.parse(stored)
      storedAt = isObj(p) && typeof p.modifiedAt === 'number' ? p.modifiedAt : 0
    } catch {
      storedAt = 0
    }
    if (stored !== null && storedAt >= doc.modifiedAt) {
      report.kept++
      continue
    }
    // The backup's copy is newer (or the record here is unreadable): bring
    // it back beside it, under its own id — nothing here is replaced.
    const fresh = createDoc(restoredName(doc.name), doc.board, now)
    const copy: StoredDoc = { ...doc, id: fresh.id, name: fresh.name }
    if (io.writeDoc(copy)) report.restoredBeside++
    else report.failed++
  }
  const sheetIds = new Set(io.worksheets().map((w) => w.id))
  for (const w of b.worksheets) {
    if (sheetIds.has(w.id)) continue
    if (io.writeWorksheet(w)) {
      report.worksheets++
      sheetIds.add(w.id)
    }
  }
  return report
}

/** One line for the toast: what came back. */
export function restoreSummary(r: RestoreReport): string {
  const parts: string[] = []
  const n = r.added + r.restoredBeside
  parts.push(n === 0 ? 'Nothing new to restore' : `Restored ${n} document${n === 1 ? '' : 's'}`)
  if (r.restoredBeside > 0) parts.push(`${r.restoredBeside} beside a newer copy here, marked “(restored)”`)
  if (r.kept > 0) parts.push(`${r.kept} already here`)
  if (r.worksheets > 0) parts.push(`${r.worksheets} worksheet${r.worksheets === 1 ? '' : 's'}`)
  if (r.failed > 0) parts.push(`${r.failed} could not be saved (storage full?)`)
  return `${parts.join(' · ')}.`
}
