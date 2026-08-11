import express from 'express'
import { createServer } from 'http'
import { join } from 'path'
import { WebSocketServer } from 'ws'
import { registerWss } from './ws.ts'
import { getDb } from './db/db.ts'
import { getOpenSeasonId } from './db/queries/seasons.ts'
import { getSeasonStats, getTodayStats } from './db/queries/stats.ts'
import { getLeaderboard } from './db/queries/leaderboard.ts'
import { getLatestEvent } from './db/queries/latestEvent.ts'
import { DEFAULT_DAY_BOUNDARY_HOUR } from '../../shared/constants.ts'

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
  app.use((_req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*')
    next()
  })

  app.get('/api/status', (_req, res) => {
    res.json({ status: 'OK', app: 'MarbleGrid', phase: 3 })
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
