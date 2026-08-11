import type { WebSocketServer, WebSocket } from 'ws'
import type { WsMessage } from '../../shared/types.ts'

let wss: WebSocketServer | null = null

export function registerWss(server: WebSocketServer): void {
  wss = server
}

export function broadcast(message: WsMessage): void {
  if (!wss) return
  const payload = JSON.stringify(message)
  for (const client of wss.clients as Set<WebSocket>) {
    if (client.readyState === client.OPEN) {
      client.send(payload)
    }
  }
}
