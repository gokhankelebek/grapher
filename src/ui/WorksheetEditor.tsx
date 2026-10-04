// ============================================================================
// src/ui/WorksheetEditor.tsx — compose figures from several documents onto one
// printable page.
//
// A full-window sheet over the board (the board underneath is untouched and
// comes back as it was on Close). Left: the sheet's settings and its figures —
// each with a thumbnail, its label, caption and style, reorderable by drag or
// by the arrows. Right: the pages exactly as the PDF will print them (the
// same display lists, written as SVG). The header holds the exports: Student
// PDF, Key PDF, LaTeX (copy / download, TikZ or pgfplots), PNG.
//
// Documents are read from storage, never from the open board, so the open
// document is saved first (see the App's openWorksheet).
// ============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FigureStyleId } from '../core/types'
import type { DocMeta, Worksheet, WorksheetItem } from '../core/persist'
import { DEFAULT_SHEET_STYLE, MAX_SHEET_ITEMS, newWorksheet } from '../core/persist'
import { listWorksheets, readDocJSON, readExportSettings, removeWorksheet, writeDoc, writeWorksheet } from './storage'
import type { ExampleCourse } from '../examples/catalog'
import type { DocModel } from './docScene'
import { docFigure, docModelFromJSON, recordFigure } from './docScene'
import { buildSheet, itemStyle, pageSvg, sheetLatex } from './worksheetExport'
import { toPdfPages } from '../render/vectorPdf'
import { replayList } from '../render/vectorPage'
import { itemLabel } from './worksheetLayout'
import { docListName } from './docName'
import { PX_PER_CM } from './vectorExport'
import { useDialogFocus } from './useDialogFocus'

interface Props {
  docs: DocMeta[]
  /** The live board's size: the screen every document was framed on. */
  screen: { widthPx: number; heightPx: number }
  onClose(): void
  toast(msg: string): void
  /**
   * The teacher's courses (src/ui/courses.ts galleryFilterFor), for "Start
   * from an example worksheet"; null or absent: every course.
   */
  courses?: readonly ExampleCourse[] | null
  /**
   * New documents were written (the sample worksheet's figures): the App
   * re-reads its list, which comes back here as `docs`. Without it the
   * sample worksheet is not offered.
   */
  onDocsChanged?(): void
}

const STYLE_LABELS: Record<FigureStyleId, string> = {
  screen: 'Screen',
  textbook: 'Textbook',
  sat: 'SAT',
  ap: 'AP Calculus',
}
const STYLES: FigureStyleId[] = ['textbook', 'sat', 'ap', 'screen']

const safeName = (s: string): string => s.replace(/[^\w\d\-. ]+/g, '_').trim() || 'worksheet'

function download(data: BlobPart, mime: string, name: string): void {
  const url = URL.createObjectURL(new Blob([data], { type: mime }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** A document's figure, small, drawn by the same recorder the sheet uses. */
function Thumb({ model, style, width = 120 }: { model: DocModel | null; style: FigureStyleId; width?: number }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas || !model) return
    let list
    try {
      list = recordFigure(docFigure(model, { style, answers: false, widthCm: (width * 2) / PX_PER_CM, caption: '' }))
    } catch {
      return
    }
    const dpr = window.devicePixelRatio || 1
    const h = Math.round((width * list.height) / list.width)
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(h * dpr)
    canvas.style.width = `${width}px`
    canvas.style.height = `${h}px`
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    replayList(ctx, list, (width * dpr) / list.width)
  }, [model, style, width])
  if (!model) return <div className="ws-thumb ws-thumb-missing" style={{ width }}>missing</div>
  return <canvas ref={ref} className="ws-thumb" aria-hidden="true" />
}

