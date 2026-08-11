import express from 'express'
import { createServer } from 'http'
import { WebSocketServer } from 'ws'

/**
 * Local-only Express + WebSocket server. Binds to 127.0.0.1 only — this is a
 * personal desktop app (Electron renderer + OBS browser source are the only
 * two intended clients), so there's no LAN/internet exposure to defend and
 * no auth needed on the local API.
 *
 * Phase 0: just proves the process/window/API loop works end to end.
 * Phase 1+: real routes land in ./routes, watcher pushes over ws in ./ws.ts.
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
    res.json({ status: 'OK', app: 'MarbleGrid', phase: 0 })
  })

  const httpServer = createServer(app)
  const wss = new WebSocketServer({ server: httpServer })
  wss.on('connection', (socket) => {
    socket.send(JSON.stringify({ type: 'hello', message: 'MarbleGrid backend connected' }))
  })

  await new Promise<void>((resolvePromise) => {
    httpServer.listen(port, '127.0.0.1', () => resolvePromise())
  })

  // eslint-disable-next-line no-console
  console.log(`MarbleGrid backend listening on http://127.0.0.1:${port}`)
}
