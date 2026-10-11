// ============================================================================
// src/app/useDomainLens.ts — Show inverse, and domain and range.
//
// The inverse builders, the Domain / Range / One-to-one rows' facts (cached
// per curve), restrictions, the horizontal line test, the reflection and the
// inverse curve.
//
// Called once per render by App (src/App.tsx), in sequence with the other
// src/app hooks. The order of those calls is the order of every useState, ref,
// memo and effect on the board, so a new hook goes where its inputs exist.
// ============================================================================

import { useCallback, useMemo, useRef } from 'react'
import { curveDomain, curveRange, naturalDomain, oneToOneInfo } from '../core/domainRange'
import type { OneToOne, RealSet } from '../core/domainRange'
import { MODELS } from '../core/fit/models'
import { invertFormula } from '../core/inverse'
import type { InverseFormula } from '../core/inverse'
import { parseExpression } from '../core/parse'
import { INV_MODEL_PREFIX } from '../core/persist'
import type { InverseLink } from '../core/persist'
import { nextId } from '../core/types'
import type { FittedCurve, ModelSpec } from '../core/types'
import { typedName } from '../render/curveNames'
import { patchLens } from '../ui/curveViews'
import {
  drawnExtent,
  explicitF,
  hltStart,
  inverseCurveLine,
  inverseRestriction,
  probeX,
  restrictedLine,
  sketchDomain,
  splitTyped,
  WHY_PIECEWISE,
} from '../ui/domainLinks'
import type { DomainActions, Restriction, RestrictMode } from '../ui/domainLinks'
import { curveEquationText } from '../ui/equationText'
import { lineVariable } from '../ui/familyLine'
import {
  inverseColor,
  isIdentityLine,
  MIRROR_COLOR,
  MIRROR_DASH,
  MIRROR_SRC,
  planInverse,
} from '../ui/logLinks'
import { inverseInfo, inverseRange, planRename, sliderLetters } from '../ui/nameLinks'
import type { InverseInfo, NameState } from '../ui/nameLinks'
import { curveNameClash, sequenceLetters } from '../ui/seqLinks'
import type { BoardStateApi } from './useBoardState'
import type { SessionStateApi } from './useSessionState'
import type { BoardRefsApi } from './useBoardRefs'
import type { ModelsApi } from './useModels'
import type { NoticesApi } from './useNotices'
import type { HistoryApi } from './useHistory'
import type { CalcLinksApi } from './useCalcLinks'
import type { TypedLinesApi } from './useTypedLines'

/** What useDomainLens reads from the hooks App calls before it. */
export interface DomainLensDeps {
  board: BoardStateApi
  session: SessionStateApi
  refs: BoardRefsApi
  derived: ModelsApi
  notices: NoticesApi
  history: HistoryApi
  calc: CalcLinksApi
  typed: TypedLinesApi
}