export function WorksheetEditor({ docs, screen: screenIn, onClose, toast, courses = null, onDocsChanged }: Props) {
  // A new object on every App render; only its two numbers matter.
  const screen = useMemo(() => ({ widthPx: screenIn.widthPx, heightPx: screenIn.heightPx }), [screenIn.widthPx, screenIn.heightPx])
  const [sheets, setSheets] = useState<Worksheet[]>(() => listWorksheets())
  const [sheet, setSheet] = useState<Worksheet>(() => sheets[0] ?? newWorksheet('Worksheet 1'))
  const [picking, setPicking] = useState(sheets.length === 0 || sheets[0].items.length === 0)
  const [pgfplots, setPgfplots] = useState(false)
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  // ---- documents → models, cached per (id, modifiedAt)
  const cacheRef = useRef(new Map<string, { at: number; model: DocModel | null }>())
  const metaById = useMemo(() => new Map(docs.map((d) => [d.id, d])), [docs])
  const lookup = useCallback(
    (docId: string): DocModel | null => {
      const meta = metaById.get(docId)
      if (!meta) return null
      const hit = cacheRef.current.get(docId)
      if (hit && hit.at === meta.modifiedAt) return hit.model
      const json = readDocJSON(docId)
      let model: DocModel | null = null
      if (json !== null) {
        try {
          model = docModelFromJSON(json, { screen, settings: readExportSettings(docId, meta.kind ?? 'cartesian') })
        } catch {
          model = null
        }
      }
      cacheRef.current.set(docId, { at: meta.modifiedAt, model })
      return model
    },
    [metaById, screen],
  )

  // ---- save on every change (one small record; synchronous like documents)
  const sheetRef = useRef(sheet)
  sheetRef.current = sheet
  const update = useCallback(
    (patch: Partial<Worksheet> | ((s: Worksheet) => Partial<Worksheet>)): void => {
      const prev = sheetRef.current
      const p = typeof patch === 'function' ? patch(prev) : patch
      const next = { ...prev, ...p, modifiedAt: Date.now() }
      sheetRef.current = next
      setSheet(next)
      const out = writeWorksheet(next)
      if (!out.ok) toast(out.message)
      setSheets(listWorksheets())
    },
    [toast],
  )
  const setItems = (fn: (items: WorksheetItem[]) => WorksheetItem[]): void => update((s) => ({ items: fn(s.items) }))

  const built = useMemo(() => {
    try {
      return buildSheet(sheet, lookup, sheet.showAnswers === true)
    } catch {
      return null
    }
  }, [sheet, lookup])

  // ---- keys stay inside the sheet: the board's shortcuts (Delete, Z, F …)
  // must not act on the board hidden underneath. A key typed in the sheet is
  // stopped by onKeyDown below; one that arrives with focus outside it (on
  // the body, after a click on the preview) is stopped here, before any of
  // the board's window listeners hear it.
  const rootRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useDialogFocus(rootRef, onClose, { escape: false, autoFocus: false })
  useEffect(() => {
    rootRef.current?.focus()
    const trap = (e: KeyboardEvent): void => {
      if (rootRef.current?.contains(e.target as Node)) return
      e.stopPropagation()
      if (e.key === 'Escape') closeRef.current()
    }
    window.addEventListener('keydown', trap, true)
    return () => window.removeEventListener('keydown', trap, true)
  }, [])
  const onKeyDown = (e: React.KeyboardEvent): void => {
    e.stopPropagation()
    const t = e.target as HTMLElement
    if (e.key === 'Escape' && !(t instanceof HTMLInputElement || t instanceof HTMLSelectElement)) onClose()
  }

  // ---- exports
  const exportPdf = (answers: boolean): void => {
    try {
      const { pages } = buildSheet(sheet, lookup, answers)
      const bytes = toPdfPages(pages, { ptPerPx: 1, title: sheet.title || sheet.name })
      download(bytes as BlobPart, 'application/pdf', `${safeName(sheet.name)}${answers ? ' - Key' : ' - Student'}.pdf`)
    } catch {
      toast('Couldn’t build the PDF.')
    }
  }
  const latex = (): string | null => {
    try {
      const answers = sheet.showAnswers === true
      const { figures } = buildSheet(sheet, lookup, answers)
      return sheetLatex(sheet, figures, answers, { pgfplots })
    } catch {
      return null
    }
  }
  const copyLatex = (): void => {
    const tex = latex()
    if (!tex) return toast('Couldn’t build the LaTeX.')
    if (!navigator.clipboard?.writeText) return toast('This browser can’t copy text — use Download .tex.')
    navigator.clipboard.writeText(tex).then(
      () => toast('Copied the worksheet as LaTeX.'),
      () => toast('The browser refused the copy — use Download .tex.'),
    )
  }
  const downloadLatex = (): void => {
    const tex = latex()
    if (!tex) return toast('Couldn’t build the LaTeX.')
    download(tex, 'application/x-tex', `${safeName(sheet.name)}.tex`)
  }
  const exportPng = (): void => {
    if (!built) return
    // 300 dpi: a page in points × 300/72.
    const scale = 300 / 72
    built.pages.forEach((page, i) => {
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(page.width * scale)
      canvas.height = Math.round(page.height * scale)
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      replayList(ctx, page, scale)
      canvas.toBlob((blob) => {
        if (blob) download(blob, 'image/png', `${safeName(sheet.name)}${built.pages.length > 1 ? ` p${i + 1}` : ''}.png`)
      }, 'image/png')
    })
  }

  // ---- sheets
  const newSheet = (): void => {
    const s = newWorksheet(`Worksheet ${sheets.length + 1}`)
    writeWorksheet(s)
    setSheets(listWorksheets())
    setSheet(s)
    setPicking(true)
  }
  const openSheet = (id: string): void => {
    const s = sheets.find((w) => w.id === id)
    if (s) setSheet(s)
  }
  // ---- "Start from an example worksheet": offered only to a teacher with no
  // worksheet yet, on the blank one this opens with. Figures from the gallery
  // for their courses become new documents; the sheet is theirs.
  const [starting, setStarting] = useState(false)
  const offerSample = onDocsChanged !== undefined && sheets.length === 0 && sheet.items.length === 0
  const startSample = (): void => {
    if (starting || !onDocsChanged) return
    setStarting(true)
    import('../examples/sampleWorksheet')
      .then(({ buildSampleSheet }) => {
        const made = buildSampleSheet({ courses, existingNames: docs.map((d) => d.name), screen })
        for (const doc of made.docs) {
          const out = writeDoc(doc)
          if (!out.ok) {
            onDocsChanged()
            toast(out.message)
            return
          }
        }
        onDocsChanged()
        const out = writeWorksheet(made.sheet)
        if (!out.ok) return toast(out.message)
        sheetRef.current = made.sheet
        setSheet(made.sheet)
        setSheets(listWorksheets())
        setPicking(false)
        toast(`Made “${made.sheet.name}”: its ${made.docs.length} figures are new documents in your list, yours to change.`)
      })
      .catch(() => toast('Couldn’t load the examples — check the connection and try again.'))
      .finally(() => setStarting(false))
  }

  const deleteSheet = (): void => {
    removeWorksheet(sheet.id)
    const rest = listWorksheets()
    setSheets(rest)
    setSheet(rest[0] ?? newWorksheet('Worksheet 1'))
    setConfirmDelete(false)
  }

  const move = (from: number, to: number): void => {
    if (from === to || to < 0 || to >= sheet.items.length) return
    setItems((items) => {
      const next = items.slice()
      const [it] = next.splice(from, 1)
      next.splice(to, 0, it)
      return next
    })
  }
  const patchItem = (i: number, patch: Partial<WorksheetItem>): void =>
    setItems((items) =>
      items.map((it, k) => {
        if (k !== i) return it
        const next: WorksheetItem = { ...it, ...patch }
        if (next.caption === '') delete next.caption
        if (next.label === '') delete next.label
        if (next.style === undefined) delete next.style
        return next
      }),
    )

  const sheetStyle = sheet.style ?? DEFAULT_SHEET_STYLE
  const previewW = 560

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      className="ws-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Worksheet"
      onKeyDown={onKeyDown}
      data-testid="worksheet"
    >
      <header className="ws-head">
        <div className="ws-head-left">
          <select
            className="ws-select"
            aria-label="Worksheet"
            value={sheets.some((w) => w.id === sheet.id) ? sheet.id : ''}
            onChange={(e) => openSheet(e.target.value)}
          >
            {!sheets.some((w) => w.id === sheet.id) && <option value="">{sheet.name} (new)</option>}
            {sheets.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
          <input
            className="ws-name"
            aria-label="Worksheet name"
            value={sheet.name}
            maxLength={80}
            onChange={(e) => update({ name: e.target.value })}
          />
          <button className="ws-btn" onClick={newSheet}>New</button>
          {confirmDelete ? (
            <>
              <button className="ws-btn ws-danger" onClick={deleteSheet}>Delete sheet</button>
              <button className="ws-btn" onClick={() => setConfirmDelete(false)}>Cancel</button>
            </>
          ) : (
            <button className="ws-btn" title="Delete this worksheet (its documents stay)" onClick={() => setConfirmDelete(true)}>
              Delete
            </button>
          )}
        </div>
        <div className="ws-head-right">
          <button className="ws-btn ws-primary" disabled={sheet.items.length === 0} onClick={() => exportPdf(false)} title="Vector PDF without answers">
            Student PDF
          </button>
          <button className="ws-btn ws-primary" disabled={sheet.items.length === 0} onClick={() => exportPdf(true)} title="Vector PDF with the analysis markers and labels">
            Key PDF
          </button>
          <button className="ws-btn" disabled={sheet.items.length === 0} onClick={copyLatex} title="Copy the sheet as a LaTeX snippet">
            Copy LaTeX
          </button>
          <button className="ws-btn" disabled={sheet.items.length === 0} onClick={downloadLatex}>
            .tex
          </button>
          <label className="ws-check" title="pgfplots axes (the equations) instead of TikZ drawings">
            <input type="checkbox" checked={pgfplots} onChange={(e) => setPgfplots(e.target.checked)} /> pgfplots
          </label>
          <button className="ws-btn" disabled={sheet.items.length === 0} onClick={exportPng} title="PNG at 300 dpi">
            PNG
          </button>
          <button className="ws-btn ws-close" onClick={onClose} aria-label="Close worksheet" title="Back to the board (Esc)">
            ×
          </button>
        </div>
      </header>

      <div className="ws-body">
        <aside className="ws-side">
          <section className="ws-section">
            <label className="ws-field">
              <span>Title</span>
              <input
                value={sheet.title ?? ''}
                maxLength={160}
                placeholder="e.g. Unit 2 Quiz — Derivatives"
                onChange={(e) => update({ title: e.target.value === '' ? undefined : e.target.value })}
              />
            </label>
            <label className="ws-check">
              <input type="checkbox" checked={sheet.nameLine !== false} onChange={(e) => update({ nameLine: e.target.checked })} />
              Name / Date line
            </label>
            <div className="ws-row">
              <label className="ws-field ws-field-sm">
                <span>Paper</span>
                <select value={sheet.page} onChange={(e) => update({ page: e.target.value === 'a4' ? 'a4' : 'letter' })}>
                  <option value="letter">Letter</option>
                  <option value="a4">A4</option>
                </select>
              </label>
              <label className="ws-field ws-field-sm">
                <span>Orientation</span>
                <select
                  value={sheet.orientation}
                  onChange={(e) => update({ orientation: e.target.value === 'landscape' ? 'landscape' : 'portrait' })}
                >
                  <option value="portrait">Portrait</option>
                  <option value="landscape">Landscape</option>
                </select>
              </label>
            </div>
            <div className="ws-row">
              <div className="ws-field ws-field-sm">
                <span>Columns</span>
                <div className="ws-seg" role="group" aria-label="Columns">
                  {([1, 2, 3] as const).map((c) => (
                    <button key={c} aria-pressed={sheet.cols === c} className={sheet.cols === c ? 'on' : ''} onClick={() => update({ cols: c })}>
                      {c}
                    </button>
                  ))}
                </div>
              </div>
              <div className="ws-field ws-field-sm">
                <span>Labels</span>
                <div className="ws-seg" role="group" aria-label="Labels">
                  {(['a', '1', 'none'] as const).map((n) => (
                    <button key={n} aria-pressed={sheet.numbering === n} className={sheet.numbering === n ? 'on' : ''} onClick={() => update({ numbering: n })}>
                      {n === 'a' ? '(a)' : n === '1' ? '1.' : 'none'}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="ws-row">
              <label className="ws-field ws-field-sm">
                <span>Figure style</span>
                <select value={sheetStyle} onChange={(e) => update({ style: e.target.value as FigureStyleId })}>
                  {STYLES.map((s) => (
                    <option key={s} value={s}>
                      {STYLE_LABELS[s]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="ws-check ws-key" title="Show the analysis markers, their labels and the intersections on every figure">
                <input
                  type="checkbox"
                  checked={sheet.showAnswers === true}
                  onChange={(e) => update({ showAnswers: e.target.checked })}
                  data-testid="ws-answers"
                />
                Answer key
              </label>
            </div>
          </section>

          <section className="ws-section">
            <div className="ws-section-head">
              <span>Figures ({sheet.items.length})</span>
              <button
                className="ws-btn ws-primary"
                onClick={() => setPicking((p) => !p)}
                disabled={sheet.items.length >= MAX_SHEET_ITEMS}
                aria-expanded={picking}
              >
                {picking ? 'Done adding' : 'Add figure'}
              </button>
            </div>

            {offerSample && (
              <div className="ws-sample" data-testid="ws-sample">
                <button className="ws-btn ws-primary" onClick={startSample} disabled={starting} data-testid="ws-sample-start">
                  {starting ? 'Making it…' : 'Start from an example worksheet'}
                </button>
                <p className="ws-sample-text">
                  Three figures from the examples for your courses, with a title and captions. They are added to your
                  documents as copies you own.
                </p>
              </div>
            )}

            {picking && (
              <div className="ws-picker" role="list" aria-label="Your documents">
                {docs.length === 0 && <div className="ws-empty">No saved documents yet.</div>}
                {docs.map((d) => (
                  <button
                    key={d.id}
                    role="listitem"
                    className="ws-pick"
                    title={`Add “${d.name}”`}
                    onClick={() => setItems((items) => (items.length >= MAX_SHEET_ITEMS ? items : [...items, { docId: d.id }]))}
                  >
                    <Thumb model={lookup(d.id)} style={sheetStyle} width={104} />
                    <span className="ws-pick-name">{docListName(d.name)}</span>
                  </button>
                ))}
              </div>
            )}

            <ol className="ws-items">
              {sheet.items.map((it, i) => {
                const meta = metaById.get(it.docId)
                const model = lookup(it.docId)
                return (
                  <li
                    key={`${it.docId}-${i}`}
                    className={`ws-item${dragFrom === i ? ' ws-dragging' : ''}`}
                    draggable
                    onDragStart={(e) => {
                      setDragFrom(i)
                      e.dataTransfer.effectAllowed = 'move'
                    }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault()
                      if (dragFrom !== null) move(dragFrom, i)
                      setDragFrom(null)
                    }}
                    onDragEnd={() => setDragFrom(null)}
                  >
                    <div className="ws-item-top">
                      <span className="ws-grip" aria-hidden="true">⋮⋮</span>
                      <span className="ws-item-label">{itemLabel(i, sheet.numbering, it.label) || '—'}</span>
                      <span className="ws-item-name">{meta ? docListName(meta.name) : 'Missing document'}</span>
                      <button className="ws-icon" aria-label="Move up" disabled={i === 0} onClick={() => move(i, i - 1)}>↑</button>
                      <button className="ws-icon" aria-label="Move down" disabled={i === sheet.items.length - 1} onClick={() => move(i, i + 1)}>↓</button>
                      <button className="ws-icon" aria-label="Remove" onClick={() => setItems((items) => items.filter((_, k) => k !== i))}>×</button>
                    </div>
                    <div className="ws-item-body">
                      <Thumb model={model} style={itemStyle(sheet, it)} width={96} />
                      <div className="ws-item-fields">
                        <input
                          aria-label="Caption"
                          placeholder="Caption (optional)"
                          maxLength={200}
                          value={it.caption ?? ''}
                          onChange={(e) => patchItem(i, { caption: e.target.value })}
                        />
                        <div className="ws-row">
                          <input
                            className="ws-label-input"
                            aria-label="Label"
                            placeholder={itemLabel(i, sheet.numbering) || 'label'}
                            maxLength={12}
                            value={it.label ?? ''}
                            onChange={(e) => patchItem(i, { label: e.target.value })}
                          />
                          <select
                            aria-label="Figure style"
                            value={it.style ?? ''}
                            onChange={(e) => patchItem(i, { style: e.target.value === '' ? undefined : (e.target.value as FigureStyleId) })}
                          >
                            <option value="">Sheet style ({STYLE_LABELS[sheetStyle]})</option>
                            {STYLES.map((s) => (
                              <option key={s} value={s}>
                                {STYLE_LABELS[s]}
                              </option>
                            ))}
                          </select>
                        </div>
                        {model && model.omitted.length > 0 && (
                          <div className="ws-note">Not included: {model.omitted.join(', ')}.</div>
                        )}
                      </div>
                    </div>
                  </li>
                )
              })}
            </ol>
          </section>
        </aside>

        <main className="ws-preview" aria-label="Page preview">
          {built?.pages.map((p, i) => (
            <figure key={i} className="ws-page" style={{ width: previewW }}>
              <img
                alt={`Page ${i + 1}`}
                width={previewW}
                height={Math.round((previewW * p.height) / p.width)}
                src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(pageSvg(p, previewW))}`}
              />
              <figcaption>
                Page {i + 1} of {built.pages.length}
                {sheet.showAnswers ? ' · answer key' : ' · student version'}
              </figcaption>
            </figure>
          ))}
        </main>
      </div>
    </div>
  )
}
