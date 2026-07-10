import { resolveAddonLocalEndpointUrl } from '@navet/app/utils/home-assistant-connection-target';

export const MUSIC_API_BASE_PATH = '/__navet_music__';

export type MusicConfigurationSource = 'stored' | 'environment' | 'none';

export interface MusicConfigurationStatus {
  spotify: {
    configured: boolean;
    source: MusicConfigurationSource;
    clientIdHint: string | null;
    redirectUri: string;
  };
}

export interface MusicConfigurationPatch {
  spotifyClientId?: string | null;
  spotifyRedirectUri?: string | null;
}

export type SpotifyRedirectUriIssue = 'invalid' | 'localhost' | 'https-required';

export function getSpotifyRedirectUriIssue(value: string): SpotifyRedirectUriIssue | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return 'invalid';
  }

  if (url.protocol === 'https:') return null;
  if (url.protocol !== 'http:') return 'invalid';
  if (url.hostname === 'localhost') return 'localhost';
  if (url.hostname === '127.0.0.1' || url.hostname === '[::1]') return null;
  return 'https-required';
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
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error || `Music service request failed (${response.status})`);
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

export function clearMusicConfiguration(signal?: AbortSignal) {
  return fetchMusicJson<MusicConfigurationStatus>('/config', { method: 'DELETE' }, signal);
}
