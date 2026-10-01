import { useEffect, useRef, useState } from 'react'

interface Props {
  /** Returns an error message to display, or null on success. */
  onSubmit(src: string): string | null
  onClose(): void
  /**
   * What this board actually accepts. A number line takes inequalities, not
   * equations, so the same card has to be able to say so — an example a
   * teacher can copy is the whole documentation most people will read, and it
   * belongs IN the field rather than in a line of prose underneath it.
   */
  placeholder?: string
  /**
   * The board's function names (f, g, h). Offered as chips while typing: a
   * click puts `f(x)` in at the caret, which is how a teacher discovers that
   * `g(x) = 2f(x − 1) + 3` is a thing this box understands.
   */
  names?: readonly string[]
  /**
   * Text to start with, caret at its end — "dy/dx = " when the command
   * palette's "Slope field" opened the box. Read once, at mount.
   */
  initial?: string
}

/** Inline equation-entry card ("+" in the sidebar). Enter submits, Esc closes;
 *  stays open after a successful submit for rapid multi-entry. */
export function ExprInput({ onSubmit, onClose, placeholder, names, initial }: Props) {
  const [text, setText] = useState(initial ?? '')
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const el = inputRef.current
    el?.focus()
    const at = el?.value.length ?? 0
    el?.setSelectionRange(at, at)
  }, [])

  /** `f(x)` at the caret (over any selection), caret left after it. */
  const insertCall = (n: string): void => {
    const el = inputRef.current
    const piece = `${n}(x)`
    const start = el?.selectionStart ?? text.length
    const end = el?.selectionEnd ?? text.length
    const next = text.slice(0, start) + piece + text.slice(end)
    setText(next)
    if (error) setError(null)
    requestAnimationFrame(() => {
      const at = start + piece.length
      el?.focus()
      el?.setSelectionRange(at, at)
    })
  }

  const submit = (): void => {
    const src = text.trim()
    if (!src) return
    const err = onSubmit(src)
    if (err) {
      setError(err)
    } else {
      setText('')
      setError(null)
      inputRef.current?.focus()
    }
  }

  return (
    <div className="expr-card">
      <input
        ref={inputRef}
        className={`expr-input${error ? ' expr-input-bad' : ''}`}
        type="text"
        spellCheck={false}
        autoComplete="off"
        placeholder={placeholder ?? 'y = 2sin(3x) + 1'}
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          if (error) setError(null)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            submit()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            onClose()
          }
        }}
      />
      {names && names.length > 0 && (
        <div className="expr-names" role="group" aria-label="Use a function on this board">
          {names.map((n) => (
            <button
              key={n}
              type="button"
              className="expr-name-chip"
              title={`Insert ${n}(x)`}
              // Keep the caret: a mousedown on a button would blur the field.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => insertCall(n)}
            >
              {n}
            </button>
          ))}
        </div>
      )}
      {error && <div className="expr-error">{error}</div>}
    </div>
  )
}
