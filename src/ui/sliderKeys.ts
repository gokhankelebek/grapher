// ============================================================================
// src/ui/sliderKeys.ts — Shift + arrow on any slider takes a big step.
//
// The app's sliders are native <input type="range">: arrows already move one
// step, Home / End jump to the ends, Page Up / Down move a tenth. Shift +
// arrow is what people try for "faster", and no browser does it — so one
// listener, for every slider in the app, moves ten steps at a time and lets
// React see the change exactly as if the person had dragged.
// ============================================================================

import { useEffect } from 'react'

/** How many steps Shift + arrow moves. */
export const BIG_STEPS = 10

/** The value Shift + arrow lands on: ten steps, on the step grid, inside [min, max]. Pure. */
export function bigStep(value: number, min: number, max: number, step: number, dir: 1 | -1): number {
  const s = Number.isFinite(step) && step > 0 ? step : (max - min) / 100
  const raw = value + dir * BIG_STEPS * s
  const snapped = min + Math.round((raw - min) / s) * s
  const clamped = Math.min(max, Math.max(min, snapped))
  // Keep the step's own precision: 0.1 * 10 must not come out as 0.9999999.
  const digits = Math.max(0, Math.min(10, -Math.floor(Math.log10(s)) + 1))
  return Number(clamped.toFixed(digits))
}

const DIRS: Record<string, 1 | -1> = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }

/** Install the Shift + arrow rule for every range input in the document. */
export function useSliderShiftSteps(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target
      if (!(t instanceof HTMLInputElement) || t.type !== 'range') return
      const dir = DIRS[e.key]
      if (!dir || !e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return
      const min = Number(t.min || 0)
      const max = Number(t.max || 100)
      const step = t.step === 'any' ? (max - min) / 100 : Number(t.step || 1)
      const next = bigStep(Number(t.value), min, max, step, dir)
      if (String(next) === t.value) return
      e.preventDefault()
      // The native setter, then an input event: React's onChange fires as if
      // the thumb had been dragged there. The key events themselves still
      // reach the slider's own handlers (an edit bracket opens and closes).
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(t, String(next))
      t.dispatchEvent(new Event('input', { bubbles: true }))
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [])
}
