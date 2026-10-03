// ============================================================================
// src/ui/ItemBankDialogs.tsx — the two AP item-bank dialogs.
//
//   CopyForBankDialog    Download ▾ → Copy for item bank…: the open graph as a
//                        block to paste into a record (TikZ or pgfplots,
//                        student or key, width, house style), or just its
//                        description (`%%% figure=described`).
//   GraphFromItemDialog  Document menu → Graph from item…: paste a stem or a
//                        whole %%% ITEM record; preview what it defines and
//                        what the stem says about its figure; Graph it opens a
//                        new document.
//
// Both are views over src/ui/itemBank.ts; the App's hook (src/app/
// useItemBank.ts) does the clipboard and opens documents.
// ============================================================================

import { useEffect, useMemo, useRef, useState } from 'react'
import type { BankFigure, BankOptions, ItemPlan } from './itemBank'
import { DEFAULT_BANK_OPTIONS, bankFileName, planItem } from './itemBank'
import { clampLatexWidth } from './vectorExport'
import { Latex } from './Latex'
import { useDialogFocus } from './useDialogFocus'

type CopyStatus = 'idle' | 'copied' | 'downloaded'

/**
 * Keys stay inside the dialog: the board's single-key shortcuts (Delete, Z,
 * F …) must not act on the board underneath. A key typed in the dialog is
 * stopped by the returned onKeyDown (after React has run the field's own
 * handlers); one that arrives with focus outside it is stopped at the window,
 * before any of the board's listeners hear it. Esc closes.
 */
function useDialogKeys(onClose: () => void, ref: React.RefObject<HTMLElement>): (e: React.KeyboardEvent) => void {
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useDialogFocus(ref, onClose, { escape: false, autoFocus: false })
  useEffect(() => {
    ref.current?.focus()
    const trap = (e: KeyboardEvent): void => {
      if (ref.current?.contains(e.target as Node)) return
      e.stopPropagation()
      if (e.key === 'Escape') closeRef.current()
    }
    window.addEventListener('keydown', trap, true)
    return () => window.removeEventListener('keydown', trap, true)
  }, [ref])
  return (e: React.KeyboardEvent): void => {
    e.stopPropagation()
    if (e.key === 'Escape') closeRef.current()
  }
}

// ---------------------------------------------------------------------------
// Copy for item bank
// ---------------------------------------------------------------------------

interface CopyProps {
  docName: string
  /** False on a number line: pgfplots has nothing to say there. */
  graph: boolean
  build(opts: BankOptions): BankFigure | null
  copy(text: string, fileName: string, what: string): Promise<{ ok: boolean }>
  download(text: string, fileName: string): void
  onClose(): void
}

