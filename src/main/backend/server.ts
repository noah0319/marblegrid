import express from 'express'
import { createServer } from 'http'
import { WebSocketServer } from 'ws'
import { registerWss } from './ws.ts'
import { getDb } from './db/db.ts'
import { getOpenSeasonId } from './db/queries/seasons.ts'
import { getSeasonStats, getTodayStats } from './db/queries/stats.ts'
import { getLeaderboard } from './db/queries/leaderboard.ts'
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
