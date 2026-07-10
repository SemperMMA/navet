import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export interface MusicServiceConfigData {
  spotifyClientId?: string
  spotifyRedirectUri?: string
}

export type MusicServiceConfigPatch = {
  [Key in keyof MusicServiceConfigData]?: MusicServiceConfigData[Key] | null
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

export function isSecureSpotifyRedirectUri(value: string): boolean {
  try {
    const url = new URL(value)
    return (
      url.protocol === 'https:' ||
      (url.protocol === 'http:' &&
        (url.hostname === '127.0.0.1' || url.hostname === '[::1]'))
    )
  } catch {
    return false
  }
}

export function isValidMusicServiceConfig(value: unknown): value is MusicServiceConfigData {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  const config = value as Record<string, unknown>
  const allowedKeys = new Set(['spotifyClientId', 'spotifyRedirectUri'])
  if (Object.keys(config).some((key) => !allowedKeys.has(key))) {
    return false
  }

  if (
    config.spotifyClientId !== undefined &&
    readOptionalString(config.spotifyClientId) === undefined
  ) {
    return false
  }
  if (config.spotifyRedirectUri !== undefined) {
    const redirectUri = readOptionalString(config.spotifyRedirectUri)
    if (!redirectUri || !isSecureSpotifyRedirectUri(redirectUri)) {
      return false
    }
  }

  return true
}

export function isValidMusicServiceConfigPatch(value: unknown): value is MusicServiceConfigPatch {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  const patch = value as Record<string, unknown>
  const allowedKeys = new Set(['spotifyClientId', 'spotifyRedirectUri'])
  if (Object.keys(patch).length === 0 || Object.keys(patch).some((key) => !allowedKeys.has(key))) {
    return false
  }

  return (
    Object.values(patch).every(
      (entry) => entry === null || (typeof entry === 'string' && entry.trim().length > 0)
    ) &&
    (typeof patch.spotifyRedirectUri !== 'string' ||
      isSecureSpotifyRedirectUri(patch.spotifyRedirectUri))
  )
}

export function createViteMusicConfigStore(
  configFilePath = path.resolve(process.cwd(), '.cache', 'navet-music-config.json')
) {
  let config = loadPersistedMusicConfig(configFilePath)

  return {
    getConfig(): MusicServiceConfigData {
      return { ...config }
    },
    updateConfig(patch: MusicServiceConfigPatch): MusicServiceConfigData {
      const next = { ...config }
      for (const [key, value] of Object.entries(patch) as Array<
        [keyof MusicServiceConfigData, string | null]
      >) {
        if (value === null) {
          delete next[key]
        } else {
          next[key] = value.trim()
        }
      }

      const serialized = JSON.stringify(next)
      const directory = path.dirname(configFilePath)
      const temporaryPath = `${configFilePath}.tmp`
      mkdirSync(directory, { recursive: true })
      writeFileSync(temporaryPath, serialized, { encoding: 'utf8', mode: 0o600 })
      renameSync(temporaryPath, configFilePath)
      config = next
      return { ...config }
    },
    clearConfig() {
      config = {}
      rmSync(configFilePath, { force: true })
    },
  }
}

function loadPersistedMusicConfig(configFilePath: string): MusicServiceConfigData {
  try {
    const parsed = JSON.parse(readFileSync(configFilePath, 'utf8'))
    if (isValidMusicServiceConfig(parsed)) return parsed
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}

    // Preserve Spotify values while dropping the legacy user-supplied Apple developer token.
    const legacy = parsed as Record<string, unknown>
    const migrated = {
      ...(readOptionalString(legacy.spotifyClientId)
        ? { spotifyClientId: readOptionalString(legacy.spotifyClientId) }
        : {}),
      ...(readOptionalString(legacy.spotifyRedirectUri)
        ? { spotifyRedirectUri: readOptionalString(legacy.spotifyRedirectUri) }
        : {}),
    }
    if (!isValidMusicServiceConfig(migrated)) return {}
    if ('appleMusicDeveloperToken' in legacy) {
      writeFileSync(configFilePath, JSON.stringify(migrated), { encoding: 'utf8', mode: 0o600 })
    }
    return migrated
  } catch {
    return {}
  }
}
