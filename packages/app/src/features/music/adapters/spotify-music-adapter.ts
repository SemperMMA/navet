import type {
  MusicAccountStatus,
  MusicItem,
  MusicPlaybackSnapshot,
  MusicPlaybackTarget,
  MusicPlaybackTargetAdapter,
  MusicQueueSnapshot,
  MusicSourceAdapter,
  MusicTransportCommand,
} from '@navet/core/music';
import { fetchMusicJson, resolveMusicEndpoint } from '../music-endpoints';

interface SpotifyImage {
  url?: string;
}

interface SpotifyArtist {
  name?: string;
}

interface SpotifyTrack {
  id?: string;
  uri?: string;
  name?: string;
  duration_ms?: number;
  explicit?: boolean;
  artists?: SpotifyArtist[];
  album?: { name?: string; images?: SpotifyImage[] };
}

interface SpotifyContextItem {
  id?: string;
  uri?: string;
  name?: string;
  type?: string;
  images?: SpotifyImage[];
  artists?: SpotifyArtist[];
}

interface SpotifyPaging<T> {
  items?: T[];
}

interface SpotifySearchResponse {
  tracks?: SpotifyPaging<SpotifyTrack>;
  albums?: SpotifyPaging<SpotifyContextItem>;
  playlists?: SpotifyPaging<SpotifyContextItem | null>;
}

interface SpotifyDevice {
  id?: string;
  name?: string;
  is_active?: boolean;
  is_restricted?: boolean;
}

interface SpotifyPlaybackResponse {
  is_playing?: boolean;
  progress_ms?: number;
  item?: SpotifyTrack | null;
  device?: SpotifyDevice;
}

interface SpotifyQueueResponse {
  currently_playing?: SpotifyTrack | null;
  queue?: SpotifyTrack[];
}

const SPOTIFY_CAPABILITIES = {
  search: true,
  library: true,
  queue: true,
  favorites: true,
  browserPlayback: false,
  playbackHandoff: true,
} as const;

function mapTrack(track: SpotifyTrack): MusicItem | null {
  if (!track.id || !track.name) return null;
  return {
    id: track.id,
    sourceId: 'spotify',
    type: 'track',
    title: track.name,
    artists: track.artists?.flatMap((artist) => (artist.name ? [artist.name] : [])) ?? [],
    album: track.album?.name,
    durationMs: track.duration_ms,
    artworkUrl: track.album?.images?.[0]?.url ?? null,
    playable: true,
    explicit: track.explicit,
    uri: track.uri,
  };
}

function mapContextItem(item: SpotifyContextItem | null, type: 'album' | 'playlist') {
  if (!item?.id || !item.name) return null;
  return {
    id: item.id,
    sourceId: 'spotify' as const,
    type,
    title: item.name,
    artists: item.artists?.flatMap((artist) => (artist.name ? [artist.name] : [])) ?? [],
    artworkUrl: item.images?.[0]?.url ?? null,
    playable: true,
    uri: item.uri,
  } satisfies MusicItem;
}

function compactItems(items: Array<MusicItem | null>): MusicItem[] {
  return items.filter((item): item is MusicItem => item !== null);
}

