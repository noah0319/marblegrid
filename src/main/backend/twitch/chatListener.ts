import { EventSubWsListener } from '@twurple/eventsub-ws'
import { getApiClient, getBroadcasterUserId, sendChatMessageAsConfigured } from './auth.ts'
import { handleChatCommand } from './commands.ts'

/**
 * Reads chat for viewer commands (!mystats, !top10today, etc.) — the first
 * time MarbleGrid has ever needed to READ chat, not just post to it, which
 * is why user:read:chat got added to the OAuth scope list. Uses EventSub
 * over WebSocket (not IRC/@twurple/chat), matching the Helix-first approach
 * the rest of the Twitch integration already uses.
 *
 * Deliberately separate from chatPoster.ts's chat_post_log-backed pipeline
 * — command replies are interactive Q&A, not race-result auto-posts, and
 * must never share that dedupe bookkeeping.
 */
let listener: EventSubWsListener | null = null

// listener.isActive only reflects the WebSocket connection to Twitch's
// EventSub gateway — that connection succeeds regardless of scope. The
// *subscription* to channel.chat.message is what actually needs
// user:read:chat, and rejects separately/asynchronously if it's missing
// (confirmed live: isActive read true against an old write-only-scope
// token that had never been granted read access). Tracking the real
// subscription outcome directly instead, so Settings' "not active yet,
// please reconnect" hint is trustworthy rather than just checking socket
// connectivity.
let subscriptionConfirmed = false

export function startChatListener(): void {
  if (listener) return // already running — avoid double subscriptions/replies

  const apiClient = getApiClient()
  const broadcasterId = getBroadcasterUserId()
  if (!apiClient || !broadcasterId) return

  subscriptionConfirmed = false

  try {
    const newListener = new EventSubWsListener({ apiClient })

    newListener.onUserSocketDisconnect((userId, error) => {
      if (error) {
        // eslint-disable-next-line no-console
        console.error(`MarbleGrid: chat command listener disconnected (user ${userId}):`, error)
      }
    })

    const subscription = newListener.onChannelChatMessage(broadcasterId, broadcasterId, (event) => {
      const reply = handleChatCommand(event.messageText, {
        chatterId: event.chatterId,
        chatterName: event.chatterName,
        chatterDisplayName: event.chatterDisplayName
      })
      if (!reply) return

      // Routes through the bot account if one's connected, else Noah's own.
      sendChatMessageAsConfigured(broadcasterId, reply).catch((err: unknown) => {
        // eslint-disable-next-line no-console
        console.error('MarbleGrid: failed to send chat command reply:', err)
      })
    })

    newListener.onSubscriptionCreateSuccess((sub) => {
      if (sub === subscription) subscriptionConfirmed = true
    })
    newListener.onSubscriptionCreateFailure((sub, error) => {
      if (sub === subscription) {
        subscriptionConfirmed = false
        // eslint-disable-next-line no-console
        console.error(
          'MarbleGrid: chat command subscription rejected (likely needs a reconnect for the ' +
            'user:read:chat permission — Disconnect then Connect again in Settings):',
          error
        )
      }
    })

    newListener.start()
    listener = newListener
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('MarbleGrid: failed to start chat command listener:', err)
    listener = null
  }
}

export function stopChatListener(): void {
  listener?.stop()
  listener = null
  subscriptionConfirmed = false
}

export function isChatListenerActive(): boolean {
  return subscriptionConfirmed
}
