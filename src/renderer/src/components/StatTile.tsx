import './StatTile.css'

interface StatTileProps {
  label: string
  value: string
  /**
   * Which validated color this headline belongs to. 'accent' is the brand/
   * primary figure; 'race'/'royale' are for figures that ARE specifically
   * about that mode (Race HS, BR HS) — color follows the entity, per the
   * dataviz skill, not decoration for its own sake. 'default' (Avg Points)
   * stays neutral since it blends every mode together.
   */
  tone?: 'default' | 'accent' | 'race' | 'royale'
}

/** The "figure" contract from the dataviz skill: label + value, nothing louder than the number itself. */
export default function StatTile({ label, value, tone = 'default' }: StatTileProps): React.JSX.Element {
  return (
    <div className={`stat-tile stat-tile--${tone}`}>
      <div className="stat-tile__label">{label}</div>
      <div className="stat-tile__value">{value}</div>
    </div>
  )
}
