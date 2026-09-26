import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Latex } from './Latex'
import {
  STEP_KINDS,
  addRow,
  blankPiecewiseDraft,
  cellProblem,
  commitTable,
  constProblem,
  dotGlyph,
  isOpenEnded,
  isOtherwiseRow,
  moveRow,
  nameProblem,
  parkingTable,
  piecewiseResult,
  relText,
  removeRow,
  safeReadPiecewise,
  setCell,
  setOtherwise,
  slidersOf,
  tableFromSpec,
  tableProblems,
  tableToSpec,
  toggleClosed,
  verdictsFor,
} from './piecewiseLinks'
import type {
  BoundSide,
  CellProblem,
  PieceCell,
  PieceTable,
  PiecewiseDraft,
  PiecewiseTab,
  StepDraft,
  StepKind,
  Verdict,
} from './piecewiseLinks'

// ============================================================================
// src/ui/PiecewiseEditor.tsx — a piecewise (or step) function as a TABLE.
//
//     f(x) = { x² + 1   if x < 0
//            { 3        if 0 ≤ x ≤ 2
//            { −x + 5   if x > 2
//
// "Easier than typing it inside a curly bracket." The sibling of
// SinEditor.tsx and TransformEditor.tsx, in the same two places:
//
//   * PiecewiseEditor, "Build ▾ → Piecewise". Two tabs. Pieces: one row per
//     piece — its formula, then `[ −∞ ] < x ≤ [ 0 ]` with each relation a
//     button that toggles < ⇄ ≤ (and the ○/● beside it is the dot the graph
//     draws); "+ piece" tiles the line from where the row above ended; rows
//     reorder by ↑/↓ or by dragging the grip; the last row may be
//     "otherwise". Step: the greatest-integer family a·⌊b(x − h)⌋ + k (and
//     ceiling / round), or a table of constant values (a parking fee). The
//     preview is the cases block, and under it what happens at every
//     breakpoint ("jump of 2 at x = 0", "continuous at x = 2", a gap, an
//     overlap). Nothing reaches the board until "Add to graph".
//   * PiecewiseSection, on the card of any typed line src/core/piecewise.ts
//     reads back as a table. COMMITTED: a field is an edit on Enter or blur,
//     a relation / ↑↓ / × / otherwise is an edit on click, each one undo
//     entry through the App's in-place restate path.
//
// Both only ever produce an ordinary typed line (piecewiseSource writes it).
// The logic is pure and lives in src/ui/piecewiseLinks.ts.
//
// ----------------------------------------------------------------------------
// WIRING (phase 2) — mirrors Sinusoidal / Transformation exactly.
// ----------------------------------------------------------------------------
//
// src/App.tsx
//   1. State, next to `const [transformOpen, setTransformOpen] = useState(false)`:
//        /** "Build ▾ → Piecewise" open at the top of the list (src/ui/PiecewiseEditor.tsx). */
//        const [piecewiseOpen, setPiecewiseOpen] = useState(false)
//   2. Handler, after buildTransformation:
//        /** "Add to graph": the normal typed-equation path, one undo entry. */
//        const buildPiecewise = useCallback(
//          (src: string): string | null => {
//            const err = addExpression(src, 'build piecewise')
//            if (err) return err
//            setPiecewiseOpen(false)
//            return null
//          },
//          [addExpression],
//        )
//   3. <Sidebar …>: add `setPiecewiseOpen(false)` to EVERY other toggle
//      (onExprToggle, onFactorToggle, onExpToggle, onLogToggle, onSinToggle,
//      onTransformToggle, onDataAdd), and pass
//        piecewiseOpen={piecewiseOpen}
//        onPiecewiseToggle={() => {
//          setExprOpen(false); setFactorOpen(false); setExpOpen(false)
//          setLogOpen(false); setSinOpen(false); setTransformOpen(false)
//          setPiecewiseOpen((o) => !o)
//        }}
//        onPiecewiseBuild={buildPiecewise}
//        onPiecewiseRestate={restateFactors}
//      (and `setPiecewiseOpen(false)` into onTransformToggle's list etc.)
//
// src/ui/BuildMenu.tsx
//   4. Props `piecewiseOpen?: boolean` (default false) and
//      `onPiecewiseToggle?(): void`; add `|| piecewiseOpen` to anyOpen; add
//        {item('Piecewise / step', piecewiseOpen, onPiecewiseToggle, 'build-piecewise')}
//      after the Transformation item; extend the button title with
//      "…, or a piecewise / step function piece by piece".
//
// src/ui/Sidebar.tsx
//   5. import { PiecewiseEditor } from './PiecewiseEditor'
//   6. Props (next to the transform ones):
//        /** "Build ▾ → Piecewise" is open at the top of the list. */
//        piecewiseOpen?: boolean
//        onPiecewiseToggle?(): void
//        /** Put a piecewise line on the board. Error, or null. */
//        onPiecewiseBuild?(src: string): string | null
//        /** Rewrite a typed curve's line in place from its Piecewise section. */
//        onPiecewiseRestate?(id: string, src: string, label: string): string | null
//      destructure them (`piecewiseOpen = false`, …); add `|| onPiecewiseToggle`
//      to the BuildMenu guard; pass piecewiseOpen / onPiecewiseToggle to <BuildMenu>.
//   7. In .sidebar-list after the TransformEditor line:
//        {!numberLine && piecewiseOpen && onPiecewiseBuild && onPiecewiseToggle && (
//          <PiecewiseEditor onAdd={onPiecewiseBuild} onClose={onPiecewiseToggle} />
//        )}
//   8. On <CurveCard …> next to onTransformRestate:
//        onPiecewiseRestate={
//          onPiecewiseRestate ? (src, label) => onPiecewiseRestate(curve.id, src, label) : undefined
//        }
//
// src/ui/CurveCard.tsx
//   9. import { PiecewiseSection } from './PiecewiseEditor'
//      import { piecewiseOpenByDefault, piecewiseSectionSpec } from './piecewiseLinks'
//  10. Prop `onPiecewiseRestate?(src: string, label: string): string | null`
//      (destructure it).
//  11. After the `transform` memo:
//        /** The line read back as a table of pieces (src/core/piecewise.ts), or null. */
//        const piecewise = useMemo(
//          () => (isExpression && !broken && curve.kind === 'explicit' ? piecewiseSectionSpec(exprSource) : null),
//          [isExpression, broken, curve.kind, exprSource],
//        )
//  12. In .card-body after the TransformSection block:
//        {piecewise && onPiecewiseRestate && exprSource && (
//          <PiecewiseSection
//            src={exprSource}
//            params={curve.params}
//            defaultOpen={piecewiseOpenByDefault(exprSource)}
//            onRestate={onPiecewiseRestate}
//          />
//        )}
//      (`params` = the curve's slider values in parseExpression(src).plot.paramNames
//      order — what a typed curve's params are; omit it to judge at the defaults.)
//
// src/ui/styles.css — new rules (phase 1 reuses fe-/xe-/calc- classes; these
// only refine the layout; every length on the 4/8/12/16/24 scale, font sizes
// from the --fs-* tokens):
//   .pw-table   { display: flex; flex-direction: column; gap: var(--sp-2); }
//   .pw-row     { display: flex; flex-direction: column; gap: var(--sp-1);
//                 padding: var(--sp-1); border-radius: 4px;
//                 border: 1px solid var(--border-soft); }
//   .pw-row-drop { border-color: var(--accent); }        /* a drag hovering */
//   .pw-grip    { cursor: grab; color: var(--faint); user-select: none;
//                 touch-action: none; }
//   .pw-expr    { flex: 1 1 auto; min-width: 0; width: auto; }
//   .pw-rel     { min-width: 44px; font-family: var(--font-mono); }  /* ≤● */
//   .pw-rel:disabled { opacity: 0.45; cursor: default; }
//   .pw-dot     { font-size: var(--fs-xs); color: var(--curve, var(--accent)); }
//   .pw-moves   { margin-left: auto; display: inline-flex; gap: var(--sp-1); }
//   .pw-otherwise { color: var(--muted); font-size: var(--fs-xs); }
//   .pw-verdicts li[data-kind='overlap'] { color: var(--danger); }
//   .pw-verdicts li[data-kind='gap'],
//   .pw-verdicts li[data-kind='end'] { color: var(--muted); }
//   @media (pointer: coarse) { .pw-rel, .pw-grip { min-height: 44px; } }
//   (if tests/styles.test.ts's 44×44 control list is meant to cover every
//   touch control, add .pw-rel and .pw-grip to it)
// ============================================================================

