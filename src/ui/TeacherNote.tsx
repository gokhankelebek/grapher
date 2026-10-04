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
// ============================================================================

interface Props {
  note: string
  folded: boolean
  onFold(folded: boolean): void
}

export function TeacherNote({ note, folded, onFold }: Props) {
  if (note === '') return null
  if (folded) {
    return (
      <button
        type="button"
        className="tnote tnote-line"
        data-testid="teacher-note-chip"
        aria-expanded={false}
        onClick={() => onFold(false)}
        title="Show the teacher note"
      >
        <NoteGlyph />
        <span className="tnote-title">Teacher note</span>
        <span className="tnote-peek" aria-hidden="true">
          {note}
        </span>
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