export function CopyForBankDialog({ docName, graph, build, copy, download, onClose }: CopyProps) {
  const [opts, setOpts] = useState<BankOptions>(DEFAULT_BANK_OPTIONS)
  const [cmDraft, setCmDraft] = useState(String(DEFAULT_BANK_OPTIONS.widthCm))
  const [status, setStatus] = useState<{ which: 'block' | 'desc'; s: CopyStatus } | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const onKeyDown = useDialogKeys(onClose, dialogRef)

  const result = useMemo(() => build(opts), [build, opts])
  useEffect(() => setStatus(null), [opts])

  const set = <K extends keyof BankOptions>(k: K, v: BankOptions[K]): void => setOpts((o) => ({ ...o, [k]: v }))
  const commitCm = (raw: string): void => {
    const n = Number(raw.trim())
    if (raw.trim() === '' || !Number.isFinite(n)) {
      setCmDraft(String(opts.widthCm))
      return
    }
    const v = clampLatexWidth(n)
    setCmDraft(String(v))
    set('widthCm', v)
  }
  const file = bankFileName(docName)
  const doCopy = (which: 'block' | 'desc'): void => {
    if (!result) return
    const text = which === 'block' ? result.block : result.descriptionBlock
    void copy(text, file, which === 'block' ? 'the figure block' : 'the description').then((r) =>
      setStatus({ which, s: r.ok ? 'copied' : 'downloaded' }),
    )
  }
  const label = (which: 'block' | 'desc', idle: string): string =>
    status?.which === which ? (status.s === 'copied' ? 'Copied' : 'Downloaded instead') : idle

  return (
    <div className="share-scrim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="share-dialog ib-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ib-copy-title"
        tabIndex={-1}
        ref={dialogRef}
        onKeyDown={onKeyDown}
        data-testid="bank-copy-dialog"
      >
        <div className="share-head">
          <h2 id="ib-copy-title" className="share-title">
            Copy for item bank — “{docName}”
          </h2>
          <button className="share-x" onClick={onClose} aria-label="Close" title="Close (Esc)">
            ×
          </button>
        </div>
        <p className="share-lede">
          A block for a record in bank.tex: the two <code>%%%</code> lines replace the record’s{' '}
          <code>figure=</code> line, and the picture goes inside the stem.
        </p>

        <div className="ib-grid">
          <span className="ib-label">Format</span>
          <div className="seg exp-seg" role="group" aria-label="Format">
            {(['tikz', 'pgfplots'] as const).map((f) => (
              <button
                key={f}
                className={`seg-btn${opts.format === f ? ' seg-on' : ''}`}
                aria-pressed={opts.format === f}
                disabled={f === 'pgfplots' && !graph}
                data-testid={`bank-format-${f}`}
                onClick={() => set('format', f)}
                title={f === 'tikz' ? 'The picture as TikZ commands (\\usepackage{tikz})' : 'A pgfplots axis with the equations themselves'}
              >
                {f === 'tikz' ? 'TikZ' : 'pgfplots'}
              </button>
            ))}
          </div>
          <span className="ib-label">Version</span>
          <div className="seg exp-seg" role="group" aria-label="Version">
            {([false, true] as const).map((a) => (
              <button
                key={String(a)}
                className={`seg-btn${opts.answers === a ? ' seg-on' : ''}`}
                aria-pressed={opts.answers === a}
                data-testid={`bank-version-${a ? 'key' : 'student'}`}
                onClick={() => set('answers', a)}
                title={a ? 'With the answers: markers, labels, crossings' : 'As the stem shows it: no answers'}
              >
                {a ? 'Key figure' : 'Student figure'}
              </button>
            ))}
          </div>
          <label className="ib-label" htmlFor="ib-width">
            Width
          </label>
          <span className="ib-width">
            <input
              id="ib-width"
              className="ib-num"
              inputMode="decimal"
              value={cmDraft}
              data-testid="bank-width"
              onChange={(e) => setCmDraft(e.target.value)}
              onBlur={(e) => commitCm(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitCm((e.target as HTMLInputElement).value)
              }}
            />
            cm
          </span>
        </div>
        <label className="share-check">
          <input
            type="checkbox"
            checked={opts.house}
            data-testid="bank-house"
            onChange={(e) => set('house', e.target.checked)}
          />
          <span>
            <strong>Use house style</strong>
            <span className="share-sub">
              Grayscale ink, curves told apart by dashes rather than colour, labelled axes with a scale, and at
              least one labelled point.
            </span>
          </span>
        </label>

        {!result ? (
          <p className="share-warn" role="alert">
            Couldn’t draw this board for the bank.
          </p>
        ) : (
          <>
            {result.notes.length > 0 && (
              <ul className="ib-notes" data-testid="bank-notes">
                {result.notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            )}
            <div className="ib-desc" data-testid="bank-figuredesc">
              <span className="ib-label">figuredesc</span> {result.figuredesc}
            </div>
            <pre className="ib-pre" data-testid="bank-block" aria-label="The block to paste">
              {result.block}
            </pre>
            <div className="share-actions">
              <button className="share-btn share-primary" onClick={() => doCopy('block')} data-testid="bank-copy">
                {label('block', 'Copy block')}
              </button>
              <button
                className="share-btn"
                onClick={() => doCopy('desc')}
                data-testid="bank-copy-desc"
                title="Just %%% figure=described and %%% figuredesc=…, for the text form"
              >
                {label('desc', 'Copy description only')}
              </button>
              <span className="share-spacer" />
              <button className="share-btn" onClick={() => download(result.block, file)} title={`Save the block as ${file}`}>
                Download .tex
              </button>
            </div>
            <p className="share-fine ib-fine">
              Preamble: {result.preamble.join(' ')}. The figuredesc is always the student description.
            </p>
          </>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Graph from item
// ---------------------------------------------------------------------------

interface ItemProps {
  graph(plan: ItemPlan): boolean
  onClose(): void
}

const KIND_WORDS: Record<string, string> = {
  function: 'function',
  derivative: 'derivative, given',
  polar: 'polar curve',
  parametric: 'parametric curve',
  'slope-field': 'slope field',
  relation: 'relation',
}

export function GraphFromItemDialog({ graph, onClose }: ItemProps) {
  const [src, setSrc] = useState('')
  const [follow, setFollow] = useState(true)
  const dialogRef = useRef<HTMLDivElement>(null)
  const onKeyDown = useDialogKeys(onClose, dialogRef)
  const plan = useMemo(() => (src.trim() === '' ? null : planItem(src, { followGraphOf: follow })), [src, follow])
  const derivedLine = plan?.derive ? plan.derive.line : -1

  return (
    <div className="share-scrim" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="share-dialog ib-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ib-item-title"
        tabIndex={-1}
        ref={dialogRef}
        onKeyDown={onKeyDown}
        data-testid="graph-item-dialog"
      >
        <div className="share-head">
          <h2 id="ib-item-title" className="share-title">
            Graph from item
          </h2>
          <button className="share-x" onClick={onClose} aria-label="Close" title="Close (Esc)">
            ×
          </button>
        </div>
        <p className="share-lede">
          Paste a stem, or a whole <code>%%% ITEM</code> record from bank.tex (Mathpix LaTeX is fine). Its
          definitions open as a new document in the AP figure style.
        </p>
        <textarea
          className="ib-src"
          value={src}
          spellCheck={false}
          placeholder={'%%% ITEM AB-0044\n%%% figure=needed\n\\begin{stem} The graph of $f\'$ is shown … $f(x) = x^3 - 3x$ … \\end{stem}\n%%% END'}
          aria-label="Item LaTeX"
          data-testid="graph-item-src"
          onChange={(e) => setSrc(e.target.value)}
        />

        {plan && (
          <div className="ib-preview" data-testid="graph-item-preview">
            {plan.record.id && (
              <div className="ib-item-id">
                Item <strong>{plan.record.id}</strong>
                {plan.record.figure && <span className="ib-tag">figure={plan.record.figure}</span>}
              </div>
            )}
            {plan.needsFigure && (
              <p className="ib-needs" role="status" data-testid="graph-item-needs">
                This item needs a figure — build it, then use Copy for item bank.
              </p>
            )}
            {plan.lines.length === 0 ? (
              <p className="share-note">No definitions found yet — a definition looks like f(x) = …, y = …, r = …, or dy/dx = ….</p>
            ) : (
              <ul className="ib-defs" data-testid="graph-item-defs">
                {plan.lines.map((l, i) => (
                  <li key={i} className="ib-def">
                    <span className="ib-def-tex">
                      <Latex tex={l.def.latex} />
                    </span>
                    <code className="ib-def-line">{l.def.typed}</code>
                    <span className="ib-def-kind">
                      {KIND_WORDS[l.def.kind] ?? l.def.kind}
                      {l.role === 'hidden' ? ' · hidden' : ''}
                      {i === derivedLine ? ` · graphing its derivative` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {plan.imported.hints.graphOf !== 'f' && (
              <label className="share-check ib-follow">
                <input
                  type="checkbox"
                  checked={follow}
                  data-testid="graph-item-follow"
                  onChange={(e) => setFollow(e.target.checked)}
                />
                <span>
                  <strong>
                    The stem says the graph of {(plan.imported.hints.name ?? 'f') + (plan.imported.hints.graphOf === "f''" ? '″' : '′')} is
                    shown; graph {(plan.imported.hints.name ?? 'f') + (plan.imported.hints.graphOf === "f''" ? '″' : '′')}?
                  </strong>
                </span>
              </label>
            )}
            {plan.notes.length > 0 && (
              <ul className="ib-notes" data-testid="graph-item-notes">
                {plan.notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            )}
            {plan.imported.warnings.length > 0 && (
              <ul className="ib-warnings" role="alert" data-testid="graph-item-warnings">
                {plan.imported.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="share-actions">
          <span className="share-fine ib-fine-left">
            {plan && !plan.empty ? `Opens as “${plan.baseName}”, a new document; this one is saved first.` : ''}
          </span>
          <span className="share-spacer" />
          <button className="share-btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="share-btn share-primary"
            disabled={!plan || plan.empty}
            data-testid="graph-item-go"
            onClick={() => plan && graph(plan)}
          >
            Graph it
          </button>
        </div>
      </div>
    </div>
  )
}
