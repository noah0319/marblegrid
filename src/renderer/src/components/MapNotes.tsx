import { useMemo, useState } from 'react'
import type { MapNote } from '@shared/types'
import { SERVER_PORT } from '@shared/constants'
import './MapNotes.css'

const BASE = `http://127.0.0.1:${SERVER_PORT}`

interface MapNotesProps {
  notes: MapNote[]
  /** Called after a successful save — the parent owns the actual data fetch (same pattern as MapRecords). */
  onChanged: () => void
}

const dateFormatter = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

function rowKey(mapName: string, mapCreator: string): string {
  return `${mapName}::${mapCreator}`
}

export default function MapNotes({ notes, onChanged }: MapNotesProps): React.JSX.Element {
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    const list = query
      ? notes.filter((n) => n.mapName.toLowerCase().includes(query) || n.mapCreator.toLowerCase().includes(query))
      : notes
    return [...list].sort((a, b) => a.mapName.localeCompare(b.mapName))
  }, [notes, search])

  async function save(note: MapNote, noteText: string): Promise<void> {
    await fetch(`${BASE}/api/map-notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mapName: note.mapName, mapCreator: note.mapCreator, noteText })
    })
    onChanged()
  }

  return (
    <div>
      <input
        type="text"
        className="map-notes__search"
        placeholder="Search maps or creators…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        aria-label="Search maps or creators"
      />
      <div className="map-notes__list">
        {filtered.map((note) => (
          <NoteCard key={rowKey(note.mapName, note.mapCreator)} note={note} onSave={(text) => void save(note, text)} />
        ))}
        {filtered.length === 0 && (
          <div className="map-notes__empty">
            {notes.length === 0
              ? 'No maps captured yet — notes fill in as maps get played.'
              : `No maps match "${search.trim()}".`}
          </div>
        )}
      </div>
    </div>
  )
}

interface NoteCardProps {
  note: MapNote
  onSave: (text: string) => void
}

function NoteCard({ note, onSave }: NoteCardProps): React.JSX.Element {
  const [text, setText] = useState(note.noteText)
  const dirty = text !== note.noteText

  return (
    <div className="map-notes__card">
      <div className="map-notes__card-header">
        <div>
          <span className="map-notes__name">{note.mapName}</span>
          <span className="map-notes__creator">by {note.mapCreator}</span>
        </div>
        {note.updatedAt && (
          <span className="map-notes__updated">Updated {dateFormatter.format(new Date(note.updatedAt))}</span>
        )}
      </div>
      <textarea
        className="map-notes__textarea"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Add a note about this map… shortcuts, chat's favorite, anything worth remembering."
        rows={2}
        aria-label={`Note for ${note.mapName}`}
      />
      {dirty && (
        <div className="map-notes__actions">
          <button type="button" className="map-notes__save-btn" onClick={() => onSave(text)}>
            Save
          </button>
          <button type="button" className="map-notes__cancel-btn" onClick={() => setText(note.noteText)}>
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}
