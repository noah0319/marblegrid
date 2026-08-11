import { useMemo, useState } from 'react'
import type { LeaderboardRow } from '@shared/types'
import { formatFullNumber } from '@shared/format'
import './Leaderboard.css'

interface LeaderboardProps {
  rows: LeaderboardRow[]
}

type SortKey = 'totalPoints' | 'racesPlayed' | 'wins'

const RANK_CLASS = ['leaderboard__rank--gold', 'leaderboard__rank--silver', 'leaderboard__rank--bronze']

export default function Leaderboard({ rows }: LeaderboardProps): React.JSX.Element {
  const [sortKey, setSortKey] = useState<SortKey>('totalPoints')

  const sorted = useMemo(() => [...rows].sort((a, b) => b[sortKey] - a[sortKey]), [rows, sortKey])

  return (
    <div className="leaderboard">
      <table className="leaderboard__table">
        <thead>
          <tr>
            <th className="leaderboard__rank-col" scope="col">
              #
            </th>
            <th scope="col">Racer</th>
            <SortableHeader
              label="Races"
              active={sortKey === 'racesPlayed'}
              onClick={() => setSortKey('racesPlayed')}
            />
            <SortableHeader label="Wins" active={sortKey === 'wins'} onClick={() => setSortKey('wins')} />
            <SortableHeader
              label="Points"
              active={sortKey === 'totalPoints'}
              onClick={() => setSortKey('totalPoints')}
            />
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, index) => (
            <tr key={row.username}>
              <td className={`leaderboard__rank-col ${RANK_CLASS[index] ?? ''}`}>{index + 1}</td>
              <td className="leaderboard__name">{row.displayName || row.username}</td>
              <td className="leaderboard__num">{row.racesPlayed}</td>
              <td className="leaderboard__num">{row.wins}</td>
              <td className="leaderboard__num leaderboard__num--points">{formatFullNumber(row.totalPoints)}</td>
            </tr>
          ))}
          {sorted.length === 0 && (
            <tr>
              <td colSpan={5} className="leaderboard__empty">
                No races captured yet this season.
              </td>
            </tr>
          )}
        </tbody>
      </table>
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
        className={`leaderboard__sort${active ? ' leaderboard__sort--active' : ''}`}
        onClick={onClick}
      >
        {label}
      </button>
    </th>
  )
}
