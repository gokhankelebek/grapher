// ============================================================================
// src/app/useTypedLines.ts — typed lines: sequences and equations.
//
// reparseLines (a rename's rewritten lines), the sequence CRUD, addExpression
// (which sends a sequence to its own branch), and restating a typed curve.
//
// Called once per render by App (src/App.tsx), in sequence with the other
// src/app hooks. The order of those calls is the order of every useState, ref,
// memo and effect on the board, so a new hook goes where its inputs exist.
// ============================================================================

import { useCallback } from 'react'
import { parseExpression } from '../core/parse'
import { CURVE_COLORS, nextId } from '../core/types'
import type { FittedCurve, ModelSpec, ParsedPlot } from '../core/types'
import { typedName } from '../render/curveNames'
import { readCurveEquation } from '../ui/equationText'
import { looksLikeField, readField } from '../ui/fieldLinks'
import { isParametricPair } from '../ui/motionLinks'
import {
  boardLetters,
  boundCalls,
  nameOwners,
  notCallable,
  planClaim,
  sliderLetters,
} from '../ui/nameLinks'
import type { NameState } from '../ui/nameLinks'
import {
  carryParams as carrySeqParams,
  clampSeqCount,
  clampSeqN0,
  curveNameClash,
  defaultSeriesView,
  defaultWindow,
  isListLine,
  looksLikeSequence,
  nextSequenceLetter,
  readSequence,
  reconcileParams,
  renameSequenceSrc,
  seqName,
  sequenceError,
  sequenceLetters,
  sequenceNameClash,
} from '../ui/seqLinks'
import type { BoardSequence, SeqSeriesView } from '../ui/seqLinks'
import { looksLikeShape, readShape } from '../ui/shapeLinks'
import type { StatePatch } from './types'
import type { BoardStateApi } from './useBoardState'
import type { BoardRefsApi } from './useBoardRefs'
import type { ModelsApi } from './useModels'
import type { NoticesApi } from './useNotices'
import type { HistoryApi } from './useHistory'
import type { CurveEditingApi } from './useCurveEditing'
import type { CalcLinksApi } from './useCalcLinks'
import type { FieldsApi } from './useFields'
import type { ShapesApi } from './useShapes'

/** What useTypedLines reads from the hooks App calls before it. */
export interface TypedLinesDeps {
  board: BoardStateApi
  refs: BoardRefsApi
  derived: ModelsApi
  notices: NoticesApi
  history: HistoryApi
  editing: CurveEditingApi
  calc: CalcLinksApi
  fieldsApi: FieldsApi
  shapesApi: ShapesApi
}

