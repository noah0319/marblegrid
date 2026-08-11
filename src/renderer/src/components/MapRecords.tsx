import { useMemo, useState } from 'react'
import type { MapRecord } from '@shared/types'
import { formatSeconds } from '@shared/format'
import './MapRecords.css'

interface MapRecordsProps {
  records: MapRecord[]
}

type SortKey = 'mapName' | 'timeSeconds' | 'achievedAt'

const dateFormatter = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

export default function MapRecords({ records }: MapRecordsProps): React.JSX.Element {
  const [sortKey, setSortKey] = useState<SortKey>('mapName')
  const [search, setSearch] = useState('')

  const sorted = useMemo(() => {
    const query = search.trim().toLowerCase()
    const filtered = query ? records.filter((r) => r.mapName.toLowerCase().includes(query)) : records
    const copy = [...filtered]
    if (sortKey === 'mapName') return copy.sort((a, b) => a.mapName.localeCompare(b.mapName))
    if (sortKey === 'timeSeconds') return copy.sort((a, b) => a.timeSeconds - b.timeSeconds)
    return copy.sort((a, b) => (a.achievedAt < b.achievedAt ? 1 : -1))
  }, [records, sortKey, search])

  return (
    <div>
      <input
        type="text"
        className="map-records__search"
        placeholder="Search maps…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        aria-label="Search maps"
      />
      <div className="map-records">
        <table className="map-records__table">
          <thead>
            <tr>
              <SortableHeader label="Map" active={sortKey === 'mapName'} onClick={() => setSortKey('mapName')} />
              <SortableHeader
                label="Best Time"
                active={sortKey === 'timeSeconds'}
                onClick={() => setSortKey('timeSeconds')}
              />
              <th scope="col">Racer</th>
              <SortableHeader
                label="Set On"
                active={sortKey === 'achievedAt'}
                onClick={() => setSortKey('achievedAt')}
              />
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <tr key={row.mapName}>
                <td className="map-records__name">{row.mapName}</td>
                <td className="map-records__num map-records__num--time">{formatSeconds(row.timeSeconds)}</td>
                <td className="map-records__num">{row.racerName}</td>
                <td className="map-records__num">{dateFormatter.format(new Date(row.achievedAt))}</td>
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={4} className="map-records__empty">
                  {records.length === 0
                    ? 'No finished races captured yet — records fill in as races on official maps complete.'
                    : `No maps match "${search.trim()}".`}
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
      <button type="button" className={`map-records__sort${active ? ' map-records__sort--active' : ''}`} onClick={onClick}>
        {label}
      </button>
    </th>
  )
}
