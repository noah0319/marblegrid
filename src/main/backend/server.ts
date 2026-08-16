import express from 'express'
import { createServer } from 'http'
import { join } from 'path'
import { shell, app as electronApp } from 'electron'
import { WebSocketServer } from 'ws'
import { registerWss, broadcast } from './ws.ts'
import { getDb } from './db/db.ts'
import { getOpenSeasonId } from './db/queries/seasons.ts'
import { getSeasonStats, getTodayStats, getTodayRaceHighScore, getTodayBrHighScore } from './db/queries/stats.ts'
import { getLeaderboard } from './db/queries/leaderboard.ts'
import { getMapRecords, setMapRecordOverride, clearMapRecordOverride } from './db/queries/mapRecords.ts'
import { getMapNotes, setMapNote } from './db/queries/mapNotes.ts'
import { getLeaderboardLabels, setLeaderboardLabel } from './db/queries/leaderboardLabels.ts'
import { getMapCommunityStats } from './db/queries/mapCommunity.ts'
import { getMapRecordHistory } from './db/queries/mapHistory.ts'
import { getLatestEvent } from './db/queries/latestEvent.ts'
import { getSettings, updateSettings } from './twitch/settingsStore.ts'
import { getAppSettings, updateAppSettings } from './appSettingsStore.ts'
import {
  getAuthorizeUrl,
  handleOAuthCallback,
  isConnected,
  disconnect,
  getApiClient,
  getBroadcasterUserId,
  isBotConnected,
  disconnectBot,
  sendChatMessageAsConfigured,
  type ConnectionPurpose
} from './twitch/auth.ts'
import { sendTestPost } from './twitch/chatPoster.ts'
import { buildChatMessage } from './twitch/messageTemplates.ts'
import { startChatListener, stopChatListener, isChatListenerActive } from './twitch/chatListener.ts'
import { getUpdateReadyVersion, installUpdateNow } from '../updater.ts'
import { markQuitting } from '../appLifecycle.ts'
import type { TwitchStatus, TodayStats } from '../../shared/types.ts'

/**
 * Local-only Express + WebSocket server. Binds to 127.0.0.1 only — this is a
 * personal desktop app (Electron renderer + OBS browser source are the only
 * two intended clients), so there's no LAN/internet exposure to defend and
 * no auth needed on the local API.
 */
