import MapRecords from '../components/MapRecords'
import { useMapRecords } from '../hooks/useMapRecords'

export default function RecordsPage(): React.JSX.Element {
  const { records, loading, refresh } = useMapRecords()

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginTop: 0, marginBottom: 28 }}>Ghost Balls</h1>
      {loading ? (
        <div style={{ color: 'var(--text-muted)' }}>Loading…</div>
      ) : (
        <MapRecords records={records} onChanged={refresh} />
      )}
    </div>
  )
}
