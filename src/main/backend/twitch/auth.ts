import { RefreshingAuthProvider } from '@twurple/auth'
import { ApiClient } from '@twurple/api'
import { getSettings, updateSettings } from './settingsStore.ts'
import { SERVER_PORT } from '../../../shared/constants.ts'

export const OAUTH_REDIRECT_URI = `http://localhost:${SERVER_PORT}/oauth/callback`

// user:write:chat — sending race-result posts and command replies via the
// Helix Send Chat Message API.
// user:read:chat — added for chat commands (!mystats etc.): required by
// EventSub's channel.chat.message subscription for the user specified as
// the "reading user." Since Noah is both the token owner and the
// broadcaster, no additional bot/moderator scopes apply — see
// 02 Twitch Integration.
const MAIN_SCOPES = ['user:write:chat', 'user:read:chat']

// The optional bot account only ever sends — reading chat for commands
// stays on the main connection regardless — so it needs nothing beyond
// write access. Posting into Noah's channel as a DIFFERENT account still
// requires that account to be a moderator there (a plain "/mod <botname>"
// in Noah's own chat, not something MarbleGrid can do for him) — see
// sendChatMessageAsConfigured.
const BOT_SCOPES = ['user:write:chat']

export type ConnectionPurpose = 'main' | 'bot'

let authProvider: RefreshingAuthProvider | null = null
let apiClient: ApiClient | null = null

/** Builds (or reuses) the auth provider + API client from whatever's currently saved, resuming both the main and (if present) bot sessions. */
function ensureProvider(): RefreshingAuthProvider {
  const settings = getSettings()
  if (!settings.clientId || !settings.clientSecret) {
    throw new Error('Twitch Client ID/Secret not configured yet — set them in Settings first.')
  }

  if (!authProvider) {
    authProvider = new RefreshingAuthProvider({
      clientId: settings.clientId,
      clientSecret: settings.clientSecret,
      redirectUri: OAUTH_REDIRECT_URI
    })

    // Persist every refresh immediately — losing a refreshed token to an
    // app restart would silently break posting until Noah reconnects.
    // Both accounts refresh through this same handler; the userId Twurple
    // hands back is how we tell which one just refreshed.
    authProvider.onRefresh((userId, token) => {
      const current = getSettings()
      if (userId === current.botUserId) {
        updateSettings({ botToken: token })
      } else {
        updateSettings({ token, userId })
      }
    })

    apiClient = new ApiClient({ authProvider })

    if (settings.token && settings.userId) {
      authProvider.addUser(settings.userId, settings.token, ['chat'])
    }
    if (settings.botToken && settings.botUserId) {
      authProvider.addUser(settings.botUserId, settings.botToken, ['bot'])
    }
  }

  return authProvider
}

/**
 * The URL to send a browser to — Twitch's own site, never MarbleGrid's.
 * `purpose` round-trips through Twitch's `state` param so /oauth/callback
 * knows which connection a given redirect is for, since the main and bot
 * flows share the same registered redirect URI.
 */
export function getAuthorizeUrl(purpose: ConnectionPurpose = 'main'): string {
  const settings = getSettings()
  if (!settings.clientId) {
    throw new Error('Twitch Client ID not configured yet — set it in Settings first.')
  }
  const params = new URLSearchParams({
    client_id: settings.clientId,
    redirect_uri: OAUTH_REDIRECT_URI,
    response_type: 'code',
    scope: (purpose === 'bot' ? BOT_SCOPES : MAIN_SCOPES).join(' '),
    state: purpose
  })
  return `https://id.twitch.tv/oauth2/authorize?${params.toString()}`
}

/** Called by the /oauth/callback route once Twitch redirects back with a code. */
export async function handleOAuthCallback(
  code: string,
  purpose: ConnectionPurpose = 'main'
): Promise<{ userId: string; login: string }> {
  const provider = ensureProvider()
  const userId = await provider.addUserForCode(code, [purpose === 'bot' ? 'bot' : 'chat'])
  const token = await provider.getAccessTokenForUser(userId)
  if (token) {
    if (purpose === 'bot') updateSettings({ botToken: token, botUserId: userId })
    else updateSettings({ token, userId })
  }

  let login = userId
  try {
    const client = getApiClient()
    const user = await client?.users.getUserById(userId)
    if (user) login = user.name
  } catch {
    // Non-fatal — worst case Settings shows the numeric ID instead of the
    // friendly login name. The connection itself already succeeded above.
  }
  updateSettings(purpose === 'bot' ? { botLogin: login } : { login })

  return { userId, login }
}

export function getApiClient(): ApiClient | null {
  if (!apiClient) {
    try {
      ensureProvider()
    } catch {
      return null
    }
  }
  return apiClient
}

export function getBroadcasterUserId(): string | null {
  return getSettings().userId
}

export function getBotUserId(): string | null {
  return getSettings().botUserId
}

export function isConnected(): boolean {
  const settings = getSettings()
  return Boolean(settings.token && settings.userId)
}

export function isBotConnected(): boolean {
  const settings = getSettings()
  return Boolean(settings.botToken && settings.botUserId)
}

export function disconnect(): void {
  updateSettings({ token: null, userId: null, login: null })
  authProvider = null
  apiClient = null
}

export function disconnectBot(): void {
  updateSettings({ botToken: null, botUserId: null, botLogin: null })
  // Rebuilding the whole provider is the simplest correct way to drop just
  // the bot's registered user — Twurple doesn't expose a clean "remove one
  // user" call, and this is a rare, deliberate action (not a hot path), so
  // paying for a fresh ensureProvider() on the next call is a fine trade
  // for correctness over cleverness.
  authProvider = null
  apiClient = null
}

/**
 * Sends as the bot account if one is connected, otherwise as Noah's own
 * account (today's default, unchanged behavior) — this is the single place
 * every outgoing message (auto-posts, command replies, test/preview posts)
 * actually goes out through, so it's the only place that needs to know the
 * bot exists at all.
 *
 * Posting as the bot requires it to already be a moderator in the
 * broadcaster's channel — Twitch's own requirement for sending "as a
 * different user" (see HelixChatApi.sendChatMessage's docs: "If you want
 * to execute this in the context of another user, who has to be moderator
 * of the channel..."). If Noah hasn't run "/mod <botname>" in his own chat
 * yet, this just throws like any other send failure, and the caller's
 * existing retry/error-logging already handles that.
 */
export async function sendChatMessageAsConfigured(broadcasterId: string, message: string): Promise<void> {
  const client = getApiClient()
  if (!client) throw new Error('Twitch is not connected')

  const botId = getBotUserId()
  if (botId) {
    await client.asUser(botId, async (ctx) => {
      await ctx.chat.sendChatMessage(broadcasterId, message)
    })
  } else {
    await client.chat.sendChatMessage(broadcasterId, message)
  }
}
