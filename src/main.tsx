import ReactDOM from 'react-dom/client'
import App from './App'
import 'katex/dist/katex.min.css'
import './ui/styles.css'

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('Missing #root element')

ReactDOM.createRoot(rootEl).render(<App />)
