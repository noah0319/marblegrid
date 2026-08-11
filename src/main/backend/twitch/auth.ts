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
// 02 Twitch Integration. Adding this scope after user:write:chat was
// already granted requires Noah to reconnect (Twitch scopes aren't
// upgradeable on an existing token without a fresh consent screen).
const SCOPES = ['user:write:chat', 'user:read:chat']

let authProvider: RefreshingAuthProvider | null = null
let apiClient: ApiClient | null = null

/** Builds (or reuses) the auth provider + API client from whatever's currently saved, resuming a prior session if present. */
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
    authProvider.onRefresh((userId, token) => {
      updateSettings({ token, userId })
    })

    apiClient = new ApiClient({ authProvider })

    if (settings.token && settings.userId) {
      authProvider.addUser(settings.userId, settings.token, ['chat'])
    }
  }

  return authProvider
}

/** The URL to send Noah's browser to — Twitch's own site, never MarbleGrid's. */
export function getAuthorizeUrl(): string {
  const settings = getSettings()
  if (!settings.clientId) {
    throw new Error('Twitch Client ID not configured yet — set it in Settings first.')
  }
  const params = new URLSearchParams({
    client_id: settings.clientId,
    redirect_uri: OAUTH_REDIRECT_URI,
    response_type: 'code',
    scope: SCOPES.join(' ')
  })
  return `https://id.twitch.tv/oauth2/authorize?${params.toString()}`
}

/** Called by the /oauth/callback route once Twitch redirects back with a code. */
export async function handleOAuthCallback(code: string): Promise<{ userId: string; login: string }> {
  const provider = ensureProvider()
  const userId = await provider.addUserForCode(code, ['chat'])
  const token = await provider.getAccessTokenForUser(userId)
  if (token) {
    updateSettings({ token, userId })
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
  updateSettings({ login })

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

export function isConnected(): boolean {
  const settings = getSettings()
  return Boolean(settings.token && settings.userId)
}

export function disconnect(): void {
  updateSettings({ token: null, userId: null, login: null })
  authProvider = null
  apiClient = null
}
