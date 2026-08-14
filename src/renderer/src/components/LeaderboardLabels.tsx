import { useState } from 'react'
import type { LeaderboardLabel } from '@shared/types'
import { SERVER_PORT } from '@shared/constants'
import './LeaderboardLabels.css'

const BASE = `http://127.0.0.1:${SERVER_PORT}`
const ORDINALS = ['1st', '2nd', '3rd', '4th', '5th']

interface LeaderboardLabelsProps {
  labels: LeaderboardLabel[]
  /** Called after a successful save — the parent owns the actual data fetch (same pattern as MapNotes/MapRecords). */
  onChanged: () => void
}

/**
 * Giveaway labels for the OBS leaderboard overlay — Noah's ask. Keyed by
 * rank POSITION (1st, 2nd, ...), not by racer: a prize belongs to "whoever's
 * in 1st place" and should follow the position as standings shift, not the
 * specific person who happened to be there when this was typed. Edited here
 * (the desktop app) rather than on the overlay itself, since an OBS Browser
 * Source isn't practically typeable into during a live broadcast — the
 * overlay just displays whatever's saved here, live (see
 * useOverlayLeaderboard's WS listener for leaderboard-labels-changed).
 */
export default function LeaderboardLabels({ labels, onChanged }: LeaderboardLabelsProps): React.JSX.Element {
  async function save(rankPosition: number, labelText: string): Promise<void> {
    await fetch(`${BASE}/api/leaderboard-labels`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rankPosition, labelText })
    })
    onChanged()
  }

  return (
    <div className="leaderboard-labels">
      <p className="leaderboard-labels__hint">
        Shows on the overlay leaderboard next to whoever&apos;s currently in that spot — handy for giveaways (eg.
        type &quot;iPad&quot; next to 1st place). Follows the position if standings shift, not the person.
      </p>
      {labels.map((label) => (
        <LabelRow key={label.rankPosition} label={label} onSave={(text) => void save(label.rankPosition, text)} />
      ))}
    </div>
  )
}

function LabelRow({
  label,
  onSave
}: {
  label: LeaderboardLabel
  onSave: (text: string) => void
}): React.JSX.Element {
  const [text, setText] = useState(label.labelText)
  const dirty = text !== label.labelText

  return (
    <div className="leaderboard-labels__row">
      <span className="leaderboard-labels__rank">{ORDINALS[label.rankPosition - 1]}</span>
      <input
        type="text"
        className="leaderboard-labels__input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="e.g. iPad"
        aria-label={`Giveaway label for ${ORDINALS[label.rankPosition - 1]} place`}
      />
      {dirty && (
        <div className="leaderboard-labels__actions">
          <button type="button" className="leaderboard-labels__save-btn" onClick={() => onSave(text)}>
            Save
          </button>
          <button type="button" className="leaderboard-labels__cancel-btn" onClick={() => setText(label.labelText)}>
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}