type Mode = 'draft' | 'commit'

/**
 * One text cell. Unlike ExpEditor's XField it takes any expression (x^2 + 1,
 * sqrt(x)) — the table validates it — and shows the problem it is handed.
 * A draft's value is the state; a card's commits on Enter or blur.
 */
function PwField({
  value,
  mode,
  label,
  problem,
  className,
  placeholder,
  inputRef,
  testId,
  onCommit,
}: {
  value: string
  mode: Mode
  label: string
  problem?: string | null
  className?: string
  placeholder?: string
  inputRef?: (el: HTMLInputElement | null) => void
  testId?: string
  onCommit(text: string): void
}) {
  const [text, setText] = useState(value)
  useEffect(() => setText(value), [value])
  const draft = mode === 'draft'
  const commit = (): void => {
    if (text !== value) onCommit(text.trim())
  }
  const bad = !!problem
  return (
    <input
      ref={inputRef}
      className={`calc-input fe-input xe-input${className ? ` ${className}` : ''}${bad ? ' fe-input-bad' : ''}`}
      type="text"
      spellCheck={false}
      autoComplete="off"
      autoCorrect="off"
      autoCapitalize="off"
      aria-label={label}
      title={problem ? `${label} — ${problem}` : label}
      aria-invalid={bad ? true : undefined}
      placeholder={placeholder}
      data-testid={testId}
      value={draft ? value : text}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => {
        if (draft) onCommit(e.target.value)
        else setText(e.target.value)
      }}
      onKeyDown={(e) => {
        // A draft lets Enter and Esc reach the card (add / close); a card's
        // field keeps its keys to itself.
        if (draft) return
        e.stopPropagation()
        if (e.key === 'Enter') {
          e.preventDefault()
          commit()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          setText(value)
        }
      }}
      onBlur={() => {
        if (!draft) commit()
      }}
    />
  )
}

