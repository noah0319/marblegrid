import { getDb } from '../db.ts'
import { mapKey } from './mapKey.ts'
import { getKnownMaps } from './knownMaps.ts'
import type { MapNote } from '../../../../shared/types.ts'

interface NoteRow {
  mapName: string
  mapCreator: string
  noteText: string
  updatedAt: string
}

/**
 * One row per known map (see getKnownMaps), note text blank and updatedAt
 * null for maps Noah hasn't written anything on yet. Merged in JS from the
 * known-maps universe + the map_notes table, same "merge in JS rather than
 * one giant query" idiom as getMapRecords.
 */
export function getMapNotes(): MapNote[] {
  const db = getDb()

  const notes = db
    .prepare(
      `SELECT map_name as mapName, map_creator as mapCreator, note_text as noteText, updated_at as updatedAt
       FROM map_notes`
    )
    .all() as unknown as NoteRow[]
  const noteByKey = new Map(notes.map((n) => [mapKey(n.mapName, n.mapCreator), n]))

  return getKnownMaps()
    .map((m) => {
      const existing = noteByKey.get(mapKey(m.mapName, m.mapCreator))
      return {
        mapName: m.mapName,
        mapCreator: m.mapCreator,
        noteText: existing?.noteText ?? '',
        updatedAt: existing?.updatedAt ?? null
      }
    })
    .sort((a, b) => a.mapName.localeCompare(b.mapName))
}

/**
 * Upserts a note. Saving blank/whitespace-only text deletes the row instead
 * of storing an empty note — "no note" and "empty note" are the same thing
 * here, so there's no need for a separate clear endpoint the way overrides
 * have one (an override's "cleared" state is meaningfully different from any
 * value it could hold; a note's isn't).
 */
export function setMapNote(opts: { mapName: string; mapCreator: string; noteText: string }): void {
  const db = getDb()
  const trimmed = opts.noteText.trim()
  if (!trimmed) {
    db.prepare(`DELETE FROM map_notes WHERE map_name = ? AND map_creator = ?`).run(opts.mapName, opts.mapCreator)
    return
  }
  db.prepare(
    `INSERT INTO map_notes (map_name, map_creator, note_text, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(map_name, map_creator) DO UPDATE SET
       note_text = excluded.note_text, updated_at = excluded.updated_at`
  ).run(opts.mapName, opts.mapCreator, trimmed, new Date().toISOString())
}
