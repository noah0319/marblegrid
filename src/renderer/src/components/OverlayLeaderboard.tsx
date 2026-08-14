import { useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type { OverlayLeaderboardRow } from '../hooks/useOverlayLeaderboard'
import { formatFullNumber } from '@shared/format'
import './OverlayLeaderboard.css'

interface OverlayLeaderboardProps {
  rows: OverlayLeaderboardRow[]
  /** Index-aligned with rows — labels[0] is 1st place's giveaway label. Noah's ask, edited from the desktop app's Leaderboard page. */
  labels: string[]
}

const POPUP_VISIBLE_MS = 2800

/**
 * Always-visible compact corner ticker — the thing to look at between
 * race-result pop-ins. Noah's ask (NASCAR-broadcast style): when standings
 * change, rows smoothly reorder instead of snapping (framer-motion's
 * `layout` prop — real FLIP-style position animation, not hand-rolled),
 * a mover briefly flashes green (moved up) or red (moved down), and a
 * floating "+N" appears next to whoever just gained points.
 */
export default function OverlayLeaderboard({ rows, labels }: OverlayLeaderboardProps): React.JSX.Element {
  const top = rows.slice(0, 5)

  return (
    <div className="overlay-leaderboard">
      <div className="overlay-leaderboard__title">Season Leaderboard</div>
      <AnimatePresence initial={false}>
        {top.map((row, index) => (
          <LeaderboardRow key={row.username} row={row} rank={index + 1} label={labels[index]} />
        ))}
      </AnimatePresence>
      {top.length === 0 && <div className="overlay-leaderboard__empty">No races yet</div>}
    </div>
  )
}

interface LeaderboardRowProps {
  row: OverlayLeaderboardRow
  rank: number
  label: string | undefined
}

function LeaderboardRow({ row, rank, label }: LeaderboardRowProps): React.JSX.Element {
  // The CSS flash animation (rank-flash-up/down) plays once on its own and
  // holds at transparent — no JS timer needed for that part, it's just a
  // className derived straight from rankDelta. The points popup DOES need a
  // JS timer: unlike the flash, it must disappear on its own after a fixed
  // window even if no further refresh ever recomputes pointsDelta back to 0
  // (a quiet period with no new races would otherwise leave it stuck).
  const [showPopup, setShowPopup] = useState(false)
  const lastPopupKeyRef = useRef<string | null>(null)

  useEffect(() => {
    if (row.pointsDelta === null || row.pointsDelta <= 0) return
    // Keyed on the actual new total, not just "pointsDelta > 0" — so a
    // refresh that reports the SAME already-shown delta again (eg. a
    // reconnect re-fetch that finds nothing new) doesn't restart the timer
    // or re-trigger the animation from scratch.
    const key = `${row.username}:${row.totalPoints}`
    if (lastPopupKeyRef.current === key) return
    lastPopupKeyRef.current = key
    setShowPopup(true)
    const timer = setTimeout(() => setShowPopup(false), POPUP_VISIBLE_MS)
    return () => clearTimeout(timer)
  }, [row.pointsDelta, row.totalPoints, row.username])

  const rankClass =
    row.rankDelta !== null && row.rankDelta > 0
      ? 'overlay-leaderboard__row--up'
      : row.rankDelta !== null && row.rankDelta < 0
        ? 'overlay-leaderboard__row--down'
        : ''

  return (
    <motion.div
      layout
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ layout: { type: 'spring', stiffness: 300, damping: 30 }, opacity: { duration: 0.3 } }}
      className={`overlay-leaderboard__row ${rankClass}`}
    >
      <span className="overlay-leaderboard__rank">{rank}</span>
      <span className="overlay-leaderboard__name">{row.displayName || row.username}</span>
      {label && <span className="overlay-leaderboard__label">{label}</span>}
      <span className="overlay-leaderboard__points-wrap">
        <span className="overlay-leaderboard__points">{formatFullNumber(row.totalPoints)}</span>
        <AnimatePresence>
          {showPopup && row.pointsDelta !== null && row.pointsDelta > 0 && (
            <motion.span
              className="overlay-leaderboard__delta"
              initial={{ opacity: 0, y: 0, scale: 0.8 }}
              animate={{ opacity: 1, y: -20, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.6 }}
            >
              +{formatFullNumber(row.pointsDelta)}
            </motion.span>
          )}
        </AnimatePresence>
      </span>
    </motion.div>
  )
}
