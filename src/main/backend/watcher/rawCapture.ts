import { createHash } from 'crypto'
import { getDb } from '../db/db.ts'

/**
 * Stores a snapshot of a watched file's content — but only if it differs
 * from the last thing captured for that file, since chokidar can fire more
 * than one change event for a single real write (and, at startup, will emit
 * an event for every file even if nothing actually changed since last run).
 *
 * Returns true if this was new content (caller should proceed to parse it),
 * false if it's an exact repeat (caller should skip re-processing).
 */
export function captureRawSnapshot(sourceFile: string, text: string): boolean {
  const db = getDb()
  const hash = createHash('sha256').update(text.trim()).digest('hex')

  const existing = db
    .prepare('SELECT 1 FROM raw_snapshots WHERE source_file = ? AND content_hash = ?')
    .get(sourceFile, hash)

  if (existing) return false

  db.prepare(
    'INSERT INTO raw_snapshots (source_file, captured_at_local, content_hash, raw_csv_text) VALUES (?, ?, ?, ?)'
  ).run(sourceFile, new Date().toISOString(), hash, text)

  return true
}