export const spotifyMusicSourceAdapter: MusicSourceAdapter = {
  id: 'spotify',
  name: 'Spotify',
  capabilities: SPOTIFY_CAPABILITIES,
  async getAccountStatus() {
    return await fetchMusicJson<MusicAccountStatus>('/spotify/status');
  },
  async connect() {
    window.location.assign(resolveMusicEndpoint('/spotify/authorize'));
  },
  async disconnect() {
    await fetchMusicJson('/spotify/session', { method: 'DELETE' });
  },
  async search(query, signal) {
    const params = new URLSearchParams({
      q: query,
      type: 'track,album,playlist',
      limit: '8',
    });
    const result = await fetchMusicJson<SpotifySearchResponse>(
      `/spotify/api/v1/search?${params}`,
      undefined,
      signal
    );
    return compactItems([
      ...(result.tracks?.items ?? []).map(mapTrack),
      ...(result.albums?.items ?? []).map((item) => mapContextItem(item, 'album')),
      ...(result.playlists?.items ?? []).map((item) => mapContextItem(item, 'playlist')),
    ]);
  },
  async browseLibrary(signal) {
    const result = await fetchMusicJson<{ items?: Array<{ track?: SpotifyTrack }> }>(
      '/spotify/api/v1/me/tracks?limit=20',
      undefined,
      signal
    );
    return compactItems((result.items ?? []).map((item) => mapTrack(item.track ?? {})));
  },
  async getPlaybackSnapshot() {
    const result = await fetchMusicJson<SpotifyPlaybackResponse | null>(
      '/spotify/api/v1/me/player'
    );
    const currentItem = result?.item ? mapTrack(result.item) : null;
    return {
      sourceId: 'spotify',
      targetId: result?.device?.id ?? null,
      state: result?.is_playing ? 'playing' : currentItem ? 'paused' : 'idle',
      currentItem,
      positionMs: result?.progress_ms ?? 0,
      durationMs: currentItem?.durationMs,
      updatedAt: new Date().toISOString(),
    } satisfies MusicPlaybackSnapshot;
  },
  async getQueue() {
    const result = await fetchMusicJson<SpotifyQueueResponse>('/spotify/api/v1/me/player/queue');
    const currentItem = result.currently_playing ? mapTrack(result.currently_playing) : null;
    return {
      sourceId: 'spotify',
      items: compactItems([currentItem, ...(result.queue ?? []).map(mapTrack)]),
      currentIndex: currentItem ? 0 : null,
    } satisfies MusicQueueSnapshot;
  },
};

async function spotifyNoContent(path: string, init: RequestInit) {
  const response = await fetch(resolveMusicEndpoint(`/spotify/api${path}`), {
    credentials: 'same-origin',
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error || `Spotify command failed (${response.status})`);
  }
}

export const spotifyPlaybackTargetAdapter: MusicPlaybackTargetAdapter = {
  id: 'spotify-connect',
  async listTargets(sourceId) {
    if (sourceId !== 'spotify') return [];
    const result = await fetchMusicJson<{ devices?: SpotifyDevice[] }>(
      '/spotify/api/v1/me/player/devices'
    );
    return (result.devices ?? []).flatMap((device): MusicPlaybackTarget[] =>
      device.id && device.name
        ? [
            {
              id: device.id,
              adapterId: 'spotify-connect',
              name: device.name,
              kind: 'connect',
              sourceIds: ['spotify'],
              available: !device.is_restricted,
              reasonUnavailable: device.is_restricted
                ? 'Spotify reports this device as restricted'
                : undefined,
              isActive: device.is_active,
            },
          ]
        : []
    );
  },
  async play(targetId, item) {
    const body = item.type === 'track' ? { uris: [item.uri] } : { context_uri: item.uri };
    await spotifyNoContent(`/v1/me/player/play?device_id=${encodeURIComponent(targetId)}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
  },
  async enqueue(targetId, item) {
    if (!item.uri || item.type !== 'track') {
      throw new Error('Spotify can only enqueue individual tracks');
    }
    const params = new URLSearchParams({ uri: item.uri, device_id: targetId });
    await spotifyNoContent(`/v1/me/player/queue?${params}`, { method: 'POST' });
  },
  async execute(targetId, command) {
    const device = `device_id=${encodeURIComponent(targetId)}`;
    const operations: Record<MusicTransportCommand['type'], () => Promise<void>> = {
      play: () => spotifyNoContent(`/v1/me/player/play?${device}`, { method: 'PUT' }),
      pause: () => spotifyNoContent(`/v1/me/player/pause?${device}`, { method: 'PUT' }),
      next: () => spotifyNoContent(`/v1/me/player/next?${device}`, { method: 'POST' }),
      previous: () => spotifyNoContent(`/v1/me/player/previous?${device}`, { method: 'POST' }),
      seek: () =>
        spotifyNoContent(
          `/v1/me/player/seek?${device}&position_ms=${command.type === 'seek' ? command.positionMs : 0}`,
          { method: 'PUT' }
        ),
      set_volume: () =>
        spotifyNoContent(
          `/v1/me/player/volume?${device}&volume_percent=${Math.round(
            (command.type === 'set_volume' ? command.volume : 0) * 100
          )}`,
          { method: 'PUT' }
        ),
    };
    await operations[command.type]();
  },
};
