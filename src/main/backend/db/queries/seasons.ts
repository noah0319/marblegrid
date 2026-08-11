import { getDb } from '../db.ts'

export function getOpenSeasonId(): number | null {
  const db = getDb()
  const row = db
    .prepare('SELECT id FROM seasons WHERE ended_at IS NULL ORDER BY id DESC LIMIT 1')
    .get() as { id: number } | undefined
  return row?.id ?? null
}

export function getOpenSeasonNumber(): number | null {
  const db = getDb()
  const row = db
    .prepare('SELECT season_number FROM seasons WHERE ended_at IS NULL ORDER BY id DESC LIMIT 1')
    .get() as { season_number: number | null } | undefined
  return row?.season_number ?? null
}

/** Closes whatever season is currently open (if any) and opens a new one. */
export function openSeasonFromFilename(seasonNumber: number, savFilename: string): void {
  const db = getDb()
  const now = new Date().toISOString()

  db.exec('BEGIN')
  try {
    db.prepare('UPDATE seasons SET ended_at = ? WHERE ended_at IS NULL').run(now)
    db.prepare(
      'INSERT INTO seasons (season_number, source, sav_filename, started_at) VALUES (?, ?, ?, ?)'
    ).run(seasonNumber, 'sav_filename', savFilename, now)
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

/** Manual override from Settings — takes precedence until cleared or superseded by a detected file. */
export function setManualSeasonOverride(seasonNumber: number): void {
  const db = getDb()
  const now = new Date().toISOString()

  db.exec('BEGIN')
  try {
    db.prepare('UPDATE seasons SET ended_at = ? WHERE ended_at IS NULL').run(now)
    db.prepare('INSERT INTO seasons (season_number, source, started_at) VALUES (?, ?, ?)').run(
      seasonNumber,
      'manual_override',
      now
    )
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}
