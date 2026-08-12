import { useState } from 'react'
import MapRecords from '../components/MapRecords'
import MapHistory from '../components/MapHistory'
import MapNotes from '../components/MapNotes'
import MapCommunity from '../components/MapCommunity'
import { useMapRecords } from '../hooks/useMapRecords'
import { useMapHistory } from '../hooks/useMapHistory'
import { useMapNotes } from '../hooks/useMapNotes'
import { useMapCommunity } from '../hooks/useMapCommunity'
import './MapsPage.css'

type MapTab = 'ghostball' | 'history' | 'notes' | 'community'

const TABS: { id: MapTab; label: string }[] = [
  { id: 'ghostball', label: 'Ghost Ball' },
  { id: 'history', label: 'History' },
  { id: 'notes', label: 'Notes' },
  { id: 'community', label: 'Community' }
]

/**
 * "Maps" — Noah's restructure of the old flat Ghost Balls page into one area
 * with sub-categories: Ghost Ball (the original best-time table, unchanged),
 * History (when each record was beaten and by who), Notes (a free-text
 * coverall per map), Community (per-map engagement — death rate, avg
 * finish). Each tab owns its own data hook and only the active tab is
 * mounted, so switching tabs is also how each one gets a fresh fetch —
 * simpler than wiring cross-tab refresh signals for what's a rarely-changing
 * personal dataset.
 */
export default function MapsPage(): React.JSX.Element {
  const [tab, setTab] = useState<MapTab>('ghostball')

  return (
    <div>
      <h1 style={{ fontSize: 24, fontWeight: 700, marginTop: 0, marginBottom: 20 }}>Maps</h1>
      <div className="maps-page__tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`maps-page__tab${tab === t.id ? ' maps-page__tab--active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="maps-page__body">
        {tab === 'ghostball' && <GhostBallTab />}
        {tab === 'history' && <HistoryTab />}
        {tab === 'notes' && <NotesTab />}
        {tab === 'community' && <CommunityTab />}
      </div>
    </div>
  )
}

function GhostBallTab(): React.JSX.Element {
  const { records, loading, refresh } = useMapRecords()
  if (loading) return <Loading />
  return <MapRecords records={records} onChanged={refresh} />
}

function HistoryTab(): React.JSX.Element {
  const { entries, loading } = useMapHistory()
  if (loading) return <Loading />
  return <MapHistory entries={entries} />
}

function NotesTab(): React.JSX.Element {
  const { notes, loading, refresh } = useMapNotes()
  if (loading) return <Loading />
  return <MapNotes notes={notes} onChanged={refresh} />
}

function CommunityTab(): React.JSX.Element {
  const { stats, loading } = useMapCommunity()
  if (loading) return <Loading />
  return <MapCommunity stats={stats} />
}

function Loading(): React.JSX.Element {
  return <div style={{ color: 'var(--text-muted)' }}>Loading…</div>
}
