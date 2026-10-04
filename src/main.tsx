import ReactDOM from 'react-dom/client'
import { Component, lazy, Suspense } from 'react'
import type { ReactNode } from 'react'
import Landing from './platform/Landing'
import { opensApp } from './platform/route'
import { BRAND } from './brand'
import { registerServiceWorker } from './pwa/register'

// The app is its own chunk: "/" downloads only the landing page. `?app=1` and
// share links (#doc=…) skip the landing page and open the app directly.
const App = lazy(() => import('./platform/Workspace'))

const shell = { padding: 32, color: '#9aa1bd', background: '#0f1117', minHeight: '100vh', fontFamily: 'system-ui, sans-serif' }

/** A chunk that fails to download (a dropped school Wi-Fi) gets a way back, not a blank page. */
class LoadFailed extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }
  render(): ReactNode {
    if (!this.state.failed) return this.props.children
    return (
      <div style={shell} role="alert">
        <p>
          {BRAND} could not finish loading. Check the connection, then{' '}
          <button type="button" onClick={() => window.location.reload()} style={{ color: '#5aa3fa', background: 'none', border: 0, font: 'inherit', textDecoration: 'underline', cursor: 'pointer' }}>
            reload
          </button>
          .
        </p>
      </div>
    )
  }
}

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('Missing #root element')

ReactDOM.createRoot(rootEl).render(
  opensApp(window.location.search, window.location.hash) ? (
    <LoadFailed>
      <Suspense fallback={<div style={shell}>Opening {BRAND}…</div>}>
        <App />
      </Suspense>
    </LoadFailed>
  ) : (
    <Landing />
  ),
)
registerServiceWorker()