export function useDomainLens({ board, session, refs, derived, notices, history, calc, typed }: DomainLensDeps) {
  const { setLens, lensRef, setExtraModels } = board
  const { changeSetNotation } = session
  const {
    curvesRef, stylesRef, exprCounterRef, exprSourcesRef, displaySourcesRef, seqRef, namesRef,
    callsRef, inversesRef, boardCurveNamesRef,
  } = refs
  const {
    modelsRef, registerModels, envFor, inverseInfoRef, makeInverseSpec, depKeysRef, vpRef,
  } = derived
  const { showFeatureNote } = notices
  const { commitState } = history
  const { viewWindow } = calc
  const { reparseLines, restateTypedCurve } = typed

  /**
   * The typed lines that call nothing. A line like h(x) = p(g(x)) read on its
   * own — without the names it calls — is the product p·g·x, which at its
   * default sliders IS y = x; only lines that stand alone can be asked
   * "are you already the mirror line?".
   */
  const plainSources = useCallback(
    (): string[] =>
      Object.entries(exprSourcesRef.current)
        .filter(([id]) => !(callsRef.current[id]?.length))
        .map(([, src]) => src),
    [],
  )

  /**
   * "Show inverse" on an Exponential or a Logarithmic section: the exact
   * inverse as a NEW, independent typed curve in the paired palette colour,
   * and — once per board — the mirror line y = x, dashed. One undo entry.
   * The inverse is not linked: editing the original later does not move it.
   */
  const showInverse = useCallback(
    (id: string): void => {
      const curve = curvesRef.current.find((c) => c.id === id)
      const from = exprSourcesRef.current[id]
      if (!curve || !from) return
      const plan = planInverse(from, plainSources())
      if (!plan) {
        showFeatureNote({ kind: 'moved', key: Date.now(), text: 'This curve has no inverse to show.' })
        return
      }
      const lines: { src: string; color: string; mirror: boolean }[] = []
      if (plan.src) lines.push({ src: plan.src, color: inverseColor(curve.color), mirror: false })
      if (plan.mirror) lines.push({ src: MIRROR_SRC, color: MIRROR_COLOR, mirror: true })
      if (lines.length === 0) {
        showFeatureNote({ kind: 'moved', key: Date.now(), text: plan.notice })
        return
      }
      const made: FittedCurve[] = []
      let mirror: FittedCurve | undefined
      const models: Record<string, ModelSpec> = {}
      const sources: Record<string, string> = {}
      for (const line of lines) {
        let outcome: ReturnType<typeof parseExpression>
        try {
          outcome = parseExpression(line.src)
        } catch {
          return
        }
        if (!outcome.ok) {
          showFeatureNote({ kind: 'moved', key: Date.now(), text: outcome.error })
          return
        }
        const modelId = `expr_${++exprCounterRef.current}`
        try {
          models[modelId] = outcome.plot.makeModel(modelId)
        } catch {
          return
        }
        const c: FittedCurve = {
          id: nextId(),
          modelId,
          params: outcome.plot.defaultParams.slice(),
          kind: outcome.plot.kind,
          domain: outcome.plot.domain,
          color: line.color,
          strokeWidth: 2.5,
          visible: true,
          error: 0,
        }
        made.push(c)
        if (line.mirror) mirror = c
        sources[c.id] = line.src
      }
      setExtraModels((prev) => ({ ...prev, ...models }))
      commitState(
        {
          curves: [...curvesRef.current, ...made],
          exprSources: { ...exprSourcesRef.current, ...sources },
          ...(mirror
            ? {
                styles: {
                  ...stylesRef.current,
                  [mirror.id]: { ...stylesRef.current[mirror.id], dash: MIRROR_DASH.slice() },
                },
              }
            : {}),
        },
        'show inverse',
      )
      showFeatureNote({ kind: 'moved', key: Date.now(), text: plan.notice })
    },
    [commitState, plainSources, showFeatureNote],
  )

  /**
   * "Show inverse" on ANY explicit curve's ⋯ menu. An exponential or a
   * logarithm gets its EXACT inverse as a typed line (showInverse above) —
   * y = log_2(x) is a better answer than a reflected picture of 2^x. Anything
   * else gets the inverse RELATION: the parametric curve (f(t), t) as a link
   * to f (src/core/functionEnv.ts's inverseRelation), drawn in the paired
   * colour and reading f live, with the horizontal line test on its card —
   * plus the one dashed y = x. One undo entry; deleting f takes it along.
   */
  const showInverseOf = useCallback(
    (id: string): void => {
      const curve = curvesRef.current.find((c) => c.id === id)
      if (!curve || curve.kind !== 'explicit') return
      const typed = exprSourcesRef.current[id]
      if (typed && planInverse(typed, plainSources())) {
        showInverse(id)
        return
      }
      const name = namesRef.current[id] ?? 'f'
      if (inversesRef.current.some((l) => l.parentId === id)) {
        showFeatureNote({
          kind: 'moved',
          key: Date.now(),
          text: `The inverse of ${name} is already on the board.`,
        })
        return
      }
      const range = inverseRange(curve, viewWindow())
      const linkId = nextId()
      const modelId = `${INV_MODEL_PREFIX}${linkId}`
      const link: InverseLink = { id: linkId, parentId: id, curveId: nextId(), from: range[0], to: range[1] }
      let info: InverseInfo
      try {
        info = inverseInfo(curve, modelsRef.current, link, name)
      } catch {
        showFeatureNote({ kind: 'moved', key: Date.now(), text: 'This curve has no inverse to show.' })
        return
      }
      inverseInfoRef.current = { ...inverseInfoRef.current, [linkId]: info }
      const models: Record<string, ModelSpec> = { [modelId]: makeInverseSpec(modelId, link) }
      const child: FittedCurve = {
        id: link.curveId,
        modelId,
        params: [],
        kind: 'parametric',
        domain: info.tRange,
        color: inverseColor(curve.color),
        strokeWidth: 2.5,
        visible: true,
        error: 0,
      }
      const made: FittedCurve[] = [child]
      const sources: Record<string, string> = {}
      let mirror: FittedCurve | undefined
      if (!plainSources().some(isIdentityLine)) {
        const o = parseExpression(MIRROR_SRC)
        if (o.ok) {
          const mid = `expr_${++exprCounterRef.current}`
          models[mid] = o.plot.makeModel(mid)
          mirror = {
            id: nextId(),
            modelId: mid,
            params: o.plot.defaultParams.slice(),
            kind: o.plot.kind,
            domain: o.plot.domain,
            color: MIRROR_COLOR,
            strokeWidth: 2.5,
            visible: true,
            error: 0,
          }
          made.push(mirror)
          sources[mirror.id] = MIRROR_SRC
        }
      }
      registerModels(models)
      commitState(
        {
          curves: [...curvesRef.current, ...made],
          inverses: [...inversesRef.current, link],
          ...(mirror
            ? {
                exprSources: { ...exprSourcesRef.current, ...sources },
                styles: {
                  ...stylesRef.current,
                  [mirror.id]: { ...stylesRef.current[mirror.id], dash: MIRROR_DASH.slice() },
                },
              }
            : {}),
        },
        'show inverse',
      )
      showFeatureNote({
        kind: 'moved',
        key: Date.now(),
        text: `${info.sentence}${mirror ? ' — added the line y = x' : ''}.`,
      })
    },
    [commitState, makeInverseSpec, plainSources, registerModels, showFeatureNote, showInverse, viewWindow],
  )

  // ======================================================= domain and range
  //
  // The Domain, Range and One-to-one rows at the top of a card's Analysis
  // table, the restriction editor and chips, the cut-off part's ghost, the
  // horizontal line test, the reflected point and the inverse as an
  // equation. The mathematics is src/core/domainRange.ts and
  // src/core/inverse.ts; the text between it and the card is
  // src/ui/domainLinks.ts. Nothing here is stored except the restriction
  // itself (the typed line, or a sketch's domain) and the board switches
  // (board.curveViews); every set is recomputed, cached per curve on the same
  // value key the analysis uses.

  interface DomainFacts {
    natural: RealSet | null
    domain: RealSet | null
    range: RealSet | null
    one: OneToOne | null
  }
  /**
   * A typed RESTRICTED line's model without its restriction ("y = x^2" for
   * "y = x^2 {x >= 0}"), cached per curve on its body: what the ghost of the
   * cut-off part draws, and the natural domain the restriction is measured
   * against. Null for a line with no restriction, a piecewise, or a sketch.
   */
  const baseModelCacheRef = useRef(new Map<string, { key: string; spec: ModelSpec | null }>())
  const baseModelOf = useCallback(
    (curve: FittedCurve): ModelSpec | null => {
      if (curve.kind !== 'explicit' || !curve.modelId.startsWith('expr_')) return null
      const split = splitTyped(exprSourcesRef.current[curve.id])
      if (!split || split === 'piecewise' || split.cond === null) return null
      const hit = baseModelCacheRef.current.get(curve.id)
      if (hit && hit.key === split.base) return hit.spec
      let spec: ModelSpec | null = null
      try {
        const o = parseExpression(split.base, envFor(callsRef.current[curve.id] ?? [], typedName(split.base)))
        spec = o.ok && o.plot.kind === 'explicit' ? o.plot.makeModel(`base_${curve.id}`) : null
      } catch {
        spec = null
      }
      baseModelCacheRef.current.set(curve.id, { key: split.base, spec })
      return spec
    },
    [envFor],
  )
  const domainFactsCacheRef = useRef(new Map<string, { key: string; facts: DomainFacts }>())
  const domainFactsKey = useCallback(
    (curve: FittedCurve): string =>
      `${curve.modelId}|${curve.params.join(',')}|${curve.domain ? curve.domain.join(',') : ''}|${
        depKeysRef.current[curve.id] ?? ''
      }|${exprSourcesRef.current[curve.id] ?? ''}|${modelsRef.current[curve.modelId] ? 1 : 0}`,
    [],
  )
  /**
   * f's natural domain, curve domain, range and horizontal line test — cached
   * per curve. `live` (a drag or a slider in flight): the last answer stands
   * until the gesture ends — a scan of the whole line is ~20 ms, which a
   * frame cannot afford — and the rows catch up the moment it is committed.
   */
  const domainFactsFor = useCallback(
    (curve: FittedCurve, live = false): DomainFacts => {
      const key = domainFactsKey(curve)
      const hit = domainFactsCacheRef.current.get(curve.id)
      if (hit && (hit.key === key || live)) return hit.facts
      const models = modelsRef.current
      const safe = <T,>(f: () => T): T | null => {
        try {
          return f() ?? null
        } catch {
          return null
        }
      }
      // A sketch still on the piece it was drawn over is a FUNCTION drawn on
      // a piece: its domain, range and one-to-one are the function's
      // (drawnExtent in src/ui/domainLinks.ts); the card names the piece.
      if (drawnExtent(curve)) curve = { ...curve, domain: null }
      // The natural domain of a restricted typed line is its BODY's: the
      // restriction is what the teacher set, measured against it.
      const base = baseModelOf(curve)
      const facts: DomainFacts = {
        natural: safe(() =>
          base
            ? naturalDomain({ ...curve, modelId: base.id, domain: null }, { ...models, [base.id]: base })
            : naturalDomain(curve, models),
        ),
        domain: safe(() => curveDomain(curve, models)),
        range: safe(() => curveRange(curve, models)),
        one: safe(() => oneToOneInfo(curve, models)),
      }
      domainFactsCacheRef.current.set(curve.id, { key, facts })
      return facts
    },
    [domainFactsKey, baseModelOf],
  )

  /** How this curve's domain can be restricted from its card. */
  const restrictModeOf = useCallback((curve: FittedCurve): RestrictMode => {
    if (curve.kind !== 'explicit') return { kind: 'none', why: 'Only a function y = f(x) has a domain to restrict here.' }
    const src = exprSourcesRef.current[curve.id]
    if (curve.modelId.startsWith('expr_') && src) {
      const split = splitTyped(src)
      if (split === 'piecewise') return { kind: 'none', why: WHY_PIECEWISE }
      if (split === null) return { kind: 'none', why: 'This line has nothing to restrict.' }
      return { kind: 'typed', cond: split.cond }
    }
    if (MODELS[curve.modelId]) return { kind: 'sketch', domain: curve.domain }
    return {
      kind: 'none',
      why: 'This curve is drawn from another one — restrict the domain of the curve it comes from.',
    }
  }, [])

  /** The line invertFormula reads: the typed line without its restriction, or a sketch's equation. */
  const inverseSourceOf = useCallback((curve: FittedCurve): string | null => {
    const src = exprSourcesRef.current[curve.id]
    if (curve.modelId.startsWith('expr_') && src) {
      const split = splitTyped(src)
      return split && split !== 'piecewise' ? split.base : null
    }
    try {
      return curveEquationText(curve, modelsRef.current[curve.modelId])
    } catch {
      return null
    }
  }, [])

  const inverseFormulaCacheRef = useRef(new Map<string, { key: string; formula: InverseFormula | null }>())
  /** f⁻¹ as an equation, on the stretch the teacher chose (null: no formula). */
  const inverseFormulaFor = useCallback(
    (curve: FittedCurve, facts: DomainFacts, name: string): InverseFormula | null => {
      const src = inverseSourceOf(curve)
      if (!src) return null
      const restriction = inverseRestriction(facts.domain, facts.natural)
      const key = `${src}|${name}|${
        restriction
          ? `${restriction.lo},${restriction.hi},${restriction.loClosed},${restriction.hiClosed}`
          : '-'
      }|${depKeysRef.current[curve.id] ?? ''}`
      const hit = inverseFormulaCacheRef.current.get(curve.id)
      if (hit && hit.key === key) return hit.formula
      let formula: InverseFormula | null = null
      try {
        formula = invertFormula(src, restriction, name)
      } catch {
        formula = null
      }
      inverseFormulaCacheRef.current.set(curve.id, { key, formula })
      return formula
    },
    [inverseSourceOf],
  )

  /** One curve's board switches, changed — ref now, state for the render. Never an undo step. */
  const patchLensFor = useCallback(
    (id: string, patch: { ghost?: boolean; hlt?: number | null; reflect?: number | null }): void => {
      const next = patchLens(lensRef.current, id, patch)
      if (next === lensRef.current) return
      lensRef.current = next
      setLens(next)
    },
    [],
  )

  /**
   * Restrict (or, with null, un-restrict) a function's domain from its card.
   * A typed line is rewritten with the restriction clause the parser reads —
   * the body kept, any old restriction replaced; a sketch's domain is set.
   * One undo entry either way. A new restriction switches the ghost of the
   * cut-off part on, so the teacher sees what was cut.
   */
  const restrictDomain = useCallback(
    (id: string, r: Restriction | null): string | null => {
      const curve = curvesRef.current.find((c) => c.id === id)
      if (!curve) return null
      const mode = restrictModeOf(curve)
      if (mode.kind === 'none') return mode.why
      if (mode.kind === 'typed') {
        const src = exprSourcesRef.current[id]
        // written in the line's own variable: d(t) = … {0 <= t <= 24}
        const line = restrictedLine(src, r ?? { lo: null, hi: null }, lineVariable(src))
        if (line === null) return WHY_PIECEWISE
        const err = restateTypedCurve(id, line, r ? 'restrict domain' : 'clear restriction')
        if (err) return err
      } else {
        const dom = r ? sketchDomain(r, curve.domain, viewWindow()) : null
        if (r && !dom) return 'That leaves no domain at all.'
        commitState(
          { curves: curvesRef.current.map((c) => (c.id === id ? { ...c, domain: dom } : c)) },
          r ? 'restrict domain' : 'clear restriction',
        )
      }
      patchLensFor(id, { ghost: r !== null })
      return null
    },
    [commitState, patchLensFor, restateTypedCurve, restrictModeOf, viewWindow],
  )

  /** The horizontal line test on or off; on starts where it fails, if it can. */
  const toggleHlt = useCallback(
    (id: string, on: boolean): void => {
      if (!on) {
        patchLensFor(id, { hlt: null })
        return
      }
      const curve = curvesRef.current.find((c) => c.id === id)
      if (!curve) return
      const f = explicitF(curve, modelsRef.current)
      const vp = vpRef.current
      const y = hltStart(domainFactsFor(curve).one, f ? f(0) : Number.NaN, vp.center.y)
      patchLensFor(id, { hlt: y })
    },
    [domainFactsFor, patchLensFor],
  )

  /** The reflected point on or off; it starts at a = 1 (or the nearest x where f is defined). */
  const toggleReflect = useCallback(
    (id: string, on: boolean): void => {
      if (!on) {
        patchLensFor(id, { reflect: null })
        return
      }
      const curve = curvesRef.current.find((c) => c.id === id)
      const f = curve ? explicitF(curve, modelsRef.current) : null
      if (!f) return
      const vp = vpRef.current
      const start = Number.isFinite(f(1)) ? 1 : probeX(f, vp.center.x, 20 / vp.pxPerUnit)
      patchLensFor(id, { reflect: start })
    },
    [patchLensFor],
  )

  /**
   * "Add f⁻¹(x) as its own curve": the inverse's line typed as an ordinary
   * explicit curve — analysis, a card, a name of its own — restricted to f's
   * range when that is one interval short of ℝ, so its domain is the inverse
   * function's. And y = x once, like every other inverse. One undo entry.
   */
  const addInverseCurve = useCallback(
    (id: string): void => {
      const curve = curvesRef.current.find((c) => c.id === id)
      if (!curve) return
      const facts = domainFactsFor(curve)
      const name = boardCurveNamesRef.current[id] ?? namesRef.current[id] ?? 'f'
      const formula = inverseFormulaFor(curve, facts, name)
      if (!formula) {
        showFeatureNote({ kind: 'moved', key: Date.now(), text: `There is no formula for ${name}⁻¹ to type.` })
        return
      }
      const lines: { src: string; color: string; mirror: boolean }[] = [
        { src: inverseCurveLine(formula.source, facts.range), color: inverseColor(curve.color), mirror: false },
      ]
      if (!plainSources().some(isIdentityLine)) lines.push({ src: MIRROR_SRC, color: MIRROR_COLOR, mirror: true })
      const made: FittedCurve[] = []
      const models: Record<string, ModelSpec> = {}
      const sources: Record<string, string> = {}
      let mirror: FittedCurve | undefined
      for (const line of lines) {
        let outcome: ReturnType<typeof parseExpression>
        try {
          outcome = parseExpression(line.src)
        } catch {
          return
        }
        if (!outcome.ok) {
          showFeatureNote({ kind: 'moved', key: Date.now(), text: outcome.error })
          return
        }
        const modelId = `expr_${++exprCounterRef.current}`
        try {
          models[modelId] = outcome.plot.makeModel(modelId)
        } catch {
          return
        }
        const c: FittedCurve = {
          id: nextId(),
          modelId,
          params: outcome.plot.defaultParams.slice(),
          kind: outcome.plot.kind,
          domain: outcome.plot.domain,
          color: line.color,
          strokeWidth: 2.5,
          visible: true,
          error: 0,
        }
        made.push(c)
        if (line.mirror) mirror = c
        sources[c.id] = line.src
      }
      registerModels(models)
      commitState(
        {
          curves: [...curvesRef.current, ...made],
          exprSources: { ...exprSourcesRef.current, ...sources },
          ...(mirror
            ? {
                styles: {
                  ...stylesRef.current,
                  [mirror.id]: { ...stylesRef.current[mirror.id], dash: MIRROR_DASH.slice() },
                },
              }
            : {}),
        },
        'add inverse',
      )
      showFeatureNote({
        kind: 'moved',
        key: Date.now(),
        text: `Added ${formula.text}${mirror ? ' — and the line y = x' : ''}.`,
      })
    },
    [commitState, domainFactsFor, inverseFormulaFor, plainSources, registerModels, showFeatureNote],
  )

  /** The inverse link whose curve this is, if any. */
  const inverseLinkOf = useCallback(
    (curveId: string): InverseLink | undefined => inversesRef.current.find((l) => l.curveId === curveId),
    [],
  )

  const domainActions = useMemo<DomainActions>(
    () => ({
      onRestrict: (id, r) => {
        const err = restrictDomain(id, r)
        if (err) showFeatureNote({ kind: 'refused', key: Date.now(), reason: err })
        return err
      },
      onGhost: (id, on) => patchLensFor(id, { ghost: on }),
      onHlt: toggleHlt,
      onReflect: toggleReflect,
      onShowInverse: (id) => showInverseOf(id),
      onAddInverse: addInverseCurve,
      onNotation: changeSetNotation,
    }),
    [restrictDomain, showFeatureNote, patchLensFor, toggleHlt, toggleReflect, showInverseOf, addInverseCurve, changeSetNotation],
  )

  /**
   * Rename a curve from its card's name chip. Every line that calls the old
   * letter is rewritten to the new one — one commit, one undo, which takes
   * the letter and every rewritten line back together.
   */
  const renameCurve = useCallback(
    (id: string, letter: string): string | null => {
      const from = namesRef.current[id]
      {
        const clash = curveNameClash(letter.trim(), sequenceLetters(seqRef.current))
        if (clash) return clash
      }
      const st: NameState = {
        names: namesRef.current,
        exprSources: exprSourcesRef.current,
        displaySources: displaySourcesRef.current,
        calls: callsRef.current,
      }
      const plan = planRename(
        st,
        id,
        letter,
        sliderLetters(curvesRef.current, exprSourcesRef.current, modelsRef.current),
      )
      if ('error' in plan) return plan.error
      if (plan.state === st) return null
      const re = reparseLines(plan.rewritten, plan.state)
      if ('error' in re) return re.error
      registerModels(re.models)
      const to = letter.trim()
      commitState(
        {
          curves: re.apply(curvesRef.current),
          exprSources: plan.state.exprSources,
          displaySources: plan.state.displaySources,
          names: plan.state.names,
          calls: plan.state.calls,
        },
        from ? `rename ${from} to ${to}` : `name ${to}`,
      )
      const callers = plan.rewritten.filter((r) => r !== id).length
      if (from && callers > 0) {
        showFeatureNote({
          kind: 'moved',
          key: Date.now(),
          text: `Renamed ${from} to ${to} — ${callers === 1 ? 'the line' : `the ${callers} lines`} that used ${from} now ${callers === 1 ? 'says' : 'say'} ${to}.`,
        })
      }
      return null
    },
    [commitState, registerModels, reparseLines, showFeatureNote],
  )

  return {
    showInverse, showInverseOf, baseModelOf, domainFactsFor, restrictModeOf, inverseSourceOf,
    inverseFormulaFor, patchLensFor, toggleHlt, domainActions, renameCurve,
  }
}

export type DomainLensApi = ReturnType<typeof useDomainLens>
