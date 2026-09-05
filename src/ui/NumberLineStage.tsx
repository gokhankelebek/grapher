import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { MutableRefObject } from 'react'
import type { NLItem, Theme, Vec2, Viewport } from '../core/types'
import type { StyleMap } from '../core/persist'
import {
  nlHitTest,
  nlSnapX,
  nlToMathX,
  numberLineAxisY,
} from '../render/numberline'
import type { NLPart } from '../render/numberline'
import { renderBoard } from './renderBoard'
import type { Mode } from '../App'

export interface NumberLineStageHandle {
  redraw(): void
}

interface Props {
  items: NLItem[]
  styles: StyleMap
  theme: Theme
  selectedId: string | null
  mode: Mode
  /** Colour a newly drawn item takes. */
  inkColor: string
  vpRef: MutableRefObject<Viewport>
  onSelect(id: string | null): void
  /** A click on the line: place a single point there. */
  onPlacePoint(x: number): void
  /** A drag along the line: make an interval between two values. */
  onCreateInterval(lo: number, hi: number): void
  /** Live endpoint move (inside an edit bracket). */
  onMoveEndpoint(id: string, part: NLPart, x: number): void
  /** A click on an endpoint: closed <-> open. */
  onToggleEnd(id: string, part: NLPart): void
  onEditStart(): void
  onEditEnd(): void
  onEditCancel(): void
  onViewportChange?(): void
}

const MIN_PPU = 0.001
const MAX_PPU = 100000
/** Vertical reach of "the line" for placing new items, in px. */
const LINE_BAND = 34
/** Movement below this is a click, not a drag. */
const CLICK_SLOP = 4

const clampPpu = (v: number): number => Math.min(MAX_PPU, Math.max(MIN_PPU, v))

type Gesture =
  | { type: 'pan'; pointerId: number; lastX: number; moved: number }
  | { type: 'draw'; pointerId: number; startX: number; startPx: number; moved: number }
  | {
      type: 'dragEnd'
      pointerId: number
      id: string
      part: NLPart
      /** Where the press landed, so "did it move?" is measured against a fixed
       *  point rather than against the endpoint, which is itself moving. */
      startPx: number
      moved: number
      started: boolean
    }
  | { type: 'pinch'; p1: number; p2: number; startDist: number; startPpu: number; startMid: number }

/**
 * The number-line board's pointer surface.
 *
 * It draws NOTHING itself: like CanvasStage it builds a scene and hands it to
 * renderBoard(), so the figure on screen and the figure in the exported PNG are
 * produced by the same code with `chrome` as the only difference. What lives
 * here is the gesture vocabulary, which is genuinely different from a graph's —
 * there is one axis, and the meaningful objects are endpoints.
 */
