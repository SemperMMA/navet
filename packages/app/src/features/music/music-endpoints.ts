import { resolveAddonLocalEndpointUrl } from '@navet/app/utils/home-assistant-connection-target';

export const MUSIC_API_BASE_PATH = '/__navet_music__';

export type MusicConfigurationSource = 'stored' | 'environment' | 'hosted' | 'none';

interface OAuthMusicConfigurationStatus {
  configured: boolean;
  source: MusicConfigurationSource;
  clientIdHint: string | null;
  secretConfigured?: boolean;
  redirectUri: string;
}

export interface MusicConfigurationStatus {
  spotify: OAuthMusicConfigurationStatus;
  apple: {
    configured: boolean;
    source: MusicConfigurationSource;
  };
  soundcloud: OAuthMusicConfigurationStatus;
  youtube: OAuthMusicConfigurationStatus;
}

export interface MusicConfigurationPatch {
  spotifyClientId?: string | null;
  spotifyRedirectUri?: string | null;
  appleMusicDeveloperToken?: string | null;
  soundcloudClientId?: string | null;
  soundcloudClientSecret?: string | null;
  soundcloudRedirectUri?: string | null;
  youtubeClientId?: string | null;
  youtubeClientSecret?: string | null;
  youtubeRedirectUri?: string | null;
}

export function resolveMusicEndpoint(path: string): string {
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return resolveAddonLocalEndpointUrl(`${MUSIC_API_BASE_PATH}${suffix}`);
}

export async function fetchMusicJson<T>(
  path: string,
  init?: RequestInit,
  signal?: AbortSignal
): Promise<T> {
  const response = await fetch(resolveMusicEndpoint(path), {
    credentials: 'same-origin',
    ...init,
    signal: signal ?? init?.signal,
    headers: {
      Accept: 'application/json',
      ...init?.headers,
    },
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: string | { message?: string };
    } | null;
    const message =
      typeof payload?.error === 'string'
        ? payload.error
        : typeof payload?.error?.message === 'string'
          ? payload.error.message
          : null;
    throw new Error(message || `Music service request failed (${response.status})`);
  }

  if (response.status === 204) {
    return null as T;
  }

  return (await response.json()) as T;
}

export function loadMusicConfiguration(signal?: AbortSignal) {
  return fetchMusicJson<MusicConfigurationStatus>('/config', undefined, signal);
}

export function saveMusicConfiguration(patch: MusicConfigurationPatch, signal?: AbortSignal) {
  return fetchMusicJson<MusicConfigurationStatus>(
    '/config',
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    },
    signal
  );
}
