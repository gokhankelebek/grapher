// ============================================================================
// src/ui/valueKeys.ts — memo keys made of VALUES, never of object identity.
//
// The board's dear derived values (special points, crossings) are memoised on
// a string that says what they depend on. `models` — the id → ModelSpec map —
// is NOT one of those things as a whole: it is a new object whenever ANY model
// is (re)registered, and a Taylor polynomial's model is re-registered on every
// frame its parent's slider moves. Keyed on `models`, one slider step used to
// re-analyse every curve on the board, twice (once for the new params, once
// more when the Taylor model landed a render later). Keyed on the curve's OWN
// spec — specSerial, a number per ModelSpec object — only the curves whose
// formula actually changed are redone.
// ============================================================================

import type { FittedCurve, ModelSpec } from '../core/types'
import { specSerial } from './calcLinks'

/** "This curve's formula", as a number: changes only when its own ModelSpec object does. */
export function curveSpecSerial(curve: FittedCurve, models: Readonly<Record<string, ModelSpec>>): number {
  return specSerial(models[curve.modelId])
}

/**
 * Everything one curve's special points depend on: id, model and that model's
 * identity, params, domain, and the curves it calls (`dep`, nameLinks'
 * dependencyKeys — which carry THEIR spec identities too).
 */
export function curveValueKey(
  curve: FittedCurve,
  models: Readonly<Record<string, ModelSpec>>,
  dep?: string,
): string {
  return `${curve.id}|${curve.modelId}#${curveSpecSerial(curve, models)}|${curve.params.join(',')}|${
    curve.domain ? curve.domain.join(',') : ''
  }|${dep ?? ''}`
}

/**
 * `next`, unless it holds exactly the same entries as `prev` — then `prev`
 * itself, so a memo downstream of a rebuilt-but-equal record does not re-run.
 */
export function sameRecordOr<T extends Readonly<Record<string, string>>>(prev: T | null, next: T): T {
  if (!prev) return next
  const a = Object.keys(prev)
  const b = Object.keys(next)
  if (a.length !== b.length) return next
  for (const k of b) if (prev[k] !== next[k]) return next
  return prev
}

/**
 * The models a curve's CARD reads: its own curve's (spec identity) and its
 * alternative fits' (by name only, library families). While this is the same,
 * the card can keep the models map it last rendered with.
 */
export function cardModelsKey(
  curve: FittedCurve,
  models: Readonly<Record<string, ModelSpec>>,
  candidates: readonly { modelId: string }[] = [],
): string {
  let key = `${curve.modelId}#${curveSpecSerial(curve, models)}`
  for (const c of candidates) key += `|${c.modelId}#${specSerial(models[c.modelId])}`
  return key
}
