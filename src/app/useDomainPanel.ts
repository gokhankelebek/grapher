// ============================================================================
// src/app/useDomainPanel.ts — the selected card's Domain rows.
//
// Called once per render by App (src/App.tsx), in sequence with the other
// src/app hooks. The order of those calls is the order of every useState, ref,
// memo and effect on the board, so a new hook goes where its inputs exist.
// ============================================================================

import { useCallback, useMemo } from 'react'
import { levelCrossings } from '../core/domainRange'
import {
  hltVerdict,
  inVariable,
  inverseCurveLine,
  oneToOneChips,
  singleProperInterval,
} from '../ui/domainLinks'
import type { DomainPanel, InversePanel } from '../ui/domainLinks'
import { inverseSources } from '../ui/logLinks'
import type { BoardStateApi } from './useBoardState'
import type { DocumentStateApi } from './useDocumentState'
import type { BoardRefsApi } from './useBoardRefs'
import type { ModelsApi } from './useModels'
import type { CalcLinksApi } from './useCalcLinks'
import type { DomainLensApi } from './useDomainLens'
import type { CurveNamesApi } from './useCurveNames'

/** What useDomainPanel reads from the hooks App calls before it. */
export interface DomainPanelDeps {
  board: BoardStateApi
  docState: DocumentStateApi
  refs: BoardRefsApi
  derived: ModelsApi
  calc: CalcLinksApi
  domain: DomainLensApi
  naming: CurveNamesApi
}

export function useDomainPanel({ board, docState, refs, derived, calc, domain, naming }: DomainPanelDeps) {
  const { curves, kind, selectedId, logOpen, lens, historyTick } = board
  const { exprSources, names, inverses } = docState
  const { preEditRef } = refs
  const { models, depKeys } = derived
  const { crossSpan } = calc
  const { domainFactsFor, restrictModeOf, inverseFormulaFor } = domain
  const { boardCurveNames } = naming

  // ------------------------------------------------ the selected card's Domain rows
  //
  // Only the selected card is asked (the rows live in its open body), and
  // only when a value it depends on changes: the facts are cached per curve
  // on the analysis's own value key (domainFactsFor), so a hover, a toast or
  // a pan re-renders the card without recomputing a single set.
  const domainPanel = useMemo<DomainPanel | undefined>(() => {
    if (kind !== 'cartesian' || !selectedId) return undefined
    const link = inverses.find((l) => l.curveId === selectedId)
    const owner = curves.find((c) => c.id === (link ? link.parentId : selectedId))
    if (!owner || owner.kind !== 'explicit') return undefined
    // A gesture in flight (an edit bracket is open): keep the last answer.
    const facts = domainFactsFor(owner, preEditRef.current !== null)
    const name = boardCurveNames[owner.id] ?? names[owner.id] ?? 'f'
    const formula = inverseFormulaFor(owner, facts, name)
    const shown = inverses.some((l) => l.parentId === owner.id)
    const inverse: InversePanel = {
      latex: formula ? formula.latex : null,
      text: formula ? formula.text : null,
      branch: formula ? formula.branch : null,
      why: formula
        ? null
        : facts.one && !facts.one.oneToOne
          ? `${name} isn\u2019t one-to-one \u2014 restrict its domain first`
          : 'No formula for this inverse \u2014 it is still drawn by reflection',
      addLine: formula ? inverseCurveLine(formula.source, facts.range) : null,
      shown,
    }
    if (link) {
      return {
        role: 'inverse',
        ownerId: owner.id,
        name: `${name}\u207b\u00b9`,
        domain: inVariable(facts.range, 'x'),
        range: inVariable(facts.domain, 'y'),
        oneToOne: null,
        restrict: { kind: 'none', why: `Restrict ${name} instead — ${name}\u207b\u00b9 follows it.` },
        current: null,
        restricted: false,
        chips: [],
        ghost: false,
        hlt: null,
        reflect: false,
        inverse,
      }
    }
    const restrict = restrictModeOf(owner)
    const l = lens[owner.id]
    let current = null as DomainPanel['current']
    let restricted = false
    if (restrict.kind === 'typed' && restrict.cond !== null) {
      restricted = true
      current = singleProperInterval(facts.domain)
    } else if (restrict.kind === 'sketch' && owner.domain) {
      restricted = true
      const lo = Math.min(owner.domain[0], owner.domain[1])
      const hi = Math.max(owner.domain[0], owner.domain[1])
      current = { lo, hi, loClosed: true, hiClosed: true, loExact: null, hiExact: null }
    }
    let hlt: DomainPanel['hlt'] = null
    if (l?.hlt !== undefined) {
      let xs: number[] = []
      try {
        xs = levelCrossings(owner, models, l.hlt, crossSpan)
      } catch {
        xs = []
      }
      hlt = { y: l.hlt, verdict: hltVerdict(xs) }
    }
    return {
      role: 'function',
      ownerId: owner.id,
      name,
      domain: facts.domain,
      range: facts.range,
      oneToOne: facts.one,
      restrict,
      current,
      restricted,
      chips: oneToOneChips(facts.one),
      ghost: l?.ghost === true,
      hlt,
      reflect: l?.reflect !== undefined,
      inverse,
    }
    // The facts are keyed on values, so these say WHEN to ask; historyTick
    // is the end of a gesture (a committed drag), when stale facts refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, selectedId, inverses, curves, models, exprSources, depKeys, boardCurveNames, names, lens, crossSpan, domainFactsFor, inverseFormulaFor, restrictModeOf, historyTick])
  const domainPanelFor = useCallback(
    (id: string): DomainPanel | undefined => {
      if (!domainPanel || id !== selectedId) return undefined
      // An inequality is a REGION: its boundary's domain, range, one-to-one
      // and inverse would describe a function the line is not.
      const c = curves.find((k) => k.id === id)
      if (c && typeof models[c.modelId]?.inequality === 'function') return undefined
      return domainPanel
    },
    [domainPanel, selectedId, curves, models],
  )

  /** The exponentials "Build ▾ → Logarithmic → Inverse of…" can pick, named. */
  const logInverseSources = useMemo(
    () => (logOpen ? inverseSources(curves, exprSources, boardCurveNames) : []),
    [logOpen, curves, exprSources, boardCurveNames],
  )

  return {
    domainPanel, domainPanelFor, logInverseSources,
  }
}

export type DomainPanelApi = ReturnType<typeof useDomainPanel>
