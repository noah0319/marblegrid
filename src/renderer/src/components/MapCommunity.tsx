import { useMemo, useState } from 'react'
import type { MapCommunityStat } from '@shared/types'
import { formatSeconds } from '@shared/format'
import './MapCommunity.css'

interface MapCommunityProps {
  stats: MapCommunityStat[]
}

type SortKey = 'mapName' | 'raceCount' | 'deathRatePercent' | 'avgFinishSeconds'

function rowKey(mapName: string, mapCreator: string): string {
  return `${mapName}::${mapCreator}`
}

/**
 * Each column sorts toward its own "most interesting" extreme, not always
 * ascending — same convention as MapRecords' time column (fastest first):
 * most-played first, highest death rate first, fastest average first.
 * avgFinishSeconds nulls (never finished) always sort last, regardless of
 * which direction the rest of that column is sorting.
 */
function compare(a: MapCommunityStat, b: MapCommunityStat, key: SortKey): number {
  if (key === 'mapName') return a.mapName.localeCompare(b.mapName)
  if (key === 'raceCount') return b.raceCount - a.raceCount
  if (key === 'deathRatePercent') return b.deathRatePercent - a.deathRatePercent
  if (a.avgFinishSeconds === null && b.avgFinishSeconds === null) return 0
  if (a.avgFinishSeconds === null) return 1
  if (b.avgFinishSeconds === null) return -1
  return a.avgFinishSeconds - b.avgFinishSeconds
}

/** Reuses the app's fixed status scale (never themed, see tokens.css) rather than inventing new severity colors — high death rate is exactly what that scale is for. */
function deathRateColor(percent: number): string {
  if (percent >= 75) return 'var(--status-critical)'
  if (percent >= 50) return 'var(--status-serious)'
  if (percent >= 25) return 'var(--status-warning)'
  return 'var(--status-good)'
}

export default function MapCommunity({ stats }: MapCommunityProps): React.JSX.Element {
  const [sortKey, setSortKey] = useState<SortKey>('mapName')
  const [search, setSearch] = useState('')

  const sorted = useMemo(() => {
    const query = search.trim().toLowerCase()
    const filtered = query
      ? stats.filter((s) => s.mapName.toLowerCase().includes(query) || s.mapCreator.toLowerCase().includes(query))
      : stats
    return [...filtered].sort((a, b) => compare(a, b, sortKey))
  }, [stats, sortKey, search])

  return (
    <div>
      <input
        type="text"
        className="map-community__search"
        placeholder="Search maps or creators…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        aria-label="Search maps or creators"
      />
      <div className="map-community">
        <table className="map-community__table">
          <thead>
            <tr>
              <SortableHeader label="Map" active={sortKey === 'mapName'} onClick={() => setSortKey('mapName')} />
              <SortableHeader label="Played" active={sortKey === 'raceCount'} onClick={() => setSortKey('raceCount')} />
              <SortableHeader
                label="Death Rate"
                active={sortKey === 'deathRatePercent'}
                onClick={() => setSortKey('deathRatePercent')}
              />
              <SortableHeader
                label="Avg Finish"
                active={sortKey === 'avgFinishSeconds'}
                onClick={() => setSortKey('avgFinishSeconds')}
              />
            </tr>
          </thead>
          <tbody>
            {sorted.map((s) => (
              <tr key={rowKey(s.mapName, s.mapCreator)}>
                <td className="map-community__name">
                  {s.mapName}
                  <div className="map-community__creator">by {s.mapCreator}</div>
                </td>
                <td className="map-community__num">×{s.raceCount}</td>
                <td className="map-community__num">
                  <span
                    className="map-community__death-rate"
                    style={{ color: deathRateColor(s.deathRatePercent) }}
                    title={`${Math.round(s.deathRatePercent * 10) / 10}% of participants eliminated across ${s.raceCount} race${s.raceCount === 1 ? '' : 's'}`}
                  >
                    {Math.round(s.deathRatePercent * 10) / 10}%
                  </span>
                </td>
                <td className="map-community__num">
                  {s.avgFinishSeconds === null ? (
                    <span className="map-community__no-data" title="Nobody has finished this map yet">
                      —
                    </span>
                  ) : (
                    formatSeconds(s.avgFinishSeconds)
                  )}
                </td>
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={4} className="map-community__empty">
                  {stats.length === 0 ? 'No races captured yet.' : `No maps match "${search.trim()}".`}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function SortableHeader({
  label,
  active,
  onClick
}: {
  label: string
  active: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <th scope="col">
      <button
        type="button"
        className={`map-community__sort${active ? ' map-community__sort--active' : ''}`}
        onClick={onClick}
      >
        {label}
      </button>
    </th>
  )
}