export const NumberLineStage = forwardRef<NumberLineStageHandle, Props>(
  function NumberLineStage(
    {
      items,
      styles,
      theme,
      selectedId,
      mode,
      inkColor,
      vpRef,
      onSelect,
      onPlacePoint,
      onCreateInterval,
      onMoveEndpoint,
      onToggleEnd,
      onEditStart,
      onEditEnd,
      onEditCancel,
      onViewportChange,
    },
    handle,
  ) {
    const wrapRef = useRef<HTMLDivElement>(null)
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const ctxRef = useRef<CanvasRenderingContext2D | null>(null)

    const itemsRef = useRef<NLItem[]>(items)
    const stylesRef = useRef<StyleMap>(styles)
    const themeRef = useRef<Theme>(theme)
    const selectedRef = useRef<string | null>(selectedId)
    const modeRef = useRef<Mode>(mode)
    const inkColorRef = useRef(inkColor)
    const gestureRef = useRef<Gesture | null>(null)
    const pendingRef = useRef<NLItem | null>(null)
    const activePartRef = useRef<{ itemId: string; part: NLPart } | null>(null)
    const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map())
    const spaceRef = useRef(false)
    const rafRef = useRef(0)
    const viewportChangeRef = useRef(onViewportChange)
    viewportChangeRef.current = onViewportChange

    const [cursor, setCursor] = useState('crosshair')

    // ------------------------------------------------------------- rendering
    const draw = useCallback((): void => {
      const canvas = canvasRef.current
      const ctx = ctxRef.current
      if (!canvas || !ctx) return
      const dpr = window.devicePixelRatio || 1
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      renderBoard(ctx, {
        vp: vpRef.current,
        theme: themeRef.current,
        kind: 'number-line',
        items: itemsRef.current,
        curves: [],
        styles: stylesRef.current,
        models: {},
        chrome: {
          selectedId: selectedRef.current,
          handles: [],
          activeHandleId: null,
          highlight: null,
          openIdx: null,
          hoverIdx: null,
          activePart: activePartRef.current,
          pending: pendingRef.current,
        },
      })
    }, [vpRef])

    const frame = useCallback((): void => {
      rafRef.current = 0
      draw()
    }, [draw])

    const scheduleRender = useCallback((): void => {
      if (!rafRef.current) rafRef.current = requestAnimationFrame(frame)
    }, [frame])

    useImperativeHandle(handle, () => ({ redraw: scheduleRender }), [scheduleRender])

    useEffect(() => {
      itemsRef.current = items
      stylesRef.current = styles
      themeRef.current = theme
      selectedRef.current = selectedId
      modeRef.current = mode
      inkColorRef.current = inkColor
      scheduleRender()
    }, [items, styles, theme, selectedId, mode, inkColor, scheduleRender])

    // ---------------------------------------------------------------- sizing
    useEffect(() => {
      const wrap = wrapRef.current
      const canvas = canvasRef.current
      if (!wrap || !canvas) return
      ctxRef.current = canvas.getContext('2d')
      const resize = (): void => {
        const rect = wrap.getBoundingClientRect()
        const dpr = window.devicePixelRatio || 1
        const w = Math.max(1, Math.round(rect.width))
        const h = Math.max(1, Math.round(rect.height))
        canvas.width = Math.round(w * dpr)
        canvas.height = Math.round(h * dpr)
        canvas.style.width = `${w}px`
        canvas.style.height = `${h}px`
        vpRef.current.widthPx = w
        vpRef.current.heightPx = h
        scheduleRender()
      }
      resize()
      const ro = new ResizeObserver(resize)
      ro.observe(wrap)
      return () => {
        ro.disconnect()
        if (rafRef.current) cancelAnimationFrame(rafRef.current)
        rafRef.current = 0
      }
    }, [scheduleRender, vpRef])

    // --------------------------------------------------------- space-to-pan
    useEffect(() => {
      const consumes = (t: HTMLElement | null): boolean =>
        !!t &&
        (t.isContentEditable ||
          t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.tagName === 'BUTTON' ||
          t.tagName === 'SELECT' ||
          t.tagName === 'A')
      const down = (e: KeyboardEvent): void => {
        if (e.code !== 'Space' || consumes(e.target as HTMLElement | null)) return
        e.preventDefault()
        spaceRef.current = true
      }
      const release = (): void => {
        spaceRef.current = false
      }
      window.addEventListener('keydown', down)
      window.addEventListener('keyup', release)
      window.addEventListener('blur', release)
      return () => {
        window.removeEventListener('keydown', down)
        window.removeEventListener('keyup', release)
        window.removeEventListener('blur', release)
      }
    }, [])

    // ----------------------------------------------------------------- wheel
    useEffect(() => {
      const canvas = canvasRef.current
      if (!canvas) return
      const onWheel = (e: WheelEvent): void => {
        e.preventDefault()
        const vp = vpRef.current
        const rect = canvas.getBoundingClientRect()
        const px = e.clientX - rect.left
        const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.012 : 0.0018))
        const anchor = nlToMathX(px, vp)
        vp.pxPerUnit = clampPpu(vp.pxPerUnit * factor)
        // Zoom about the pointer, in x only — a number line has no other axis.
        vp.center = { x: anchor - (px - vp.widthPx / 2) / vp.pxPerUnit, y: 0 }
        viewportChangeRef.current?.()
        scheduleRender()
      }
      canvas.addEventListener('wheel', onWheel, { passive: false })
      return () => canvas.removeEventListener('wheel', onWheel)
    }, [scheduleRender, vpRef])

    // -------------------------------------------------------- pointer events
    const getPos = (e: React.PointerEvent): Vec2 => {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
      return { x: e.clientX - rect.left, y: e.clientY - rect.top }
    }

    const snap = (px: number, alt: boolean): number => {
      const vp = vpRef.current
      const x = nlToMathX(px, vp)
      return alt ? x : nlSnapX(x, vp)
    }

    const endGesture = (cancelled: boolean, pos: Vec2, alt: boolean): void => {
      const g = gestureRef.current
      gestureRef.current = null
      activePartRef.current = null
      const pending = pendingRef.current
      pendingRef.current = null

      if (!g) return
      if (g.type === 'pan' || g.type === 'pinch') {
        scheduleRender()
        return
      }

      if (g.type === 'dragEnd') {
        if (cancelled) {
          onEditCancel()
        } else if (g.moved < CLICK_SLOP) {
          // A press that did not move is a statement about the endpoint, not a
          // move of it: closed <-> open, the one thing this figure is for.
          if (g.started) onEditCancel()
          onToggleEnd(g.id, g.part)
        } else {
          onEditEnd()
        }
        scheduleRender()
        return
      }

      // g.type === 'draw'
      if (cancelled) {
        scheduleRender()
        return
      }
      if (g.moved < CLICK_SLOP) {
        const hit = nlHitTest(itemsRef.current, vpRef.current, pos)
        if (hit) onSelect(hit.id)
        else if (Math.abs(pos.y - numberLineAxisY(vpRef.current)) <= LINE_BAND) {
          onPlacePoint(g.startX)
        } else onSelect(null)
        scheduleRender()
        return
      }
      const endX = snap(pos.x, alt)
      if (pending && Math.abs(endX - g.startX) * vpRef.current.pxPerUnit >= CLICK_SLOP) {
        onCreateInterval(Math.min(g.startX, endX), Math.max(g.startX, endX))
      } else {
        onPlacePoint(g.startX)
      }
      scheduleRender()
    }

    const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>): void => {
      const canvas = e.currentTarget
      try {
        canvas.setPointerCapture(e.pointerId)
      } catch {
        /* best effort */
      }
      const pos = getPos(e)
      pointersRef.current.set(e.pointerId, pos)

      if (pointersRef.current.size >= 2) {
        const entries = [...pointersRef.current.entries()]
        const [p1, a] = entries[0]
        const [p2, b] = entries[1]
        gestureRef.current = {
          type: 'pinch',
          p1,
          p2,
          startDist: Math.max(1, Math.abs(b.x - a.x)),
          startPpu: vpRef.current.pxPerUnit,
          startMid: nlToMathX((a.x + b.x) / 2, vpRef.current),
        }
        return
      }

      const panning = e.button !== 0 || spaceRef.current || modeRef.current === 'pan'
      if (!panning) {
        const hit = nlHitTest(itemsRef.current, vpRef.current, pos)
        if (hit && hit.part !== 'body') {
          onSelect(hit.id)
          activePartRef.current = { itemId: hit.id, part: hit.part }
          gestureRef.current = {
            type: 'dragEnd',
            pointerId: e.pointerId,
            id: hit.id,
            part: hit.part,
            startPx: pos.x,
            moved: 0,
            started: false,
          }
          scheduleRender()
          return
        }
        if (hit || Math.abs(pos.y - numberLineAxisY(vpRef.current)) <= LINE_BAND) {
          gestureRef.current = {
            type: 'draw',
            pointerId: e.pointerId,
            startX: snap(pos.x, e.altKey),
            startPx: pos.x,
            moved: 0,
          }
          scheduleRender()
          return
        }
      }

      gestureRef.current = { type: 'pan', pointerId: e.pointerId, lastX: pos.x, moved: 0 }
    }

    const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>): void => {
      const pos = getPos(e)
      const vp = vpRef.current
      const g = gestureRef.current

      if (!g) {
        // Idle hover: say what the pointer would do here.
        const hit = nlHitTest(itemsRef.current, vp, pos)
        const onLine = Math.abs(pos.y - numberLineAxisY(vp)) <= LINE_BAND
        setCursor(
          modeRef.current === 'pan' || spaceRef.current
            ? 'grab'
            : hit && hit.part !== 'body'
              ? 'ew-resize'
              : hit
                ? 'pointer'
                : onLine
                  ? 'crosshair'
                  : 'default',
        )
        return
      }
      pointersRef.current.set(e.pointerId, pos)

      if (g.type === 'pan' && g.pointerId === e.pointerId) {
        const dx = pos.x - g.lastX
        g.moved += Math.abs(dx)
        g.lastX = pos.x
        vp.center = { x: vp.center.x - dx / vp.pxPerUnit, y: 0 }
        viewportChangeRef.current?.()
        scheduleRender()
      } else if (g.type === 'pinch') {
        const a = pointersRef.current.get(g.p1)
        const b = pointersRef.current.get(g.p2)
        if (!a || !b) return
        const dist = Math.max(1, Math.abs(b.x - a.x))
        const ppu = clampPpu((g.startPpu * dist) / g.startDist)
        vp.pxPerUnit = ppu
        vp.center = { x: g.startMid - ((a.x + b.x) / 2 - vp.widthPx / 2) / ppu, y: 0 }
        viewportChangeRef.current?.()
        scheduleRender()
      } else if (g.type === 'draw' && g.pointerId === e.pointerId) {
        const travelled = Math.abs(pos.x - g.startPx)
        g.moved = Math.max(g.moved, travelled)
        if (travelled >= CLICK_SLOP) {
          const x = snap(pos.x, e.altKey)
          const lo = Math.min(g.startX, x)
          const hi = Math.max(g.startX, x)
          // Chrome only: the interval exists as a promise until the pointer is
          // released, so an abandoned drag leaves nothing behind.
          pendingRef.current = {
            kind: 'interval',
            id: '__pending__',
            lo,
            hi,
            loClosed: true,
            hiClosed: true,
            color: inkColorRef.current,
          }
        } else {
          pendingRef.current = null
        }
        scheduleRender()
      } else if (g.type === 'dragEnd' && g.pointerId === e.pointerId) {
        g.moved = Math.max(g.moved, Math.abs(pos.x - g.startPx))
        if (g.moved >= CLICK_SLOP) {
          if (!g.started) {
            g.started = true
            onEditStart()
          }
          onMoveEndpoint(g.id, g.part, snap(pos.x, e.altKey))
        }
        scheduleRender()
      }
    }

    const endPointer = (e: React.PointerEvent<HTMLCanvasElement>, cancelled: boolean): void => {
      const pos = getPos(e)
      pointersRef.current.delete(e.pointerId)
      const g = gestureRef.current
      if (g && g.type === 'pinch') {
        if (e.pointerId === g.p1 || e.pointerId === g.p2) gestureRef.current = null
        return
      }
      if (!g || g.pointerId !== e.pointerId) return
      endGesture(cancelled, pos, e.altKey)
    }

    return (
      <div ref={wrapRef} className="stage">
        <canvas
          ref={canvasRef}
          className="stage-canvas"
          style={{ cursor }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={(e) => endPointer(e, false)}
          onPointerCancel={(e) => endPointer(e, true)}
          onLostPointerCapture={(e) => {
            if (gestureRef.current) endPointer(e, true)
          }}
          onContextMenu={(e) => e.preventDefault()}
        />
      </div>
    )
  },
)
