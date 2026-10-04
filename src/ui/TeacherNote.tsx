// ============================================================================
// src/ui/TeacherNote.tsx — the teacher note at the top of the sidebar.
//
// An opened example carries a note (StoredBoard.note): what to show, what to
// ask the class. It shows as a card above the curves, never folded when a
// document opens. "Hide note" folds it to ONE line (the note's first words and
// "Show note") for the rest of the session, per document — the note stays in
// the document. On a short screen (an iPad, a Chromebook) a long note scrolls
// inside its card instead of taking half the sidebar. A document without a
// note shows nothing at all.
//
// REVEAL MODE. A note states the answers ("L₄ = … = 68.5"), so while Reveal is
// on it folds by itself — to a line that names no words of it ("hidden while
// revealing"), not even the first ones. The teacher can still unfold it on
// purpose; when Reveal turns off the note is as it was before (useNoteFold).
// In Present the sidebar, and the note with it, is hidden anyway.
// ============================================================================

interface Props {
  note: string
  folded: boolean
  onFold(folded: boolean): void
  /** Reveal mode is on: the folded line shows none of the note's words. */
  revealing?: boolean
}

/**
 * Is the note folded right now? Outside reveal mode: the teacher's own
 * choice (`stored`). In reveal mode: folded, unless the teacher unfolded it
 * deliberately since Reveal came on (`openedWhileRevealing`). Pure.
 */
export function noteFoldedNow(stored: boolean, revealing: boolean, openedWhileRevealing: boolean): boolean {
  return revealing ? !openedWhileRevealing : stored
}

export function TeacherNote({ note, folded, onFold, revealing = false }: Props) {
  if (note === '') return null
  if (folded) {
    return (
      <button
        type="button"
        className={`tnote tnote-line${revealing ? ' tnote-revealing' : ''}`}
        data-testid="teacher-note-chip"
        aria-expanded={false}
        onClick={() => onFold(false)}
        title={revealing ? 'Show the teacher note (it states the answers)' : 'Show the teacher note'}
      >
        <NoteGlyph />
        <span className="tnote-title">Teacher note</span>
        {revealing ? (
          <span className="tnote-peek" data-testid="teacher-note-hidden">
            hidden while revealing
          </span>
        ) : (
          <span className="tnote-peek" aria-hidden="true">
            {note}
          </span>
        )}
        <span className="tnote-toggle">Show note</span>
      </button>
    )
  }
  return (
    <div className="tnote" role="note" aria-label="Teacher note" data-testid="teacher-note">
      <div className="tnote-head">
        <NoteGlyph />
        <span className="tnote-title">Teacher note</span>
        <button
          type="button"
          className="tnote-toggle"
          aria-expanded={true}
          onClick={() => onFold(true)}
          title="Fold the note to one line (it stays with the document)"
        >
          Hide note
        </button>
      </div>
      <p className="tnote-text">{note}</p>
    </div>
  )
}

function NoteGlyph() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3 2.5h7.5L13 5v8.5H3z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
      <path d="M5.5 7h5M5.5 9.5h5M5.5 12h3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  )
}
