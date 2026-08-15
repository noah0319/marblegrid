import { useMemo } from 'react'
import type { TodayStats } from '@shared/types'
import { useTodayStats } from './hooks/useTodayStats'
import { useAppSettings } from './hooks/useAppSettings'
import DailyStatsOverlay from './components/DailyStatsOverlay'

const PREVIEW_NAMES = ['TestRacer', 'PreviewUser', 'SampleName', 'DemoPlayer', 'ExampleFan']

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function randomPreviewName(): string {
  const base = PREVIEW_NAMES[randomInt(0, PREVIEW_NAMES.length - 1)]
  return `${base}${randomInt(1, 99)}`
}

/**
 * Noah's ask: a way to see the overlay populated with real-looking numbers
 * without waiting for actual races — handy while sizing/positioning it in
 * OBS. Add ?preview to the Browser Source URL (any value, or none at all —
 * e.g. http://127.0.0.1:43117/overlay-daily-stats?preview) and this
 * generates one random-but-plausible snapshot entirely in the browser, no
 * backend call and no real data touched at all. Regenerates on every page
 * load/refresh (right-click a Browser Source -> Refresh in OBS), not on a
 * timer — a static snapshot is enough to judge layout/legibility, and a
 * timer would just be complexity this doesn't need.
 *
 * The DailyStatsOverlay component renders a loud "Preview" badge whenever
 * this is active so fake numbers can never be mistaken for a real stat if
 * the query param is accidentally left on a live source.
 */
export default function OverlayDailyStatsApp(): React.JSX.Element {
  const isPreview = useMemo(() => new URLSearchParams(window.location.search).has('preview'), [])
  const { settings } = useAppSettings()

  const previewStats = useMemo<TodayStats | null>(() => {
    if (!isPreview) return null
    return {
      totalPoints: randomInt(3_000, 45_000),
      totalCount: randomInt(3, 35),
      avgPoints: 0, // not shown by this overlay — DailyStatsOverlay doesn't read it
      raceHs: randomInt(500, 5_000),
      brHs: randomInt(100, 800),
      raceHsHolder: randomPreviewName(),
      brHsHolder: randomPreviewName()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPreview])

  // Always call the real hook (rules of hooks — can't call it conditionally)
  // even in preview mode; its result is simply unused when previewStats is set.
  const liveStats = useTodayStats()

  return (
    <DailyStatsOverlay
      stats={isPreview ? previewStats : liveStats}
      preview={isPreview}
      showBrHs={settings.showBrHs}
    />
  )
}
