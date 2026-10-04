// ============================================================================
// Which page "/" shows: the landing page, or the app.
//
// The app opens directly for `?app=1` (the landing page's buttons and the
// installed app's start_url) and for a share link (`#doc=…`, with or without
// `view=1`/`reveal=1` before it) — a student following a teacher's link must
// land on the graph, never on a marketing page.
// ============================================================================

import { parseShareHash } from '../core/share'

export function opensApp(search: string, hash: string): boolean {
  return new URLSearchParams(search).get('app') === '1' || parseShareHash(hash).kind === 'share'
}

/** The app's URL under this build's base path, with optional extra params. */
export function appHref(base: string, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams({ app: '1', ...extra })
  return `${base}?${params.toString()}`
}
