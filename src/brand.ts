// ============================================================================
// The product's name and its one-line story — the ONE place the landing page
// reads them from. The name may change before launch: change it here.
//
// Not yet wired to this file (plain text elsewhere; change them by hand):
// index.html (<title>, apple-mobile-web-app-title), public/manifest.webmanifest
// (name, short_name), the app's toolbar and exports, the service worker's cache
// prefix and the README. See the landing-page report for the full list.
//
// Dependency-free on purpose: the landing chunk imports it, and it must stay
// tiny and never pull the app in.
// ============================================================================

/** The product name, as a reader sees it. */
export const BRAND = 'Grapher'

/** The headline: what the product does, in four words. */
export const TAGLINE = 'Sketch it. Get the math.'

/** The promise, for the trust line. Keep it literally true (see the report). */
export const TRUST_LINE = 'Free for teachers. No account. Nothing leaves your device.'

/** Where the source lives. */
export const REPO_URL = 'https://github.com/gokhankelebek/grapher'

/** Where feedback goes while FEEDBACK_URL is empty: the public issue tracker. */
export const ISSUES_URL = `${REPO_URL}/issues`

/**
 * TODO(feedback): a mailto: or form URL for teacher feedback. Empty until the
 * address is chosen; the footer shows the link only once this is set.
 */
export const FEEDBACK_URL = ''

/**
 * The privacy details, said the same way on the landing page's footer and in
 * the app's About dialog. Keep it literally true.
 */
export const PRIVACY_LINE = `${BRAND} has no accounts, no analytics, no cookies and no third-party scripts or fonts. Your work is stored only in this browser. The site is served as static files by GitHub Pages.`
