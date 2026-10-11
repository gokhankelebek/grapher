// ============================================================================
// src/app/useGalleryLink.ts — `?app=1&gallery=1` opens the examples gallery.
//
// The landing page's two example buttons link here: "Open an AP example"
// (`?app=1&gallery=1`) and "Open an NC Math example" (`…&course=nc`).
// Opening the gallery is the ONLY effect: no document is created, opened or
// changed until the teacher picks an example (useExamples.openExample does
// that, as from the menu). The `gallery` and `course` parameters are then
// dropped from the address bar, so a reload or a bookmark of the page does
// not reopen it. A share link (#doc=…)
// wins: it is never covered by the gallery.
//
// Whatever the teacher told the app they teach, a link opens the gallery
// filtered by the door they came through (the button names it): AP Calculus and AP
// Precalculus without a `course` parameter, NC Math 1, 2 and 3 for
// `course=nc` (src/ui/courses.ts galleryDefaultCourses). That is the
// gallery's opening filter only — "All courses" is one click — and it is NOT
// stored as their course choice. Opened later from the menu, the gallery
// shows the teacher's own courses, or every course if they chose none.
// ============================================================================

import { useEffect, useRef, useState } from 'react'
import { parseShareHash } from '../core/share'
import type { GalleryDoor } from '../ui/courses'

/** Does this URL ask for the gallery? Pure. */
export function wantsGallery(search: string, hash: string): boolean {
  return new URLSearchParams(search).get('gallery') === '1' && parseShareHash(hash).kind !== 'share'
}

/** Which door a gallery link came through: `course=nc` is NC Math, anything else AP. Pure. */
export function galleryDoor(search: string): GalleryDoor {
  return new URLSearchParams(search).get('course') === 'nc' ? 'nc' : 'ap'
}

/** The same URL without the `gallery` parameter (and the `course` that goes with it). Pure. */
export function withoutGalleryParam(href: string): string {
  const url = new URL(href)
  url.searchParams.delete('gallery')
  url.searchParams.delete('course')
  return url.href
}

/**
 * Opens the gallery for a `?gallery=1` link. Returns the door the gallery
 * that is open now was opened through BY the link (null once it closes, and
 * for a gallery opened from the menu).
 */
export function useGalleryLink(openGallery: () => void, galleryOpen = false): GalleryDoor | null {
  const [fromLink, setFromLink] = useState<GalleryDoor | null>(null)
  useEffect(() => {
    const { search, hash, href } = window.location
    if (!wantsGallery(search, hash)) return
    try {
      window.history.replaceState(window.history.state, '', withoutGalleryParam(href))
    } catch {
      // A sandboxed frame can refuse; the gallery still opens.
    }
    setFromLink(galleryDoor(search))
    openGallery()
    // Once, on mount: the URL is read when the app opens.
  }, [])
  // Closed once (after it was seen open): the link's filter is spent.
  const seenOpen = useRef(false)
  useEffect(() => {
    if (galleryOpen) seenOpen.current = true
    else if (seenOpen.current) setFromLink(null)
  }, [galleryOpen])
  return fromLink
}
