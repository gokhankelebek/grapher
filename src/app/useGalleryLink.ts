// ============================================================================
// src/app/useGalleryLink.ts — `?app=1&gallery=1` opens the examples gallery.
//
// The landing page's "Open an AP example" button links here. Opening the
// gallery is the ONLY effect: no document is created, opened or changed until
// the teacher picks an example (useExamples.openExample does that, as from the
// menu). The `gallery` parameter is then dropped from the address bar, so a
// reload or a bookmark of the page does not reopen it. A share link (#doc=…)
// wins: it is never covered by the gallery.
//
// The link is the landing page's AP door, so a teacher who never told the app
// what they teach (no Prefs.courses) sees the gallery filtered to AP Calculus
// and AP Precalculus (src/ui/courses.ts galleryDefaultCourses). That is the
// gallery's opening filter only — "All courses" is one click — and it is NOT
// stored as their course choice. Opened again later from the menu, the
// gallery shows every course as before.
// ============================================================================

import { useEffect, useRef, useState } from 'react'
import { parseShareHash } from '../core/share'

/** Does this URL ask for the gallery? Pure. */
export function wantsGallery(search: string, hash: string): boolean {
  return new URLSearchParams(search).get('gallery') === '1' && parseShareHash(hash).kind !== 'share'
}

/** The same URL without the `gallery` parameter. Pure. */
export function withoutGalleryParam(href: string): string {
  const url = new URL(href)
  url.searchParams.delete('gallery')
  return url.href
}

/**
 * Opens the gallery for a `?gallery=1` link. Returns whether the gallery that
 * is open now was opened BY the link (true until it closes).
 */
export function useGalleryLink(openGallery: () => void, galleryOpen = false): boolean {
  const [fromLink, setFromLink] = useState(false)
  useEffect(() => {
    const { search, hash, href } = window.location
    if (!wantsGallery(search, hash)) return
    try {
      window.history.replaceState(window.history.state, '', withoutGalleryParam(href))
    } catch {
      // A sandboxed frame can refuse; the gallery still opens.
    }
    setFromLink(true)
    openGallery()
    // Once, on mount: the URL is read when the app opens.
  }, [])
  // Closed once (after it was seen open): the link's filter is spent.
  const seenOpen = useRef(false)
  useEffect(() => {
    if (galleryOpen) seenOpen.current = true
    else if (seenOpen.current) setFromLink(false)
  }, [galleryOpen])
  return fromLink
}