/** `<` / `≤` between a bound and x, with the dot it draws. */
function RelButton({
  side,
  closed,
  open,
  bound,
  onToggle,
  testId,
}: {
  side: BoundSide
  closed: boolean
  /** The bound is empty (±∞): nothing to include, nothing to toggle. */
  open: boolean
  bound: string
  onToggle(): void
  testId: string
}) {
  const c = !open && closed
  const title = open
    ? `${side === 'lo' ? 'No lower' : 'No upper'} bound — type one to choose < or ≤`
    : `${c ? 'Includes' : 'Excludes'} x = ${bound.trim()} (${c ? 'closed ●' : 'open ○'}) — click for ${c ? '<' : '≤'}`
  const dot = open ? null : <span className="pw-dot" aria-hidden="true">{dotGlyph(c)}</span>
  return (
    <button
      type="button"
      className="calc-chip pw-rel"
      data-testid={testId}
      aria-pressed={c}
      aria-label={title}
      title={title}
      disabled={open}
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}
    >
      {side === 'lo' && dot}
      {relText(c)}
      {side === 'hi' && dot}
    </button>
  )
}

/** The table of pieces — the Build card's, the Step table's and the card section's. */
function PieceTableView({
  table,
  mode,
  problems,
  valueWord = 'formula',
  firstRef,
  testPrefix,
  onChange,
}: {
  table: PieceTable
  mode: Mode
  problems: readonly CellProblem[]
  /** What the first cell holds: a piece's "formula" or a step's "value". */
  valueWord?: string
  firstRef?: (el: HTMLInputElement | null) => void
  testPrefix: string
  onChange(next: PieceTable, label: string): void
}) {
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [dragOver, setDragOver] = useState<number | null>(null)
  const n = table.rows.length
  const last = n - 1
  const cell = (i: number, c: PieceCell) => (text: string): void =>
    onChange(setCell(table, i, c, text), c === 'expr' ? `edit piece ${i + 1}` : `edit bound of piece ${i + 1}`)

  return (
    <div className="fe-list pw-table" data-testid={`${testPrefix}-table`}>
      {table.rows.map((r, i) => {
        const other = isOtherwiseRow(table, i)
        // A blank formula disables "Add"; it is not worth a red line of its own.
        const shown = (c: PieceCell): string | null => {
          const p = cellProblem(problems, i, c)
          return c === 'expr' && r.expr.trim() === '' ? null : p
        }
        const rowError = shown('expr') ?? shown('lo') ?? shown('hi')
        return (
          <div
            key={i}
            className={`pw-row${dragOver === i && dragFrom !== null && dragFrom !== i ? ' pw-row-drop' : ''}`}
            data-testid={`${testPrefix}-row-${i}`}
            onDragOver={(e) => {
              if (dragFrom === null) return
              e.preventDefault()
              if (dragOver !== i) setDragOver(i)
            }}
            onDrop={(e) => {
              e.preventDefault()
              if (dragFrom !== null && dragFrom !== i) onChange(moveRow(table, dragFrom, i), 'reorder pieces')
              setDragFrom(null)
              setDragOver(null)
            }}
          >
            <div className="fe-a-row pw-line">
              {n > 1 && (
                <span
                  className="pw-grip"
                  draggable
                  title="Drag to reorder"
                  aria-hidden="true"
                  onDragStart={(e) => {
                    setDragFrom(i)
                    e.dataTransfer.effectAllowed = 'move'
                    e.dataTransfer.setData('text/plain', String(i))
                  }}
                  onDragEnd={() => {
                    setDragFrom(null)
                    setDragOver(null)
                  }}
                >
                  ⋮⋮
                </span>
              )}
              <PwField
                value={r.expr}
                mode={mode}
                label={`Piece ${i + 1} ${valueWord}`}
                placeholder={valueWord === 'value' ? 'value' : 'formula in x'}
                problem={shown('expr')}
                className="pw-expr"
                inputRef={i === 0 ? firstRef : undefined}
                testId={`${testPrefix}-expr-${i}`}
                onCommit={cell(i, 'expr')}
              />
              <span className="pw-moves">
                <button
                  type="button"
                  className="fe-step"
                  aria-label={`Move piece ${i + 1} up`}
                  title="Move up"
                  disabled={i === 0}
                  onClick={(e) => {
                    e.stopPropagation()
                    onChange(moveRow(table, i, i - 1), 'reorder pieces')
                  }}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="fe-step"
                  aria-label={`Move piece ${i + 1} down`}
                  title="Move down"
                  disabled={i === last}
                  onClick={(e) => {
                    e.stopPropagation()
                    onChange(moveRow(table, i, i + 1), 'reorder pieces')
                  }}
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="calc-drop fe-drop"
                  aria-label={`Remove piece ${i + 1}`}
                  title="Remove this piece"
                  data-testid={`${testPrefix}-remove-${i}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    onChange(removeRow(table, i), 'remove piece')
                  }}
                >
                  ×
                </button>
              </span>
            </div>
            <div className="fe-a-row pw-line pw-cond">
              {other ? (
                <span className="calc-tag pw-otherwise">otherwise — every x no piece above covers</span>
              ) : (
                <>
                  <span className="calc-tag">if</span>
                  <PwField
                    value={r.lo}
                    mode={mode}
                    label={`Piece ${i + 1} lower bound (empty: −∞)`}
                    placeholder="−∞"
                    problem={shown('lo')}
                    className="fe-input-part"
                    testId={`${testPrefix}-lo-${i}`}
                    onCommit={cell(i, 'lo')}
                  />
                  <RelButton
                    side="lo"
                    closed={r.loClosed}
                    open={isOpenEnded(r.lo)}
                    bound={r.lo}
                    testId={`${testPrefix}-lorel-${i}`}
                    onToggle={() => onChange(toggleClosed(table, i, 'lo'), 'toggle endpoint')}
                  />
                  <span className="calc-tag">x</span>
                  <RelButton
                    side="hi"
                    closed={r.hiClosed}
                    open={isOpenEnded(r.hi)}
                    bound={r.hi}
                    testId={`${testPrefix}-hirel-${i}`}
                    onToggle={() => onChange(toggleClosed(table, i, 'hi'), 'toggle endpoint')}
                  />
                  <PwField
                    value={r.hi}
                    mode={mode}
                    label={`Piece ${i + 1} upper bound (empty: ∞)`}
                    placeholder="∞"
                    problem={shown('hi')}
                    className="fe-input-part"
                    testId={`${testPrefix}-hi-${i}`}
                    onCommit={cell(i, 'hi')}
                  />
                </>
              )}
              {i === last && n > 1 && (
                <label className="te-check" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={table.otherwise}
                    data-testid={`${testPrefix}-otherwise`}
                    onChange={(e) => onChange(setOtherwise(table, e.target.checked), 'otherwise')}
                  />
                  otherwise
                </label>
              )}
            </div>
            {rowError && <div className="expr-error">{rowError}</div>}
          </div>
        )
      })}
      <div className="fe-adds">
        <button
          type="button"
          className="calc-chip fe-add"
          data-testid={`${testPrefix}-add`}
          title="A new piece starting where the one above ends"
          onClick={(e) => {
            e.stopPropagation()
            onChange(addRow(table), 'add piece')
          }}
        >
          + piece
        </button>
      </div>
    </div>
  )
}

/** What happens at each breakpoint, left to right. */
export function VerdictList({ verdicts, testId = 'pw-verdicts' }: { verdicts: readonly Verdict[]; testId?: string }) {
  if (verdicts.length === 0) return null
  return (
    <div className="xe-facts">
      <ul className="xe-sentences pw-verdicts" data-testid={testId}>
        {verdicts.map((v, i) => (
          <li key={i} data-kind={v.kind}>
            {v.text}
          </li>
        ))}
      </ul>
    </div>
  )
}

function Preview({ src, latex }: { src: string | null; latex: string | null }) {
  return (
    <div
      className="fe-preview"
      data-src={src ?? undefined}
      data-tex={latex ?? undefined}
      aria-label={src ?? 'No equation yet'}
    >
      {latex ? <Latex tex={latex} className="card-latex" /> : <span className="fe-preview-none">—</span>}
    </div>
  )
}

// ============================================================================
// the "Build ▾ → Piecewise" card
// ============================================================================

const TABS: { tab: PiecewiseTab; label: string }[] = [
  { tab: 'pieces', label: 'Pieces' },
  { tab: 'step', label: 'Step' },
]

interface EditorProps {
  /** Put the line on the board. Error to show, or null (the editor then closes). */
  onAdd(src: string): string | null
  onClose(): void
  /** Start from this draft (tests). */
  initial?: PiecewiseDraft
}

export function PiecewiseEditor({ onAdd, onClose, initial }: EditorProps) {
  const [draft, setDraft] = useState<PiecewiseDraft>(() => initial ?? blankPiecewiseDraft())
  const [buildError, setBuildError] = useState<string | null>(null)
  const firstRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    firstRef.current?.focus()
    firstRef.current?.select()
  }, [])

  const result = useMemo(() => piecewiseResult(draft), [draft])
  const canBuild = result.src !== null
  const blankFormula = result.problems.some((p) => p.cell === 'expr' && /^Type /.test(p.message))

  const update = (next: (d: PiecewiseDraft) => PiecewiseDraft): void => {
    setBuildError(null)
    setDraft(next)
  }
  const setStep = (patch: Partial<StepDraft>): void => update((d) => ({ ...d, step: { ...d.step, ...patch } }))
  const build = (): void => {
    if (!result.src) return
    const err = onAdd(result.src)
    if (err) setBuildError(err)
  }
  const focusFirst = (el: HTMLInputElement | null): void => {
    firstRef.current = el
  }
  const st = draft.step

  return (
    <div
      className="expr-card fe-card xe-card pw-card"
      data-testid="piecewise-editor"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          onClose()
        } else if (
          e.key === 'Enter' &&
          (e.target as HTMLElement).tagName === 'INPUT' &&
          (e.target as HTMLInputElement).type === 'text'
        ) {
          e.preventDefault()
          build()
        }
      }}
    >
      <div className="fe-head">
        <span className="fe-title">Piecewise</span>
        <button type="button" className="calc-drop fe-close" title="Close (Esc)" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </div>

      <div className="seg xe-tabs" role="tablist" aria-label="Build it from">
        {TABS.map((t) => (
          <button
            key={t.tab}
            type="button"
            role="tab"
            aria-selected={draft.tab === t.tab}
            data-tab={t.tab}
            className={`seg-btn xe-tab${draft.tab === t.tab ? ' seg-on' : ''}`}
            onClick={() => update((d) => ({ ...d, tab: t.tab }))}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="fe-a-row">
        <span className="calc-tag">name</span>
        <PwField
          value={draft.name}
          mode="draft"
          label="Function name (empty: y = …)"
          placeholder="y"
          problem={nameProblem(draft.name)}
          className="fe-input-part pw-name"
          testId="pw-name"
          onCommit={(name) => update((d) => ({ ...d, name }))}
        />
        <span className="calc-tag">{draft.name.trim() ? '(x) =' : '= (no name)'}</span>
      </div>

      {draft.tab === 'pieces' && (
        <div className="xe-body" data-testid="pw-tab-pieces">
          <PieceTableView
            table={draft.pieces}
            mode="draft"
            problems={result.problems}
            firstRef={focusFirst}
            testPrefix="pw"
            onChange={(pieces) => update((d) => ({ ...d, pieces }))}
          />
        </div>
      )}

      {draft.tab === 'step' && (
        <div className="xe-body" data-testid="pw-tab-step">
          <div className="seg xe-tabs" role="radiogroup" aria-label="Step function">
            {(
              [
                ['family', 'Greatest integer'],
                ['table', 'Table of values'],
              ] as const
            ).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={st.mode === mode}
                data-testid={`pw-step-${mode}`}
                className={`seg-btn xe-tab${st.mode === mode ? ' seg-on' : ''}`}
                onClick={() => setStep({ mode })}
              >
                {label}
              </button>
            ))}
          </div>
          {st.mode === 'family' ? (
            <>
              <div className="fe-a-row">
                <select
                  className="xe-select"
                  aria-label="Step function"
                  data-testid="pw-step-kind"
                  value={st.kind}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setStep({ kind: e.target.value as StepKind })}
                >
                  {STEP_KINDS.map((k) => (
                    <option key={k.kind} value={k.kind}>
                      {k.label}
                    </option>
                  ))}
                </select>
                <span className="xe-formula">{STEP_KINDS.find((k) => k.kind === st.kind)?.formula}</span>
              </div>
              {(
                [
                  ['a', 'a (step height; negative steps down)', 'h', 'h (shift right)'],
                  ['b', 'b (steps 1/|b| wide)', 'k', 'k (shift up)'],
                ] as const
              ).map(([f1, l1, f2, l2]) => (
                <div className="fe-a-row" key={f1}>
                  {(
                    [
                      [f1, l1],
                      [f2, l2],
                    ] as const
                  ).map(([f, l]) => (
                    <Labelled key={f} tag={`${f} =`}>
                      <PwField
                        value={st[f]}
                        mode="draft"
                        label={l}
                        problem={constProblem(st[f], f)}
                        className="fe-input-part"
                        inputRef={f === 'a' ? focusFirst : undefined}
                        testId={`pw-step-${f}`}
                        onCommit={(text) => setStep({ [f]: text } as Partial<StepDraft>)}
                      />
                    </Labelled>
                  ))}
                </div>
              ))}
              {result.sentence && (
                <div className="field-hint" data-testid="pw-step-sentence">
                  {result.sentence}
                </div>
              )}
            </>
          ) : (
            <>
              <PieceTableView
                table={st.table}
                mode="draft"
                problems={result.problems}
                valueWord="value"
                testPrefix="pw-step"
                onChange={(table) => setStep({ table })}
              />
              <button
                type="button"
                className="fe-link"
                data-testid="pw-step-example"
                onClick={(e) => {
                  e.stopPropagation()
                  setStep({ table: parkingTable() })
                }}
              >
                Start from a parking-fee table ($5 the first hour, $3 each hour after)
              </button>
            </>
          )}
        </div>
      )}

      <Preview src={result.previewSrc} latex={result.latex} />
      <VerdictList verdicts={result.verdicts} />
      {blankFormula && <div className="field-hint">Fill in every piece’s {draft.tab === 'step' ? 'value' : 'formula'}.</div>}
      {(result.error || buildError) && <div className="expr-error">{buildError ?? result.error}</div>}

      <div className="fe-actions">
        <span className="expr-hint">Enter adds · Esc closes</span>
        <button type="button" className="fe-build" disabled={!canBuild} onClick={build}>
          Add to graph
        </button>
      </div>
    </div>
  )
}

function Labelled({ tag, children }: { tag: string; children: ReactNode }) {
  return (
    <>
      <span className="calc-tag">{tag}</span>
      {children}
    </>
  )
}

// ============================================================================
// the Piecewise section on a typed curve's card
// ============================================================================

interface SectionProps {
  /** The curve's typed line (one readPiecewise reads). */
  src: string
  /** Rewrite the curve's line in place. Error message, or null. */
  onRestate(src: string, label: string): string | null
  /**
   * The curve's slider values, in parseExpression(src).plot.paramNames order,
   * for the breakpoint verdicts; the parser's defaults when absent.
   */
  params?: readonly number[]
  /** Open at first (default: open). */
  defaultOpen?: boolean
}

export function PiecewiseSection({ src, onRestate, params, defaultOpen = true }: SectionProps) {
  const spec = useMemo(() => safeReadPiecewise(src), [src])
  const [open, setOpen] = useState(defaultOpen)
  const [table, setTable] = useState<PieceTable | null>(() => (spec ? tableFromSpec(spec) : null))
  const [error, setError] = useState<string | null>(null)
  /** The line this section last wrote: reading it back must not reorder the rows under the teacher. */
  const wroteRef = useRef<string | null>(null)

  useEffect(() => {
    if (src === wroteRef.current) return
    wroteRef.current = null
    setTable(spec ? tableFromSpec(spec) : null)
    setError(null)
  }, [src, spec])

  const name = spec?.name
  const problems = useMemo(() => (table ? tableProblems(table) : []), [table])
  const sliders = useMemo(() => slidersOf(src, params), [src, params])
  const verdicts = useMemo(() => {
    if (!spec) return []
    const judged = table && problems.length === 0 ? tableToSpec(table, name) : spec
    return verdictsFor(judged, sliders)
  }, [spec, table, problems, name, sliders])

  if (!spec || !table) return null

  const change = (next: PieceTable, label: string): void => {
    setTable(next)
    const c = commitTable(next, name)
    if (c.error !== null) {
      // The row shows its own problem; anything else is said below the table.
      setError(tableProblems(next).length > 0 ? null : c.error)
      return
    }
    if (c.src === src) {
      setError(null)
      return
    }
    wroteRef.current = c.src
    const err = onRestate(c.src, label)
    if (err) wroteRef.current = null
    setError(err)
  }

  return (
    <div className="field-section fe-section xe-section pw-section" data-testid="piecewise-section">
      <button
        type="button"
        className="an-title fe-toggle"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation()
          setOpen((o) => !o)
        }}
      >
        Piecewise <span className="fe-caret">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <>
          <PieceTableView table={table} mode="commit" problems={problems} testPrefix="pws" onChange={change} />
          <VerdictList verdicts={verdicts} testId="pws-verdicts" />
          {error && <div className="expr-error">{error}</div>}
          <div className="field-hint">
            Click &lt; / ≤ to open or close an end (○ / ●). An empty bound runs to ±∞.
          </div>
        </>
      )}
    </div>
  )
}
