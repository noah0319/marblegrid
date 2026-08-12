import { useMemo, useState } from 'react'
import type { MapHistoryEntry } from '@shared/types'
import { formatSeconds } from '@shared/format'
import './MapHistory.css'

interface MapHistoryProps {
  entries: MapHistoryEntry[]
}

const dateFormatter = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

function rowKey(entry: MapHistoryEntry): string {
  return `${entry.mapName}::${entry.mapCreator}::${entry.achievedAt}::${entry.isManualOverride ? 'o' : 'r'}`
}

export default function MapHistory({ entries }: MapHistoryProps): React.JSX.Element {
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return entries
    return entries.filter((e) => e.mapName.toLowerCase().includes(query) || e.mapCreator.toLowerCase().includes(query))
  }, [entries, search])

  return (
    <div>
      <input
        type="text"
        className="map-history__search"
        placeholder="Search maps or creators…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        aria-label="Search maps or creators"
      />
      <div className="map-history__list">
        {filtered.map((entry) => (
          <HistoryRow key={rowKey(entry)} entry={entry} />
        ))}
        {filtered.length === 0 && (
          <div className="map-history__empty">
            {entries.length === 0
              ? 'No records set yet — history fills in as maps get their first finish.'
              : `No maps match "${search.trim()}".`}
          </div>
        )}
      </div>
    </div>
  )
}

function HistoryRow({ entry }: { entry: MapHistoryEntry }): React.JSX.Element {
  const icon = entry.isManualOverride ? '🔧' : '🏆'
  const verb = entry.isManualOverride ? 'manually set to' : 'set'
  return (
    <div className="map-history__row">
      <span className="map-history__icon">{icon}</span>
      <div className="map-history__body">
        <div className="map-history__line">
          <span className="map-history__map">{entry.mapName}</span>
          <span className="map-history__creator">by {entry.mapCreator}</span>
          <span className="map-history__date">{dateFormatter.format(new Date(entry.achievedAt))}</span>
        </div>
        <div className="map-history__detail">
          <strong>{entry.racerName}</strong> {verb} <span className="map-history__time">{formatSeconds(entry.timeSeconds)}</span>
          {entry.previousTimeSeconds !== null ? (
            <>
              {' '}
              — beat <strong>{entry.previousRacerName}</strong>’s {formatSeconds(entry.previousTimeSeconds)}
            </>
          ) : (
            <> — first recorded time on this map</>
          )}
        </div>
      </div>
    </div>
  )
}
