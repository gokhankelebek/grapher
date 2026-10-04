// The app, as main.tsx lazy-loads it: the committed App with its own (dark)
// styles. Nothing here may restyle the workspace; figure styles are export-only.
import App from '../App'
import 'katex/dist/katex.min.css'
import '../ui/styles.css'
import '../ui/focus.css'
export default App
