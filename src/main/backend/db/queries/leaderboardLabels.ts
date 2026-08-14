import { getDb } from '../db.ts'
import type { LeaderboardLabel } from '../../../../shared/types.ts'

/** Matches the overlay's own top-N (useOverlayLeaderboard fetches limit=5) — no point supporting more ranks than the overlay ever shows. */
const MAX_RANK = 5

/** Always returns exactly 5 rows (1-5), blank text for any rank Noah hasn't labeled yet — so callers never need to handle a sparse/partial list. */
export function getLeaderboardLabels(): LeaderboardLabel[] {
  const db = getDb()
  const rows = db
    .prepare(`SELECT rank_position as rankPosition, label_text as labelText FROM leaderboard_labels`)
    .all() as unknown as LeaderboardLabel[]
  const byRank = new Map(rows.map((r) => [r.rankPosition, r.labelText]))
  return Array.from({ length: MAX_RANK }, (_, i) => ({
    rankPosition: i + 1,
    labelText: byRank.get(i + 1) ?? ''
  }))
}

/** Saving blank/whitespace-only text clears the label instead of storing an empty one — same reasoning as map notes. */
export function setLeaderboardLabel(rankPosition: number, labelText: string): void {
  const db = getDb()
  const trimmed = labelText.trim()
  if (!trimmed) {
    db.prepare(`DELETE FROM leaderboard_labels WHERE rank_position = ?`).run(rankPosition)
    return
  }
  db.prepare(
    `INSERT INTO leaderboard_labels (rank_position, label_text, updated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(rank_position) DO UPDATE SET label_text = excluded.label_text, updated_at = excluded.updated_at`
  ).run(rankPosition, trimmed, new Date().toISOString())
}
