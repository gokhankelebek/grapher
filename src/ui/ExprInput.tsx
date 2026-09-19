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
}

/** Inline equation-entry card ("+" in the sidebar). Enter submits, Esc closes;
 *  stays open after a successful submit for rapid multi-entry. */
export function ExprInput({ onSubmit, onClose, placeholder }: Props) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

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
      {error && <div className="expr-error">{error}</div>}
    </div>
  )
}
