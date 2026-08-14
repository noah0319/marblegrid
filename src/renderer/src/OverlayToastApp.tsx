import { useState } from 'react'
import { useLatestEvent } from './hooks/useLatestEvent'
import { useAppSettings } from './hooks/useAppSettings'
import { useWorldRecordEvent } from './hooks/useWorldRecordEvent'
import RaceResultToast from './components/RaceResultToast'
import WorldRecordToast from './components/WorldRecordToast'

/**
 * Dedicated Browser Source for just the result pop-in — split from the
 * leaderboard ticker (was one combined /overlay page) so Noah can size and
 * position each independently in OBS instead of them being stuck together
 * at fixed relative positions on one shared canvas.
 *
 * World record celebrations (Noah's ask) share this exact same slot rather
 * than needing a separate Browser Source — worldRecordActive tracks whether
 * one's currently showing so the normal result toast steps aside instead of
 * the two stacking on top of each other.
 */
export default function OverlayToastApp(): React.JSX.Element {
  const latestEvent = useLatestEvent()
  const worldRecordEvent = useWorldRecordEvent()
  const { settings } = useAppSettings()
  const [worldRecordActive, setWorldRecordActive] = useState(false)

  return (
    <>
      <RaceResultToast event={latestEvent} visibleMs={settings.toastDurationMs} hidden={worldRecordActive} />
      <WorldRecordToast event={worldRecordEvent} onVisibleChange={setWorldRecordActive} />
    </>
  )
}
