import { useMemo, useState } from 'react'
import type { MapRecord } from '@shared/types'
import { formatSeconds } from '@shared/format'
import { SERVER_PORT } from '@shared/constants'
import './MapRecords.css'

const BASE = `http://127.0.0.1:${SERVER_PORT}`

interface MapRecordsProps {
  records: MapRecord[]
  /** Called after a successful override save/clear — the parent owns the actual data fetch (same pattern as the rest of the app). */
  onChanged: () => void
}

type SortKey = 'mapName' | 'timeSeconds' | 'achievedAt'

const dateFormatter = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

/** "2:13.4" or "133.4" -> 133.4 seconds. Lenient on purpose — Noah's typing this by hand, not exporting it from somewhere. Returns null, never throws, on anything unparseable. */
function parseTimeInput(input: string): number | null {
  const trimmed = input.trim()
  if (!trimmed) return null
  if (trimmed.includes(':')) {
    const [minutesPart, secondsPart] = trimmed.split(':')
    const minutes = Number(minutesPart)
    const seconds = Number(secondsPart)
    if (!Number.isFinite(minutes) || !Number.isFinite(seconds) || minutes < 0 || seconds < 0) return null
    const total = minutes * 60 + seconds
    return total > 0 ? total : null
  }
  const seconds = Number(trimmed)
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null
}

/** The inverse of parseTimeInput — pre-fills the edit field with something Noah can immediately re-submit unchanged, rather than starting from a blank box. */
function formatTimeForInput(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = (totalSeconds - minutes * 60).toFixed(2)
  return `${minutes}:${seconds.padStart(5, '0')}`
}

function rowKey(mapName: string, mapCreator: string): string {
  return `${mapName}::${mapCreator}`
}

export default function MapRecords({ records, onChanged }: MapRecordsProps): React.JSX.Element {
  const [sortKey, setSortKey] = useState<SortKey>('mapName')
  const [search, setSearch] = useState('')
  const [editingKey, setEditingKey] = useState<string | null>(null)

  const sorted = useMemo(() => {
    const query = search.trim().toLowerCase()
    // Matches creator too — same-named maps by different creators are a
    // real, confirmed case, so "search by who made it" is a real lookup
    // path, not just "search by map name".
    const filtered = query
      ? records.filter(
          (r) => r.mapName.toLowerCase().includes(query) || r.mapCreator.toLowerCase().includes(query)
        )
      : records
    const copy = [...filtered]
    if (sortKey === 'mapName') return copy.sort((a, b) => a.mapName.localeCompare(b.mapName))
    if (sortKey === 'timeSeconds') return copy.sort((a, b) => a.timeSeconds - b.timeSeconds)
    return copy.sort((a, b) => (a.achievedAt < b.achievedAt ? 1 : -1))
  }, [records, sortKey, search])

  async function saveOverride(row: MapRecord, racerName: string, timeSeconds: number): Promise<void> {
    await fetch(`${BASE}/api/map-records/override`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mapName: row.mapName, mapCreator: row.mapCreator, racerName, timeSeconds })
    })
    setEditingKey(null)
    onChanged()
  }

  async function resetToAutomatic(row: MapRecord): Promise<void> {
    await fetch(`${BASE}/api/map-records/clear-override`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mapName: row.mapName, mapCreator: row.mapCreator })
    })
    setEditingKey(null)
    onChanged()
  }

  return (
    <div>
      <input
        type="text"
        className="map-records__search"
        placeholder="Search maps or creators…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        aria-label="Search maps or creators"
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
              <th scope="col" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => {
              const key = rowKey(row.mapName, row.mapCreator)
              return editingKey === key ? (
                <EditRow
                  key={key}
                  row={row}
                  onCancel={() => setEditingKey(null)}
                  onSave={(racerName, timeSeconds) => void saveOverride(row, racerName, timeSeconds)}
                  onResetToAutomatic={() => void resetToAutomatic(row)}
                />
              ) : (
                <tr key={key}>
                  <td className="map-records__name">
                    {row.mapName}
                    <span className="map-records__played-ticker" title={`Played ${row.timesPlayed} time${row.timesPlayed === 1 ? '' : 's'}`}>
                      ×{row.timesPlayed}
                    </span>
                    <div className="map-records__creator">by {row.mapCreator}</div>
                  </td>
                  <td className="map-records__num map-records__num--time">
                    {formatSeconds(row.timeSeconds)}
                    {row.isManualOverride && <span className="map-records__override-badge" title="Manually set by Noah">manual</span>}
                  </td>
                  <td className="map-records__num">{row.racerName}</td>
                  <td className="map-records__num">{dateFormatter.format(new Date(row.achievedAt))}</td>
                  <td className="map-records__num">
                    <button type="button" className="map-records__edit-btn" onClick={() => setEditingKey(key)}>
                      Edit
                    </button>
                  </td>
                </tr>
              )
            })}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={5} className="map-records__empty">
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

interface EditRowProps {
  row: MapRecord
  onCancel: () => void
  onSave: (racerName: string, timeSeconds: number) => void
  onResetToAutomatic: () => void
}

function EditRow({ row, onCancel, onSave, onResetToAutomatic }: EditRowProps): React.JSX.Element {
  const [racerName, setRacerName] = useState(row.racerName)
  const [timeInput, setTimeInput] = useState(formatTimeForInput(row.timeSeconds))
  const [error, setError] = useState<string | null>(null)

  function handleSave(): void {
    const parsed = parseTimeInput(timeInput)
    if (!racerName.trim()) {
      setError('Racer name can’t be empty.')
      return
    }
    if (parsed === null) {
      setError('Enter a time as minutes:seconds (eg. 2:13.4) or plain seconds (eg. 133.4).')
      return
    }
    onSave(racerName.trim(), parsed)
  }

  return (
    <tr className="map-records__edit-row">
      <td className="map-records__name">
        {row.mapName}
        <div className="map-records__creator">by {row.mapCreator}</div>
      </td>
      <td colSpan={3}>
        <div className="map-records__edit-fields">
          <input
            type="text"
            className="map-records__edit-input"
            value={timeInput}
            onChange={(e) => setTimeInput(e.target.value)}
            placeholder="2:13.4"
            aria-label="Best time"
          />
          <input
            type="text"
            className="map-records__edit-input"
            value={racerName}
            onChange={(e) => setRacerName(e.target.value)}
            placeholder="Racer name"
            aria-label="Racer name"
          />
        </div>
        {error && <p className="map-records__edit-error">{error}</p>}
      </td>
      <td>
        <div className="map-records__edit-actions">
          <button type="button" className="map-records__edit-btn map-records__edit-btn--save" onClick={handleSave}>
            Save
          </button>
          <button type="button" className="map-records__edit-btn" onClick={onCancel}>
            Cancel
          </button>
          {row.isManualOverride && (
            <button type="button" className="map-records__edit-btn" onClick={onResetToAutomatic}>
              Reset to automatic
            </button>
          )}
        </div>
      </td>
    </tr>
  )
}
