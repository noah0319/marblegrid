import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type { WorldRecordEvent } from '../hooks/useWorldRecordEvent'
import { formatFullNumber, formatSeconds } from '@shared/format'
import './WorldRecordToast.css'

// Noah's ask: stays on screen longer than a normal result (DEFAULT_VISIBLE_MS
// in RaceResultToast) — this is the rare, big moment, not a routine result.
const VISIBLE_MS = 12_000
const PARTICLE_COUNT = 22

// Validated categorical hues already in use elsewhere in the app (mode
// badges, brand accent) plus the existing decorative rank-gold token — not
// new/unvalidated colors, just reused for a celebratory burst instead of
// their usual identity role.
const PARTICLE_COLORS = [
  'var(--mode-race)',
  'var(--mode-tilt)',
  'var(--mode-royale)',
  'var(--rank-gold)',
  'var(--accent-primary)'
]

interface WorldRecordToastProps {
  event: WorldRecordEvent | null
  /** Lets OverlayToastApp suppress the normal result toast while this is showing — same visual slot (top-right), never both at once. */
  onVisibleChange?: (visible: boolean) => void
}

/**
 * Extends the existing result toast's slot rather than adding a new OBS
 * source (Noah's chosen direction) — a distinct, bigger, gold-and-fireworks
 * variant that takes over the same top-right position for a world record,
 * instead of a second Browser Source to set up.
 */
export default function WorldRecordToast({ event, onVisibleChange }: WorldRecordToastProps): React.JSX.Element | null {
  const [visible, setVisible] = useState(false)
  const shownKeyRef = useRef<number | null>(null)

  useEffect(() => {
    if (!event) return
    if (shownKeyRef.current === event.receivedAt) return
    shownKeyRef.current = event.receivedAt
    setVisible(true)
    onVisibleChange?.(true)
    const timer = setTimeout(() => {
      setVisible(false)
      onVisibleChange?.(false)
    }, VISIBLE_MS)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event])

  return (
    <AnimatePresence>
      {visible && event && (
        <motion.div
          className="wr-toast"
          initial={{ opacity: 0, scale: 0.85 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.92 }}
          transition={{ type: 'spring', stiffness: 260, damping: 22 }}
        >
          <FireworksBurst seed={event.receivedAt} />
          <div className="wr-toast__badge">🌍💥 WORLD RECORD</div>
          <div className="wr-toast__holder">{event.recordHolderName}</div>
          <div className="wr-toast__map">{event.mapName}</div>
          <div className="wr-toast__time">{formatSeconds(event.recordTimeSeconds)}</div>
          <div className="wr-toast__previous">
            beat <strong>{event.previousRecordHolderName}</strong>’s {formatSeconds(event.previousRecordTimeSeconds)}
          </div>
          {event.pointsEarned !== null && (
            <div className="wr-toast__points">+{formatFullNumber(event.pointsEarned)} points</div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

interface Particle {
  id: number
  x: number
  y: number
  color: string
  delay: number
}

/** Re-randomized per celebration (keyed on `seed`, the event's receivedAt) so repeat world records don't all burst in the exact same pattern. */
function FireworksBurst({ seed }: { seed: number }): React.JSX.Element {
  const particles = useMemo<Particle[]>(() => {
    return Array.from({ length: PARTICLE_COUNT }, (_, i) => {
      const angle = (Math.PI * 2 * i) / PARTICLE_COUNT + (Math.random() - 0.5) * 0.5
      const distance = 55 + Math.random() * 55
      return {
        id: i,
        x: Math.cos(angle) * distance,
        y: Math.sin(angle) * distance,
        color: PARTICLE_COLORS[i % PARTICLE_COLORS.length] ?? 'var(--rank-gold)',
        delay: Math.random() * 0.2
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed])

  return (
    <div className="wr-toast__fireworks" aria-hidden="true">
      {particles.map((p) => (
        <motion.span
          key={p.id}
          className="wr-toast__particle"
          style={{ background: p.color }}
          initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
          animate={{ x: p.x, y: p.y, opacity: 0, scale: 0.3 }}
          transition={{ duration: 1.2, delay: p.delay, ease: 'easeOut' }}
        />
      ))}
    </div>
  )
}
