import './StatTile.css'

interface StatTileProps {
  label: string
  value: string
  accent?: boolean
}

/** The "figure" contract from the dataviz skill: label + value, nothing louder than the number itself. */
export default function StatTile({ label, value, accent = false }: StatTileProps): React.JSX.Element {
  return (
    <div className={`stat-tile${accent ? ' stat-tile--accent' : ''}`}>
      <div className="stat-tile__label">{label}</div>
      <div className="stat-tile__value">{value}</div>
    </div>
  )
}