export async function startServer(port: number): Promise<void> {
  const app = express()
  app.use(express.json())

  // Permissive CORS is fine here — everything is 127.0.0.1-only already.
  // Must handle the preflight properly, not just tag the real response: the
  // dev-mode renderer is served from Vite's own origin (http://localhost:*),
  // a different origin from this server (http://127.0.0.1:*), so any POST
  // with a JSON body (credentials, auto-post) triggers a real CORS preflight
  // first. Only setting Allow-Origin (no Allow-Methods/Allow-Headers, no
  // explicit OPTIONS response) made that preflight fail silently — the
  // browser never even sent the real POST, and nothing surfaced an error.
  // Found via a real repro: Settings' "Save credentials" did nothing.
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*')
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.header('Access-Control-Allow-Headers', 'Content-Type')
    if (req.method === 'OPTIONS') {
      res.sendStatus(204)
      return
    }
    next()
  })

  app.get('/api/status', (_req, res) => {
    // electronApp.getVersion() reads straight from package.json's "version"
    // field as actually bundled — always accurate for both dev and packaged
    // builds, unlike importing package.json directly.
    res.json({
      status: 'OK',
      app: 'MarbleGrid',
      phase: 5,
      version: electronApp.getVersion(),
      // Non-null once electron-updater has finished downloading a newer
      // build in the background — lets a freshly (re)opened window show the
      // "ready to install" banner even if the download finished while the
      // window was closed (tray-resident app, so that's a real case).
      updateReadyVersion: getUpdateReadyVersion()
    })
  })

  // Real report (2026-08-16): relying on people to discover "right-click
  // tray icon -> Quit" to actually apply a downloaded update isn't
  // reliable — someone Task-Managered the app instead, which skips the
  // graceful quit sequence entirely, and stayed on the old version
  // indefinitely. This gives the update-ready banner's button a
  // deterministic path instead of hoping. Respond BEFORE quitting — the
  // process is about to exit, so the renderer's fetch() needs to see a
  // real 200 first, not a dropped connection it can't tell apart from a
  // real failure.
  app.post('/api/update/install-now', (_req, res) => {
    if (!getUpdateReadyVersion()) {
      res.status(400).json({ error: 'No update is ready to install.' })
      return
    }
    res.json({ ok: true })
    setTimeout(() => installUpdateNow(), 150)
  })

  // Noah's ask, after watching someone struggle to find the tray icon at
  // all: a direct "fully quit" button inside the app itself, not dependent
  // on finding a small icon in the notification area. Same graceful path
  // as the tray's own Quit item (markQuitting() before app.quit(), so the
  // main window's close handler doesn't just hide it again) — this is a
  // real, clean shutdown, not a Task-Manager-style kill. Respond before
  // quitting, same reasoning as install-now above.
  app.post('/api/app/quit', (_req, res) => {
    res.json({ ok: true })
    setTimeout(() => {
      markQuitting()
      electronApp.quit()
    }, 150)
  })

  // Real stats routes — Phase 2. Day-boundary hour is now a real per-user
  // override (Noah's ask), read fresh on every request from appSettingsStore
  // rather than the old hardcoded DEFAULT_DAY_BOUNDARY_HOUR constant.
  app.get('/api/stats/season', (_req, res) => {
    res.json(getSeasonStats(getOpenSeasonId()))
  })
  app.get('/api/stats/today', (_req, res) => {
    const dayBoundaryHour = getAppSettings().dayBoundaryHour
    const stats: TodayStats = {
      ...getTodayStats(dayBoundaryHour),
      raceHsHolder: getTodayRaceHighScore(dayBoundaryHour)?.racerName ?? null,
      brHsHolder: getTodayBrHighScore(dayBoundaryHour)?.racerName ?? null
    }
    res.json(stats)
  })
  app.get('/api/leaderboard', (req, res) => {
    const limit = Number(req.query['limit']) || 20
    res.json(getLeaderboard(getOpenSeasonId(), limit))
  })
  // All-time, not season-scoped — a map record is about the map, not a
  // season's standings. Personal-to-Noah feature (his ask, not part of the
  // multi-streamer-friendly config surface).
  app.get('/api/map-records', (_req, res) => {
    res.json(getMapRecords())
  })
  // Manual override: replaces the automatic best-time computation for one
  // map until cleared. Noah's ask, for correcting/seeding a record by hand.
  app.post('/api/map-records/override', (req, res) => {
    const { mapName, mapCreator, racerName, timeSeconds } = req.body as {
      mapName?: string
      mapCreator?: string
      racerName?: string
      timeSeconds?: number
    }
    if (!mapName || !mapCreator || !racerName || typeof timeSeconds !== 'number' || !(timeSeconds > 0)) {
      res.status(400).json({ error: 'mapName, mapCreator, racerName, and a positive timeSeconds are all required' })
      return
    }
    setMapRecordOverride({ mapName, mapCreator, racerName, timeSeconds })
    res.json({ ok: true })
  })
  app.post('/api/map-records/clear-override', (req, res) => {
    const { mapName, mapCreator } = req.body as { mapName?: string; mapCreator?: string }
    if (!mapName || !mapCreator) {
      res.status(400).json({ error: 'mapName and mapCreator are both required' })
      return
    }
    clearMapRecordOverride(mapName, mapCreator)
    res.json({ ok: true })
  })
  // "Maps" sub-categories — Notes, Community, History. All read-derived from
  // existing race_events/race_participants/map_record_overrides except Notes,
  // which is the one genuinely new piece of state (map_notes table).
  app.get('/api/map-notes', (_req, res) => {
    res.json(getMapNotes())
  })
  app.post('/api/map-notes', (req, res) => {
    const { mapName, mapCreator, noteText } = req.body as { mapName?: string; mapCreator?: string; noteText?: string }
    if (!mapName || !mapCreator || typeof noteText !== 'string') {
      res.status(400).json({ error: 'mapName, mapCreator, and noteText are all required' })
      return
    }
    setMapNote({ mapName, mapCreator, noteText })
    res.json({ ok: true })
  })
  app.get('/api/map-community', (_req, res) => {
    res.json(getMapCommunityStats())
  })
  app.get('/api/map-history', (_req, res) => {
    res.json(getMapRecordHistory())
  })
  // General display preferences (overlay toast duration, day-boundary hour —
  // both were hardcoded constants before, both Noah's ask to make real
  // per-user settings). Separate from /api/twitch/* — not Twitch-related.
  app.get('/api/app-settings', (_req, res) => {
    res.json(getAppSettings())
  })
  app.post('/api/app-settings', (req, res) => {
    const { toastDurationMs, dayBoundaryHour, showBrHs } = req.body as {
      toastDurationMs?: number
      dayBoundaryHour?: number
      showBrHs?: boolean
    }
    const patch: { toastDurationMs?: number; dayBoundaryHour?: number; showBrHs?: boolean } = {}
    if (toastDurationMs !== undefined) {
      if (typeof toastDurationMs !== 'number' || !(toastDurationMs >= 1000) || !(toastDurationMs <= 120_000)) {
        res.status(400).json({ error: 'toastDurationMs must be a number between 1000 and 120000 (1-120 seconds)' })
        return
      }
      patch.toastDurationMs = toastDurationMs
    }
    if (dayBoundaryHour !== undefined) {
      if (typeof dayBoundaryHour !== 'number' || !Number.isInteger(dayBoundaryHour) || dayBoundaryHour < 0 || dayBoundaryHour > 23) {
        res.status(400).json({ error: 'dayBoundaryHour must be a whole number between 0 and 23' })
        return
      }
      patch.dayBoundaryHour = dayBoundaryHour
    }
    if (showBrHs !== undefined) {
      if (typeof showBrHs !== 'boolean') {
        res.status(400).json({ error: 'showBrHs must be a boolean' })
        return
      }
      patch.showBrHs = showBrHs
    }
    updateAppSettings(patch)
    res.json({ ok: true })
  })

  // Giveaway labels — Noah's ask: a blank spot per leaderboard rank (1-5) he
  // can type a prize into from the desktop app, shown on the OBS overlay
  // next to whoever's currently in that spot. Broadcasts so the overlay (a
  // separate browser context, possibly open for hours during a stream)
  // updates live instead of needing a manual OBS refresh after every edit.
  app.get('/api/leaderboard-labels', (_req, res) => {
    res.json(getLeaderboardLabels())
  })
  app.post('/api/leaderboard-labels', (req, res) => {
    const { rankPosition, labelText } = req.body as { rankPosition?: number; labelText?: string }
    if (typeof rankPosition !== 'number' || rankPosition < 1 || rankPosition > 5 || typeof labelText !== 'string') {
      res.status(400).json({ error: 'rankPosition (1-5) and labelText are required' })
      return
    }
    setLeaderboardLabel(rankPosition, labelText)
    broadcast({ type: 'leaderboard-labels-changed' })
    res.json({ ok: true })
  })
  app.get('/api/latest-event', (_req, res) => {
    res.json(getLatestEvent())
  })

  // Phase 5 — Twitch connection + chat posting. Client Secret is write-only
  // from the renderer's perspective: /api/twitch/status never echoes it
  // back, only whether credentials exist at all.
  app.get('/api/twitch/status', (_req, res) => {
    const settings = getSettings()
    const status: TwitchStatus = {
      hasCredentials: Boolean(settings.clientId && settings.clientSecret),
      connected: isConnected(),
      login: settings.login,
      autoPostEnabled: settings.autoPostEnabled,
      autoPostLastMapEnabled: settings.autoPostLastMapEnabled,
      chatCommandsActive: isChatListenerActive(),
      botConnected: isBotConnected(),
      botLogin: settings.botLogin
    }
    res.json(status)
  })

  app.post('/api/twitch/credentials', (req, res) => {
    const { clientId, clientSecret } = req.body as { clientId?: string; clientSecret?: string }
    if (!clientId || !clientSecret) {
      res.status(400).json({ error: 'clientId and clientSecret are both required' })
      return
    }
    updateSettings({ clientId, clientSecret })
    res.json({ ok: true })
  })

  app.post('/api/twitch/connect', (_req, res) => {
    try {
      const url = getAuthorizeUrl('main')
      void shell.openExternal(url)
      res.json({ ok: true })
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  app.post('/api/twitch/disconnect', (_req, res) => {
    stopChatListener()
    disconnect()
    res.json({ ok: true })
  })

  // Optional second account that, once connected AND modded in Noah's own
  // chat (Twitch requires that for this send mechanism — see
  // sendChatMessageAsConfigured), posts everything instead of the main
  // account. Reuses the same Client ID/Secret already saved — a different
  // Twitch login is what actually distinguishes this from /connect.
  app.post('/api/twitch/bot-connect', (_req, res) => {
    try {
      const url = getAuthorizeUrl('bot')
      void shell.openExternal(url)
      res.json({ ok: true })
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  app.post('/api/twitch/bot-disconnect', (_req, res) => {
    disconnectBot()
    res.json({ ok: true })
  })

  app.post('/api/twitch/auto-post', (req, res) => {
    const { enabled } = req.body as { enabled?: boolean }
    updateSettings({ autoPostEnabled: Boolean(enabled) })
    res.json({ ok: true })
  })

  // Noah's ask: a SEPARATE toggle from the one above — posts !lastmap's info
  // automatically after every race instead of needing someone to type the
  // command. Independent on/off state, own route, same reasoning as keeping
  // world-record alerts distinct from a hypothetical "post everything" flag.
  app.post('/api/twitch/auto-post-lastmap', (req, res) => {
    const { enabled } = req.body as { enabled?: boolean }
    updateSettings({ autoPostLastMapEnabled: Boolean(enabled) })
    res.json({ ok: true })
  })

  app.post('/api/twitch/test-post', (_req, res) => {
    sendTestPost()
      .then((result) => res.json(result))
      .catch((err: unknown) => {
        res.status(500).json({ attempted: true, success: false, error: err instanceof Error ? err.message : String(err) })
      })
  })

  // Lets Noah see real race-result formatting in his actual chat on demand,
  // without waiting for (or faking) a real race. Deliberately bypasses
  // chat_post_log entirely — this is a manual preview, not an auto-post, and
  // must never be recorded under the real event's (event_kind,
  // event_occurred_at) key, or it would falsely mark that real event as
  // already-posted and silently swallow its actual auto-post later.
  app.post('/api/twitch/preview-post', (_req, res) => {
    const event = getLatestEvent()
    if (!event) {
      res.status(400).json({ attempted: false, success: false, error: 'No race, tilt, or royale has been captured yet.' })
      return
    }
    const broadcasterId = getBroadcasterUserId()
    const apiClient = getApiClient()
    if (!broadcasterId || !apiClient) {
      res.status(400).json({ attempted: true, success: false, error: 'Twitch is not connected.' })
      return
    }
    const message = buildChatMessage(event)
    // Routes through the bot account if one's connected, else Noah's own.
    sendChatMessageAsConfigured(broadcasterId, message)
      .then(() => res.json({ attempted: true, success: true, message }))
      .catch((err: unknown) => {
        res
          .status(500)
          .json({ attempted: true, success: false, message, error: err instanceof Error ? err.message : String(err) })
      })
  })

  // Twitch redirects here after someone authorizes (or declines) on Twitch's
  // own site — see 02 Twitch Integration for the human-facing walkthrough.
  // Both the main and bot connect flows land here (one registered redirect
  // URL) — `state` is what Twitch round-trips back to tell them apart.
  app.get('/oauth/callback', (req, res) => {
    const { code, error, error_description: errorDescription, state } = req.query as {
      code?: string
      error?: string
      error_description?: string
      state?: string
    }
    const purpose: ConnectionPurpose = state === 'bot' ? 'bot' : 'main'

    if (error) {
      res.status(400).send(oauthResultPage(false, errorDescription ?? error))
      return
    }
    if (!code) {
      res.status(400).send(oauthResultPage(false, 'No authorization code was returned by Twitch.'))
      return
    }

    handleOAuthCallback(code, purpose)
      .then(({ login }) => {
        // Chat-reading (commands) is always tied to the main account —
        // connecting a bot never needs to (re)start this.
        if (purpose === 'main') startChatListener()
        const label = purpose === 'bot' ? `Bot connected as ${login}.` : `Connected as ${login}.`
        res.send(oauthResultPage(true, label))
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        res.status(500).send(oauthResultPage(false, message))
      })
  })

  // Phase 1 debug routes — let us (and Noah) see raw ingested events without
  // waiting for the real Phase 3 dashboard. Not the final API shape; Phase 2
  // adds the real season/day/leaderboard aggregation routes.
  app.get('/api/debug/races', (_req, res) => {
    const db = getDb()
    res.json(db.prepare('SELECT * FROM race_events ORDER BY id DESC LIMIT 20').all())
  })
  app.get('/api/debug/tilts', (_req, res) => {
    const db = getDb()
    res.json(db.prepare('SELECT * FROM tilt_events ORDER BY id DESC LIMIT 20').all())
  })
  app.get('/api/debug/royales', (_req, res) => {
    const db = getDb()
    res.json(db.prepare('SELECT * FROM royale_events ORDER BY id DESC LIMIT 20').all())
  })
  app.get('/api/debug/seasons', (_req, res) => {
    const db = getDb()
    res.json(db.prepare('SELECT * FROM seasons ORDER BY id DESC').all())
  })

  // Phase 4 — serves the built renderer output over HTTP so OBS's Browser
  // Source (which needs a real URL, unlike the desktop window's loadFile())
  // can reach the overlay. __dirname here is out/main/ (electron-vite bundles
  // the whole main process into one file), so '../renderer' is out/renderer/.
  // Only reflects whatever the last `npm run build` produced — the dev-mode
  // hot-reload server the desktop window uses doesn't drive this route; run
  // `npm run build` after overlay changes for OBS to see them.
  //
  // Three routes, not one: split into independent Browser Sources per Noah's
  // request, so each piece can be sized and positioned separately in OBS
  // instead of being stuck together on one shared page at fixed relative
  // positions. overlay-daily-stats is the newest (today's points/HS/races
  // at a glance) — same split rationale as toast vs. leaderboard.
  //
  // Flat names (/overlay-toast, not /overlay/toast) are load-bearing, not
  // stylistic: electron-vite's renderer build emits relative asset paths
  // (needed for the desktop window's file:// loadFile() to work), and a
  // route with a real second path segment makes the browser resolve those
  // relative to /overlay/ instead of /, 404ing every asset. A single flat
  // segment resolves the same way the working /overlay route always did.
  // Confirmed by hitting this for real: nested paths screenshotted as a
  // blank page with console 404s before this fix.
  app.use(express.static(join(__dirname, '../renderer')))
  app.get('/overlay-toast', (_req, res) => {
    res.sendFile(join(__dirname, '../renderer/overlay-toast.html'))
  })
  app.get('/overlay-leaderboard', (_req, res) => {
    res.sendFile(join(__dirname, '../renderer/overlay-leaderboard.html'))
  })
  app.get('/overlay-daily-stats', (_req, res) => {
    res.sendFile(join(__dirname, '../renderer/overlay-daily-stats.html'))
  })

  const httpServer = createServer(app)
  const wss = new WebSocketServer({ server: httpServer })
  registerWss(wss)
  wss.on('connection', (socket) => {
    socket.send(JSON.stringify({ type: 'hello', message: 'MarbleGrid backend connected' }))
  })

  await new Promise<void>((resolvePromise) => {
    httpServer.listen(port, '127.0.0.1', () => resolvePromise())
  })

  // eslint-disable-next-line no-console
  console.log(`MarbleGrid backend listening on http://127.0.0.1:${port}`)
}

/** Plain, dependency-free HTML for the one-off tab Twitch's redirect lands on — dark theme to match, no build step needed for a single static page. */
function oauthResultPage(success: boolean, detail: string): string {
  const color = success ? '#7dfe9c' : '#ff6b6b'
  const heading = success ? 'Connected!' : 'Connection failed'
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>MarbleGrid — Twitch</title>
<style>
  body { background: #0a0a0f; color: #fff; font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
         display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
  .card { background: #13131c; border: 1px solid rgba(255,255,255,0.08); border-radius: 16px;
          padding: 32px 40px; max-width: 420px; text-align: center; }
  h1 { color: ${color}; font-size: 22px; margin: 0 0 12px; }
  p { color: #a3a3b8; font-size: 14px; line-height: 1.5; margin: 0; }
</style></head>
<body><div class="card"><h1>${heading}</h1><p>${escapeHtml(detail)}</p>
<p style="margin-top:16px;">You can close this tab and return to MarbleGrid.</p></div></body></html>`
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
