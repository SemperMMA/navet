import path from 'node:path'
import type { InstallationCookieNames } from './installation-cookie-scope'
import { createInstallationCookieNames } from './installation-cookie-scope'
import {
  createViteProviderSessionStore,
  type ViteProviderSessionStore,
} from './vite-provider-session-store'

export const MUSIC_SESSION_COOKIE_NAME = 'navet_music_session'
export const MUSIC_OAUTH_PENDING_TTL_MS = 10 * 60 * 1000
const MUSIC_SESSION_RECORD_MAX_BYTES = 32 * 1024

export interface SpotifySessionData {
  accessToken: string
  refreshToken: string
  expiresAt: number
  displayName?: string
  subscription?: string
  scope?: string
}

export interface MusicOAuthPendingData {
  verifier: string
  state: string
  expiresAt: number
}

export interface SoundCloudSessionData {
  accessToken: string
  refreshToken: string
  expiresAt: number
  displayName?: string
  avatarUrl?: string
  scope?: string
}

export interface YouTubeSessionData {
  accessToken: string
  refreshToken: string
  expiresAt: number
  displayName?: string
  avatarUrl?: string
  scope?: string
}

export interface ViteStoredMusicSession {
  version: 1
  createdAt: number
  updatedAt: number
  auth: SpotifySessionData | null
  pending: MusicOAuthPendingData | null
  soundcloudAuth?: SoundCloudSessionData | null
  soundcloudPending?: MusicOAuthPendingData | null
  youtubeAuth?: YouTubeSessionData | null
  youtubePending?: MusicOAuthPendingData | null
}

export function isValidSpotifySessionData(value: unknown): value is SpotifySessionData {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const session = value as Partial<SpotifySessionData>
  return (
    typeof session.accessToken === 'string' &&
    session.accessToken.length > 0 &&
    typeof session.refreshToken === 'string' &&
    session.refreshToken.length > 0 &&
    typeof session.expiresAt === 'number' &&
    Number.isFinite(session.expiresAt) &&
    (session.displayName === undefined || typeof session.displayName === 'string') &&
    (session.subscription === undefined || typeof session.subscription === 'string') &&
    (session.scope === undefined || typeof session.scope === 'string')
  )
}

export function isValidMusicOAuthPendingData(
  value: unknown
): value is MusicOAuthPendingData {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const pending = value as Partial<MusicOAuthPendingData>
  return (
    typeof pending.verifier === 'string' &&
    pending.verifier.length >= 43 &&
    pending.verifier.length <= 128 &&
    typeof pending.state === 'string' &&
    /^[a-f0-9]{64}$/.test(pending.state) &&
    typeof pending.expiresAt === 'number' &&
    Number.isFinite(pending.expiresAt)
  )
}

export function isValidSoundCloudSessionData(
  value: unknown
): value is SoundCloudSessionData {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const session = value as Partial<SoundCloudSessionData>
  return (
    typeof session.accessToken === 'string' &&
    session.accessToken.length > 0 &&
    typeof session.refreshToken === 'string' &&
    session.refreshToken.length > 0 &&
    typeof session.expiresAt === 'number' &&
    Number.isFinite(session.expiresAt) &&
    (session.displayName === undefined || typeof session.displayName === 'string') &&
    (session.avatarUrl === undefined || typeof session.avatarUrl === 'string') &&
    (session.scope === undefined || typeof session.scope === 'string')
  )
}

export function isValidYouTubeSessionData(value: unknown): value is YouTubeSessionData {
  return isValidSoundCloudSessionData(value)
}

export function isValidStoredMusicSession(value: unknown): value is ViteStoredMusicSession {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const session = value as Partial<ViteStoredMusicSession>
  return (
    session.version === 1 &&
    typeof session.createdAt === 'number' &&
    Number.isFinite(session.createdAt) &&
    typeof session.updatedAt === 'number' &&
    Number.isFinite(session.updatedAt) &&
    (session.auth === null || isValidSpotifySessionData(session.auth)) &&
    (session.pending === null || isValidMusicOAuthPendingData(session.pending)) &&
    (session.soundcloudAuth === undefined ||
      session.soundcloudAuth === null ||
      isValidSoundCloudSessionData(session.soundcloudAuth)) &&
    (session.soundcloudPending === undefined ||
      session.soundcloudPending === null ||
      isValidMusicOAuthPendingData(session.soundcloudPending)) &&
    (session.youtubeAuth === undefined ||
      session.youtubeAuth === null ||
      isValidYouTubeSessionData(session.youtubeAuth)) &&
    (session.youtubePending === undefined ||
      session.youtubePending === null ||
      isValidMusicOAuthPendingData(session.youtubePending))
  )
}

function createEmptyStoredMusicSession(): ViteStoredMusicSession {
  const now = Date.now()
  return {
    version: 1,
    createdAt: now,
    updatedAt: now,
    auth: null,
    pending: null,
    soundcloudAuth: null,
    soundcloudPending: null,
    youtubeAuth: null,
    youtubePending: null,
  }
}

export function createViteMusicSessionStore(
  options: {
    cookieNames?: InstallationCookieNames
    legacySessionPath?: string
    sessionsDirectory?: string
  } = {}
): ViteProviderSessionStore<ViteStoredMusicSession> {
  const cacheDirectory = path.resolve(process.cwd(), '.cache')
  return createViteProviderSessionStore({
    cookieNames:
      options.cookieNames ?? createInstallationCookieNames(MUSIC_SESSION_COOKIE_NAME),
    createRecord: createEmptyStoredMusicSession,
    isValidRecord: isValidStoredMusicSession,
    isActiveRecord: (record, now) =>
      Boolean(
        record.auth ||
        record.soundcloudAuth ||
          record.youtubeAuth ||
          (record.pending && record.pending.expiresAt >= now) ||
          (record.soundcloudPending && record.soundcloudPending.expiresAt >= now) ||
          (record.youtubePending && record.youtubePending.expiresAt >= now)
      ),
    isAuthenticatedRecord: (record) =>
      Boolean(record.auth || record.soundcloudAuth || record.youtubeAuth),
    legacySessionPath:
      options.legacySessionPath ?? path.join(cacheDirectory, 'navet-music-spotify-session.json'),
    maxRecordBytes: MUSIC_SESSION_RECORD_MAX_BYTES,
    sessionsDirectory:
      options.sessionsDirectory ??
      path.join(cacheDirectory, 'navet-provider-sessions', 'music'),
  })
}
