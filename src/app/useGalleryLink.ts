// ============================================================================
// src/app/useGalleryLink.ts — `?app=1&gallery=1` opens the examples gallery.
//
// The landing page's "Open an AP example" button links here. Opening the
// gallery is the ONLY effect: no document is created, opened or changed until
// the teacher picks an example (useExamples.openExample does that, as from the
// menu). The `gallery` parameter is then dropped from the address bar, so a
// reload or a bookmark of the page does not reopen it. A share link (#doc=…)
// wins: it is never covered by the gallery.
// ============================================================================

import { useEffect } from 'react'
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

export function useGalleryLink(openGallery: () => void): void {
  useEffect(() => {
    const { search, hash, href } = window.location
    if (!wantsGallery(search, hash)) return
    try {
      window.history.replaceState(window.history.state, '', withoutGalleryParam(href))
    } catch {
      // A sandboxed frame can refuse; the gallery still opens.
    }
    openGallery()
    // Once, on mount: the URL is read when the app opens.
  }, [])
}