export function useTypedLines({ board, refs, derived, notices, history, editing, calc, fieldsApi, shapesApi }: TypedLinesDeps) {
  const { setSelectedId, setSeqOpen } = board
  const {
    curvesRef, exprCounterRef, exprSourcesRef, brokenExprRef, displaySourcesRef, seqRef, namesRef,
    callsRef,
  } = refs
  const { modelsRef, registerModels, envFor } = derived
  const { showToast, showFeatureNote } = notices
  const { applyState, commitState, undo, withEdit, noteEdit } = history
  const { pickColor } = editing
  const { relabelEdit } = calc
  const { addField } = fieldsApi
  const { addShape } = shapesApi

  // ------------------------------------------------------- typed expressions

  /**
   * Fresh models for typed lines whose TEXT a rename rewrote (f(x − 1) →
   * p(x − 1)): each is parsed again against its own calls, under a NEW
   * expr_N — never over the old id, so an undo that brings the old text back
   * finds the old model still registered.
   */
  const reparseLines = useCallback(
    (
      ids: readonly string[],
      st: NameState,
    ):
      | {
          models: Record<string, ModelSpec>
          count: number
          apply(curves: FittedCurve[]): FittedCurve[]
        }
      | { error: string } => {
      const models: Record<string, ModelSpec> = {}
      const patch = new Map<string, { modelId: string; params: number[] }>()
      for (const id of ids) {
        const curve = curvesRef.current.find((c) => c.id === id)
        const src = st.exprSources[id]
        if (!curve || src === undefined) continue
        let outcome: ReturnType<typeof parseExpression>
        try {
          outcome = parseExpression(src, envFor(st.calls[id] ?? [], typedName(src)))
        } catch {
          return { error: `“${src}” could not be rewritten` }
        }
        if (!outcome.ok) return { error: `“${src}” could not be rewritten: ${outcome.error}` }
        const modelId = `expr_${++exprCounterRef.current}`
        try {
          models[modelId] = outcome.plot.makeModel(modelId)
        } catch {
          return { error: `“${src}” could not be rewritten` }
        }
        const params =
          outcome.plot.defaultParams.length === curve.params.length
            ? curve.params.slice()
            : outcome.plot.defaultParams.slice()
        patch.set(id, { modelId, params })
      }
      return {
        models,
        count: patch.size,
        apply: (curves) =>
          patch.size === 0
            ? curves
            : curves.map((c) => {
                const p = patch.get(c.id)
                return p ? { ...c, modelId: p.modelId, params: p.params } : c
              }),
      }
    },
    [envFor],
  )

  // ============================================================== sequences
  //
  // A sequence is its own object on the board — dots (n, aₙ), not a curve —
  // held as the line the teacher typed plus its constants, its index window
  // and two toggles (src/ui/seqLinks.ts). It names itself by its head letter
  // (a of aₙ) and holds no curve letter: a sequence refuses a letter a curve
  // holds, a typed curve refuses one a sequence holds, and the automatic
  // letters (f, g, h …) skip every sequence letter.

  /** One sequence, replaced in place. */
  const mapSeq = useCallback(
    (id: string, fn: (q: BoardSequence) => BoardSequence): BoardSequence[] =>
      seqRef.current.map((q) => (q.id === id ? fn(q) : q)),
    [],
  )

  /**
   * Put a sequence on the board — typed in the equation box, or built.
   * Returns the parser's own complaint (with its position) or the name clash,
   * so the equation box shows it where it shows an equation's.
   */
  const addSequence = useCallback(
    (src: string, opts: { n0?: number; count?: number; label?: string } = {}): string | null => {
      const parse = readSequence(src)
      if (!parse.ok) return sequenceError(parse)
      const seq = parse.seq
      // A typed list names no letter: it takes the next free one, and keeps it.
      const list = seq.kind === 'list'
      const taken = [...Object.values(namesRef.current), ...sequenceLetters(seqRef.current)]
      if (!list) {
        const clash = sequenceNameClash(
          seq.name,
          Object.values(namesRef.current),
          sequenceLetters(seqRef.current),
        )
        if (clash) return clash
      }
      const params = seq.defaultParams.slice()
      const win = defaultWindow(seq, params)
      const q: BoardSequence = {
        id: nextId(),
        src,
        color: pickColor(),
        visible: true,
        n0: opts.n0 !== undefined ? clampSeqN0(opts.n0) : win.n0,
        count: opts.count !== undefined ? clampSeqCount(opts.count) : win.count,
        showPartner: false,
        showSums: false,
        params,
        ...(list ? { name: nextSequenceLetter(taken) } : {}),
      }
      commitState({ sequences: [...seqRef.current, q] }, opts.label ?? 'add sequence')
      setSelectedId(q.id)
      return null
    },
    [commitState, pickColor],
  )

  /** "Build ▾ → Sequence → Add": the same path, one undo "build sequence". */
  const buildSequence = useCallback(
    (src: string, n0: number, count: number): string | null => {
      const err = addSequence(src, { n0, count, label: 'build sequence' })
      if (!err) setSeqOpen(false)
      return err
    },
    [addSequence],
  )

  /**
   * Retype a sequence on its card. The constants that survive keep their
   * values BY NAME; the window stays unless the new line states its own range.
   */
  const setSequenceSource = useCallback(
    (id: string, src: string): string | null => {
      const q = seqRef.current.find((s) => s.id === id)
      if (!q) return null
      if (q.src === src) return null
      const parse = readSequence(src)
      if (!parse.ok) return sequenceError(parse)
      const seq = parse.seq
      const others = sequenceLetters(seqRef.current.filter((s) => s.id !== id))
      const list = seq.kind === 'list'
      if (!list) {
        const clash = sequenceNameClash(seq.name, Object.values(namesRef.current), others)
        if (clash) return clash
      }
      // A list keeps the letter it had (or the one this sequence answered to).
      const listName = list
        ? q.name ?? (others.has(seqName(q)) ? nextSequenceLetter([...Object.values(namesRef.current), ...others]) : seqName(q))
        : undefined
      const was = readSequence(q.src)
      const params = carrySeqParams(
        was.ok ? was.seq.paramNames : [],
        q.params,
        seq.paramNames,
        seq.defaultParams,
      )
      const win = seq.range ? defaultWindow(seq, params) : { n0: q.n0, count: q.count }
      commitState(
        {
          sequences: mapSeq(id, (s) => {
            const { name: _old, ...rest } = s
            void _old
            return {
              ...rest,
              src,
              params,
              n0: win.n0,
              count: win.count,
              ...(listName !== undefined ? { name: listName } : {}),
            }
          }),
        },
        'edit sequence',
      )
      setSelectedId(id)
      return null
    },
    [commitState, mapSeq],
  )

  /** A constant in flight, inside the bracket the slider's press opened. */
  const setSeqParam = useCallback(
    (id: string, index: number, value: number): void => {
      if (!Number.isFinite(value)) return
      relabelEdit('move slider')
      applyState({
        sequences: mapSeq(id, (q) => {
          const p = readSequence(q.src)
          const params = (p.ok ? reconcileParams(p.seq, q.params) : q.params).slice()
          params[index] = value
          return { ...q, params }
        }),
      })
    },
    [applyState, mapSeq, relabelEdit],
  )

  /** A typed exact constant: one commit, one undo entry. */
  const setSeqParamExact = useCallback(
    (id: string, index: number, value: number): void => {
      if (!Number.isFinite(value)) return
      commitState(
        {
          sequences: mapSeq(id, (q) => {
            const p = readSequence(q.src)
            const params = (p.ok ? reconcileParams(p.seq, q.params) : q.params).slice()
            params[index] = value
            return { ...q, params }
          }),
        },
        'set value',
      )
      setSelectedId(id)
    },
    [commitState, mapSeq],
  )

  /** n from … to …: one undo entry. */
  const setSeqWindow = useCallback(
    (id: string, n0: number, count: number): string | null => {
      const q = seqRef.current.find((s) => s.id === id)
      if (!q) return null
      if (!Number.isFinite(n0) || !Number.isFinite(count) || count < 1) return 'n has to end after it starts.'
      const a = clampSeqN0(n0)
      const c = clampSeqCount(count)
      if (a === q.n0 && c === q.count) return null
      commitState({ sequences: mapSeq(id, (s) => ({ ...s, n0: a, count: c })) }, 'change n range')
      return c !== Math.round(count) ? `At most ${c} terms are shown.` : null
    },
    [commitState, mapSeq],
  )

  const toggleSeqVisible = useCallback(
    (id: string): void => {
      const now = seqRef.current.find((q) => q.id === id)
      commitState(
        { sequences: mapSeq(id, (q) => ({ ...q, visible: !q.visible })) },
        now && now.visible ? 'hide sequence' : 'show sequence',
      )
    },
    [commitState, mapSeq],
  )

  const toggleSeqPartner = useCallback(
    (id: string): void => {
      const now = seqRef.current.find((q) => q.id === id)
      commitState(
        { sequences: mapSeq(id, (q) => ({ ...q, showPartner: !q.showPartner })) },
        now && now.showPartner ? 'hide continuous partner' : 'show continuous partner',
      )
    },
    [commitState, mapSeq],
  )

  const toggleSeqSums = useCallback(
    (id: string): void => {
      const now = seqRef.current.find((q) => q.id === id)
      commitState(
        { sequences: mapSeq(id, (q) => ({ ...q, showSums: !q.showSums })) },
        now && now.showSums ? 'hide partial sums' : 'show partial sums',
      )
    },
    [commitState, mapSeq],
  )

  /** "Σ Show series": on at the default view, off (and forgotten). One undo entry. */
  const toggleSeqSeries = useCallback(
    (id: string): void => {
      const now = seqRef.current.find((q) => q.id === id)
      if (!now) return
      commitState(
        {
          sequences: mapSeq(id, (q) => {
            if (q.series) {
              const { series: _drop, ...rest } = q
              void _drop
              return rest
            }
            return { ...q, series: defaultSeriesView(q) }
          }),
        },
        now.series ? 'hide series' : 'show series',
      )
      setSelectedId(id)
    },
    [commitState, mapSeq],
  )

  /**
   * The series view: N, "join the sums", "staircase bars". A slider drag is
   * live (inside the bracket its press opened); a click is one commit.
   */
  const setSeqSeries = useCallback(
    (id: string, patch: Partial<SeqSeriesView>, live?: boolean): void => {
      const now = seqRef.current.find((q) => q.id === id)
      if (!now || !now.series) return
      const next = mapSeq(id, (q) => (q.series ? { ...q, series: { ...q.series, ...patch } } : q))
      if (live) {
        relabelEdit('move N')
        applyState({ sequences: next })
        return
      }
      const what =
        patch.connect !== undefined
          ? patch.connect ? 'join the partial sums' : 'unjoin the partial sums'
          : patch.bars !== undefined
            ? patch.bars ? 'show staircase bars' : 'hide staircase bars'
            : 'change N'
      commitState({ sequences: next }, what)
    },
    [applyState, commitState, mapSeq, relabelEdit],
  )

  const cycleSeqColor = useCallback(
    (id: string): void => {
      const now = seqRef.current.find((q) => q.id === id)
      if (!now) return
      const i = CURVE_COLORS.indexOf(now.color)
      const next = CURVE_COLORS[(i + 1) % CURVE_COLORS.length]
      commitState({ sequences: mapSeq(id, (q) => ({ ...q, color: next })) }, 'change colour')
    },
    [commitState, mapSeq],
  )

  /** Take a sequence off the board: one commit, one toast, one undo. */
  const deleteSequence = useCallback(
    (id: string): void => {
      const q = seqRef.current.find((s) => s.id === id)
      if (!q) return
      commitState({ sequences: seqRef.current.filter((s) => s.id !== id) }, 'delete sequence')
      showToast('Deleted the sequence. Undo brings it back.', {
        action: { label: 'Undo', run: () => undo() },
      })
      setSelectedId((sel) => (sel === id ? null : sel))
    },
    [commitState, showToast, undo],
  )

  /**
   * The same sequence again under the next free letter — a copy called a
   * would be refused, and two dots-in-a-row answering to one name is the
   * clash the letters exist to prevent.
   */
  const duplicateSequence = useCallback(
    (id: string): void => {
      const q = seqRef.current.find((s) => s.id === id)
      if (!q) return
      const to = nextSequenceLetter([
        ...Object.values(namesRef.current),
        ...sequenceLetters(seqRef.current),
      ])
      const copy: BoardSequence = { ...q, id: nextId(), color: pickColor(), params: q.params.slice() }
      if (isListLine(q.src)) {
        // A typed list says no letter: the copy is simply given the next one.
        copy.name = to
      } else {
        const renamed = renameSequenceSrc(q.src, seqName(q), to)
        if (renamed === q.src) {
          showToast('This sequence could not be renamed for a copy — retype it with another letter.', { ms: 4000 })
          return
        }
        copy.src = renamed
      }
      commitState({ sequences: [...seqRef.current, copy] }, 'duplicate sequence')
      setSelectedId(copy.id)
    },
    [commitState, pickColor, showToast],
  )

  /** Parse and add a typed expression. Returns an error message, or null on success. */
  const addExpression = useCallback(
    (src: string, label = 'add equation'): string | null => {
      // A SEQUENCE first: `a_n = 3 + 4(n - 1)`, `a(n) = …`, a recursion or a
      // bare list of three or more numbers. None of them is a curve, and the
      // curve parser would either refuse them or — worse — read `a_n` as a
      // product. Anything that starts like one stays on this branch, with the
      // sequence parser's own positioned complaint. A line that opens with
      // `y =` or `f(x) =` never comes here (looksLikeSequence).
      // The sequence parser itself may say "Not a sequence —": then, and only
      // then, the line goes on to the curve parsers below.
      if (looksLikeSequence(src)) {
        const asSeq = readSequence(src)
        if (asSeq.ok || !/^Not a sequence/i.test(asSeq.error)) return addSequence(src)
      }

      // A differential equation is not an equation: "dy/dx = x - y" would be
      // read by parseExpression as a product of d, y and x set equal to
      // another, and the board would quietly draw an implicit curve nobody
      // asked for. So the field parser is asked FIRST, and anything that even
      // starts like a derivative stays on this branch — with the slope-field
      // parser's own positioned complaint — rather than falling through to a
      // second parser that can only be confused by it.
      const asField = readField(src)
      if (asField.ok) return addField(src)
      if (looksLikeField(src)) return asField.error

      // Then a shape. "(1, 2)" is a point and "ABC = (0,0) (4,0) (4,3)" is a
      // triangle; both are things the expression parser would either refuse or
      // — worse — quietly read as something else.
      // A pair of formulas in t — (2cos(t), 3sin(t)) — is a parametric CURVE
      // (src/core/motion.ts), not a point with a slider t: it goes on to the
      // expression parser. (t, 1) is still the point it always was.
      const asShape = readShape(src)
      if (asShape.ok && !isParametricPair(src)) return addShape(src)

      // Which letters this line CALLS — f of `2f(x − 1)` — decided now, once
      // (src/ui/nameLinks.ts). A call of a curve that is not a function of x
      // is refused in words rather than read as a slider.
      const head = typedName(src)
      const lineCalls = boundCalls(src, {
        letters: boardLetters(namesRef.current, callsRef.current, head ?? undefined),
      })
      {
        const owners = nameOwners(namesRef.current)
        for (const L of lineCalls) {
          const holder = owners.get(L)
          const c = holder ? curvesRef.current.find((k) => k.id === holder) : undefined
          if (c && c.kind !== 'explicit') return notCallable(L, c, modelsRef.current[c.modelId])
        }
      }

      let outcome: ReturnType<typeof parseExpression>
      try {
        outcome = parseExpression(src, envFor(lineCalls, head))
      } catch {
        return 'The parser crashed on this input'
      }
      if (!outcome.ok) {
        // BOTH parsers have now refused it. Which complaint is the useful one
        // depends on what the teacher was evidently writing: the shape parser
        // refuses "y = x" and "(x+1)(x-2)" as loudly as it refuses a malformed
        // triangle, and its "that is a curve" is the last thing someone typing
        // a curve needs to read. So its message surfaces only when the line
        // clearly IS a shape — a shape word, a name and a bracket, or a line
        // that opens with one.
        if (looksLikeShape(src) && !asShape.ok) return asShape.error
        // The parser's message already embeds the position where relevant.
        return outcome.error
      }
      const plot = outcome.plot
      const curveId = nextId()
      // The name: a typed head claims its letter (moving a curve that only
      // had it automatically, and the lines calling that curve with it).
      let nameState: NameState = {
        names: namesRef.current,
        exprSources: { ...exprSourcesRef.current, [curveId]: src },
        displaySources: displaySourcesRef.current,
        calls: lineCalls.length > 0 ? { ...callsRef.current, [curveId]: lineCalls } : callsRef.current,
      }
      let rewritten: string[] = []
      let displaced: { id: string; from: string; to: string } | undefined
      if (head) {
        // A sequence's letter is not a curve's: aₙ and a(x) on one board is
        // two things answering to one name.
        const clash = curveNameClash(head, sequenceLetters(seqRef.current))
        if (clash) return clash
        const claim = planClaim(
          nameState,
          curveId,
          head,
          new Set([...sliderLetters(curvesRef.current, exprSourcesRef.current, modelsRef.current), ...sequenceLetters(seqRef.current)]),
        )
        if ('error' in claim) return claim.error
        nameState = claim.state
        rewritten = claim.rewritten.filter((r) => r !== curveId)
        displaced = claim.displaced
      }
      const re = reparseLines(rewritten, nameState)
      if ('error' in re) return re.error
      const modelId = `expr_${++exprCounterRef.current}`
      let spec: ModelSpec
      try {
        spec = plot.makeModel(modelId)
      } catch {
        return 'Could not build a plot from this expression'
      }
      registerModels({ ...re.models, [modelId]: spec })
      const curve: FittedCurve = {
        id: curveId,
        modelId,
        params: plot.defaultParams.slice(),
        kind: plot.kind,
        domain: plot.domain,
        color: pickColor(),
        strokeWidth: 2.5,
        visible: true,
        error: 0,
      }
      // Keep the source text: it is the only thing that can rebuild this
      // curve's model closure after a reload. It rides in the same commit as
      // the curve so undo/redo can never separate the two.
      commitState(
        {
          curves: [...re.apply(curvesRef.current), curve],
          exprSources: nameState.exprSources,
          displaySources: nameState.displaySources,
          names: nameState.names,
          calls: nameState.calls,
        },
        label,
      )
      setSelectedId(curve.id)
      if (displaced) {
        showFeatureNote({
          kind: 'moved',
          key: Date.now(),
          text: `${displaced.from} is this line now — the curve that was ${displaced.from} is called ${displaced.to}${
            re.count > 0 ? ', and the lines that used it say so' : ''
          }.`,
        })
      }
      return null
    },
    [addField, addShape, addSequence, commitState, envFor, pickColor, registerModels, reparseLines, showFeatureNote],
  )

  /**
   * The one path that makes a curve a TYPED EXPRESSION from a parsed line, in
   * place: same id, colour, style, calculus links and name — only its model,
   * domain and source change. A card's retyped equation takes it, and so does
   * every edit from a Roots section and every dragged root on the board.
   *
   * `live` is a drag in flight: the state moves inside the bracket the press
   * opened (so a whole drag is one undo, named `label`) instead of committing
   * an entry of its own.
   */
  const restateAsExpression = useCallback(
    (
      id: string,
      src: string,
      plot: ParsedPlot,
      label: string,
      live: boolean,
    ): string | null => {
      const curve = curvesRef.current.find((c) => c.id === id)
      if (!curve) return null
      // The letters this line calls: what it called before stays a call,
      // what was a slider stays a slider, anything new is decided as a new
      // line's would be. A line that calls something is parsed again against
      // them — the plot handed in was read without any.
      const own = namesRef.current[id]
      const head = typedName(src)
      let prevSliders: Set<string> | undefined
      try {
        const was = modelsRef.current[curve.modelId]
        prevSliders = was ? new Set(was.paramMeta(curve.params).map((m) => m.name)) : undefined
      } catch {
        prevSliders = undefined
      }
      const lineCalls = boundCalls(src, {
        letters: boardLetters(namesRef.current, callsRef.current, own),
        prevCalls: callsRef.current[id],
        prevSliders,
      })
      {
        const owners = nameOwners(namesRef.current)
        for (const L of lineCalls) {
          const holder = owners.get(L)
          const c = holder && holder !== id ? curvesRef.current.find((k) => k.id === holder) : undefined
          if (c && c.kind !== 'explicit') return notCallable(L, c, modelsRef.current[c.modelId])
        }
      }
      if (lineCalls.length > 0 || head) {
        let again: ReturnType<typeof parseExpression>
        try {
          again = parseExpression(src, envFor(lineCalls, head))
        } catch {
          return 'The parser crashed on this input'
        }
        if (!again.ok) return again.error
        plot = again.plot
      }
      // A retyped head is a rename: `g(x) = …` retyped as `p(x) = …` takes p
      // and every line that called g now calls p.
      let nameState: NameState = {
        names: namesRef.current,
        exprSources: { ...exprSourcesRef.current, [id]: src },
        displaySources: displaySourcesRef.current,
        calls: { ...callsRef.current, [id]: lineCalls },
      }
      let rewritten: string[] = []
      if (head && head !== own && !live) {
        const clash = curveNameClash(head, sequenceLetters(seqRef.current))
        if (clash) return clash
        const claim = planClaim(
          nameState,
          id,
          head,
          new Set([...sliderLetters(curvesRef.current, exprSourcesRef.current, modelsRef.current), ...sequenceLetters(seqRef.current)]),
        )
        if ('error' in claim) return claim.error
        nameState = claim.state
        rewritten = claim.rewritten.filter((r) => r !== id)
      }
      const re = reparseLines(rewritten, nameState)
      if ('error' in re) return re.error
      const modelId = `expr_${++exprCounterRef.current}`
      let spec: ModelSpec
      try {
        spec = plot.makeModel(modelId)
      } catch {
        return 'Could not build a plot from this expression'
      }
      registerModels({ ...re.models, [modelId]: spec })
      // The ink belonged to the family that just went away; keeping it would
      // let an oversketch try to refit a model that no longer exists. Undo
      // restores the whole curve, ink included.
      const { sourceStroke: _ink, ...bare } = curve
      const { [id]: _wasBroken, ...restBroken } = brokenExprRef.current
      const { [id]: _shown, ...restShown } = nameState.displaySources
      const finalPlot = plot
      const patch: StatePatch = {
        curves: re.apply(curvesRef.current).map((c) =>
          c.id === id
            ? {
                ...bare,
                modelId,
                kind: finalPlot.kind,
                params: finalPlot.defaultParams.slice(),
                domain: finalPlot.domain,
                error: 0,
              }
            : c,
        ),
        exprSources: nameState.exprSources,
        brokenExpr: restBroken,
        displaySources: restShown,
        names: nameState.names,
        calls: nameState.calls,
      }
      if (live) {
        relabelEdit(label)
        noteEdit(id, { kind: 'equation' })
        applyState(patch)
      } else {
        commitState({ ...patch, edits: withEdit(id, { kind: 'equation' }) }, label)
        setSelectedId(id)
      }
      return null
    },
    [applyState, commitState, envFor, noteEdit, registerModels, relabelEdit, reparseLines, withEdit],
  )

  /**
   * Rewrite a TYPED curve's line and restate it in place — the Roots
   * section's edits and a dragged root both end here. Refuses (with the
   * parser's words) a line that does not parse, and does nothing for a line
   * that has not changed.
   */
  const restateTypedCurve = useCallback(
    (id: string, src: string, label: string, live = false): string | null => {
      const curve = curvesRef.current.find((c) => c.id === id)
      if (!curve || !curve.modelId.startsWith('expr_')) return null
      if (exprSourcesRef.current[id] === src && brokenExprRef.current[id] === undefined) return null
      let res: ReturnType<typeof readCurveEquation>
      try {
        res = readCurveEquation(
          src,
          curve,
          undefined,
          envFor(callsRef.current[id] ?? [], typedName(src)),
        )
      } catch {
        return 'The parser crashed on this input'
      }
      if (!res.ok) return res.error
      if (res.mode === 'family') return null
      return restateAsExpression(id, src, res.plot, label, live)
    },
    [envFor, restateAsExpression],
  )

  /**
   * Retype the equation ON a card.
   *
   * THE TRADE THIS MAKES. A sketched curve is a member of a family — poly3,
   * sine, circle — and that membership is what gives it drag handles, an
   * arrow-nudge, an Interpretations list and "put this zero at x = 2". A typed
   * expression has none of those. So the edited text is first offered back to
   * the curve's OWN family: when it still is one (new coefficients on the same
   * cubic, however it is written), only the params change and every handle
   * survives. Only when the text is genuinely something else does the curve
   * become a typed expression — and then the board says what was traded, in
   * the same non-modal line that reports a feature edit's side effects, so it
   * is never a silent downgrade. Either way it is one undo entry.
   */
  const setCurveEquation = useCallback(
    (id: string, src: string): string | null => {
      const curve = curvesRef.current.find((c) => c.id === id)
      if (!curve) return null
      const isExpr = curve.modelId.startsWith('expr_')
      // The letters the new text would call. A line that calls another curve
      // is typed by construction — it is never read back as a family.
      const lineCalls = boundCalls(src, {
        letters: boardLetters(namesRef.current, callsRef.current, namesRef.current[id]),
        prevCalls: callsRef.current[id],
      })
      // A curve that is already an expression stays one: it has no handles to
      // protect, and its free constants are sliders the user asked for by name.
      const familySpec =
        isExpr || lineCalls.length > 0 ? undefined : modelsRef.current[curve.modelId]

      let res: ReturnType<typeof readCurveEquation>
      try {
        res = readCurveEquation(src, curve, familySpec, envFor(lineCalls, typedName(src)))
      } catch {
        return 'The parser crashed on this input'
      }
      if (!res.ok) return res.error

      if (res.mode === 'family') {
        const unchanged =
          res.params.length === curve.params.length &&
          res.params.every((v, i) => Object.is(v, curve.params[i]))
        // Pressing Enter on a line nobody edited is not an edit.
        const renames = typedName(src) !== null && typedName(src) !== namesRef.current[id]
        if (unchanged && !renames) return null
        // `g(x) = …` typed over a curve called f renames it — with every line
        // that called f following it to g.
        let nameState: NameState = {
          names: namesRef.current,
          exprSources: exprSourcesRef.current,
          displaySources: { ...displaySourcesRef.current, [id]: src },
          calls: callsRef.current,
        }
        const head = typedName(src)
        let re: Exclude<ReturnType<typeof reparseLines>, { error: string }> | null = null
        if (head && head !== namesRef.current[id]) {
          const clash = curveNameClash(head, sequenceLetters(seqRef.current))
          if (clash) return clash
          const claim = planClaim(
            nameState,
            id,
            head,
            new Set([...sliderLetters(curvesRef.current, exprSourcesRef.current, modelsRef.current), ...sequenceLetters(seqRef.current)]),
          )
          if ('error' in claim) return claim.error
          nameState = claim.state
          const got = reparseLines(claim.rewritten.filter((r) => r !== id), nameState)
          if ('error' in got) return got.error
          re = got
          registerModels(got.models)
        }
        // The curve is still a cubic (or a circle, or a sine) — so every handle
        // and every interpretation survives, and the card goes on printing the
        // line the user wrote. A lesson about factored form must not have its
        // equation expanded the moment it is entered.
        const base = re ? re.apply(curvesRef.current) : curvesRef.current
        commitState(
          {
            curves: base.map((c) =>
              c.id === id ? { ...c, params: res.params.slice() } : c,
            ),
            displaySources: nameState.displaySources,
            exprSources: nameState.exprSources,
            names: nameState.names,
            calls: nameState.calls,
            edits: withEdit(id, { kind: 'equation' }),
          },
          'edit equation',
        )
        setSelectedId(id)
        return null
      }

      if (isExpr && exprSourcesRef.current[id] === src && brokenExprRef.current[id] === undefined) {
        return null
      }
      const lost = isExpr ? null : (familySpec?.name ?? null)
      const err = restateAsExpression(id, src, res.plot, 'edit equation', false)
      if (err) return err
      if (lost) {
        showFeatureNote({
          kind: 'moved',
          key: Date.now(),
          text: `That is no longer a ${lost.toLowerCase()}, so it is a typed equation now — it has no drag handles or fit error. Undo brings the ${lost.toLowerCase()} back.`,
        })
      }
      return null
    },
    [restateAsExpression, commitState, envFor, registerModels, reparseLines, showFeatureNote, withEdit],
  )

  return {
    reparseLines, buildSequence, setSequenceSource, setSeqParam, setSeqParamExact, setSeqWindow,
    toggleSeqVisible, toggleSeqPartner, toggleSeqSums, toggleSeqSeries, setSeqSeries, cycleSeqColor,
    deleteSequence, duplicateSequence, addExpression, restateAsExpression, restateTypedCurve,
    setCurveEquation,
  }
}

export type TypedLinesApi = ReturnType<typeof useTypedLines>
