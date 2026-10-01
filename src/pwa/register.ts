// ============================================================================
// Register the service worker (public/sw.js) — production builds only.
//
// In dev a worker would cache Vite's modules and fight HMR, so it is never
// registered there. The URL and scope come from the build's base path
// (import.meta.env.BASE_URL: '/' normally, '/grapher/' on GitHub Pages).
// ============================================================================

import { swRegistration } from './build'

export function registerServiceWorker(): void {
  if (!import.meta.env.PROD) return
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  const { url, scope } = swRegistration(import.meta.env.BASE_URL)
  const go = (): void => {
    navigator.serviceWorker.register(url, { scope }).catch(() => {
      // No worker (a private window, a file:// open, a blocked origin): the
      // app still works online, it just will not open offline.
    })
  }
  if (document.readyState === 'complete') go()
  else window.addEventListener('load', go, { once: true })
}
