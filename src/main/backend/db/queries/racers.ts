import type { DatabaseSync } from 'node:sqlite'

interface RacerInput {
  username: string
  displayName: string
  platform: string
  nameColorHex?: string
}

/** Insert a racer if new, or refresh its display name/color/last-seen if not. Returns its id. */
export function upsertRacer(db: DatabaseSync, racer: RacerInput): number {
  const now = new Date().toISOString()
  const usernameKey = racer.username.toLowerCase()

  const existing = db.prepare('SELECT id FROM racers WHERE username = ?').get(usernameKey) as
    | { id: number }
    | undefined

  if (existing) {
    db.prepare(
      'UPDATE racers SET display_name = ?, platform = ?, name_color_hex = ?, last_seen_at = ? WHERE id = ?'
    ).run(racer.displayName, racer.platform, racer.nameColorHex ?? null, now, existing.id)
    return existing.id
  }

  const result = db
    .prepare(
      'INSERT INTO racers (username, display_name, platform, name_color_hex, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(usernameKey, racer.displayName, racer.platform, racer.nameColorHex ?? null, now, now)
  return result.lastInsertRowid as number
}
