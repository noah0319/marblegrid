import express from 'express'
import { createServer } from 'http'
import { join } from 'path'
import { shell } from 'electron'
import { WebSocketServer } from 'ws'
import { registerWss } from './ws.ts'
import { getDb } from './db/db.ts'
import { getOpenSeasonId } from './db/queries/seasons.ts'
import { getSeasonStats, getTodayStats } from './db/queries/stats.ts'
import { getLeaderboard } from './db/queries/leaderboard.ts'
import { getLatestEvent } from './db/queries/latestEvent.ts'
import { DEFAULT_DAY_BOUNDARY_HOUR } from '../../shared/constants.ts'
import { getSettings, updateSettings } from './twitch/settingsStore.ts'
import {
  getAuthorizeUrl,
  handleOAuthCallback,
  isConnected,
  disconnect,
  getApiClient,
  getBroadcasterUserId
} from './twitch/auth.ts'
import { sendTestPost } from './twitch/chatPoster.ts'
import { buildChatMessage } from './twitch/messageTemplates.ts'
import type { TwitchStatus } from '../../shared/types.ts'

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
    res.json({ status: 'OK', app: 'MarbleGrid', phase: 5 })
  })

  // Real stats routes — Phase 2. Day-boundary hour is a hardcoded default for
  // now; Phase 3's Settings screen makes it a real per-user override.
  app.get('/api/stats/season', (_req, res) => {
    res.json(getSeasonStats(getOpenSeasonId()))
  })
  app.get('/api/stats/today', (_req, res) => {
    res.json(getTodayStats(DEFAULT_DAY_BOUNDARY_HOUR))
  })
  app.get('/api/leaderboard', (req, res) => {
    const limit = Number(req.query['limit']) || 20
    res.json(getLeaderboard(getOpenSeasonId(), limit))
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
      autoPostEnabled: settings.autoPostEnabled
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
      const url = getAuthorizeUrl()
      void shell.openExternal(url)
      res.json({ ok: true })
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  app.post('/api/twitch/disconnect', (_req, res) => {
    disconnect()
    res.json({ ok: true })
  })

  app.post('/api/twitch/auto-post', (req, res) => {
    const { enabled } = req.body as { enabled?: boolean }
    updateSettings({ autoPostEnabled: Boolean(enabled) })
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
    apiClient.chat
      .sendChatMessage(broadcasterId, message)
      .then(() => res.json({ attempted: true, success: true, message }))
      .catch((err: unknown) => {
        res
          .status(500)
          .json({ attempted: true, success: false, message, error: err instanceof Error ? err.message : String(err) })
      })
  })

  // Twitch redirects here after Noah authorizes (or declines) on Twitch's
  // own site — see 02 Twitch Integration for the human-facing walkthrough.
  app.get('/oauth/callback', (req, res) => {
    const { code, error, error_description: errorDescription } = req.query as {
      code?: string
      error?: string
      error_description?: string
    }

    if (error) {
      res.status(400).send(oauthResultPage(false, errorDescription ?? error))
      return
    }
    if (!code) {
      res.status(400).send(oauthResultPage(false, 'No authorization code was returned by Twitch.'))
      return
    }

    handleOAuthCallback(code)
      .then(({ login }) => res.send(oauthResultPage(true, `Connected as ${login}.`)))
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
  app.use(express.static(join(__dirname, '../renderer')))
  app.get('/overlay', (_req, res) => {
    res.sendFile(join(__dirname, '../renderer/overlay.html'))
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
