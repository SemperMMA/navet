import type {
  MusicAccountStatus,
  MusicBrowseSection,
  MusicItem,
  MusicPlaybackSnapshot,
  MusicPlaybackTarget,
  MusicPlaybackTargetAdapter,
  MusicPlaylistDestination,
  MusicQueueSnapshot,
  MusicSourceAdapter,
  MusicTransportCommand,
} from '@navet/core/music';
import { fetchMusicJson, resolveMusicEndpoint } from '../music-endpoints';
import { navetMusicEngineClient } from '../music-engine-client';
import { loadExternalBrowserScript, waitForBrowserCallback } from './browser-player-loader';

interface SpotifyImage {
  url?: string;
}

interface SpotifyArtist {
  id?: string;
  uri?: string;
  name?: string;
  images?: SpotifyImage[];
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
  collaborative?: boolean;
  owner?: { id?: string };
}

interface SpotifyProfile {
  id?: string;
}

interface SpotifyPaging<T> {
  items?: T[];
  limit?: number;
  next?: string | null;
  offset?: number;
}

interface SpotifySearchResponse {
  tracks?: SpotifyPaging<SpotifyTrack>;
  albums?: SpotifyPaging<SpotifyContextItem>;
  playlists?: SpotifyPaging<SpotifyContextItem | null>;
  artists?: SpotifyPaging<SpotifyArtist>;
}

interface SpotifySavedTrack {
  track?: SpotifyTrack;
}

interface SpotifySavedAlbum {
  album?: SpotifyContextItem;
}

interface SpotifyPlaylistEntry {
  item?: SpotifyTrack | null;
  track?: SpotifyTrack | null;
}

interface SpotifyDevice {
  id?: string;
  name?: string;
  is_active?: boolean;
  is_restricted?: boolean;
  supports_volume?: boolean;
  volume_percent?: number | null;
}

interface SpotifyPlaybackResponse {
  is_playing?: boolean;
  progress_ms?: number;
  item?: SpotifyTrack | null;
  device?: SpotifyDevice;
  repeat_state?: 'off' | 'track' | 'context';
  shuffle_state?: boolean;
  timestamp?: number;
}

interface SpotifyQueueResponse {
  currently_playing?: SpotifyTrack | null;
  queue?: SpotifyTrack[];
}

interface SpotifyWebPlayer {
  activateElement(): Promise<void>;
  addListener(event: string, listener: (value: Record<string, unknown>) => void): boolean;
  connect(): Promise<boolean>;
  disconnect(): void;
}

interface SpotifyWebPlayerConstructor {
  new (options: {
    enableMediaSession: boolean;
    getOAuthToken: (callback: (accessToken: string) => void) => void;
    name: string;
    volume: number;
  }): SpotifyWebPlayer;
}

declare global {
  interface Window {
    Spotify?: { Player: SpotifyWebPlayerConstructor };
    onSpotifyWebPlaybackSDKReady?: () => void;
  }
}

const SPOTIFY_WEB_PLAYER_SCRIPT = 'https://sdk.scdn.co/spotify-player.js';
let spotifyBrowserPlayerPromise: Promise<SpotifyWebPlayer> | null = null;
let spotifyBrowserDeviceId: string | null = null;
let spotifyAccountId: string | null = null;

function loadSpotifyWebPlayerScript() {
  window.onSpotifyWebPlaybackSDKReady ??= () => undefined;
  return loadExternalBrowserScript({
    src: SPOTIFY_WEB_PLAYER_SCRIPT,
    isReady: () => Boolean(window.Spotify?.Player),
    errorMessage: 'Unable to load the Spotify browser player',
  });
}

async function getSpotifyBrowserPlayer() {
  if (!spotifyBrowserPlayerPromise) {
    const pending = loadSpotifyWebPlayerScript().then(async () => {
      if (!window.Spotify?.Player) throw new Error('Spotify browser playback did not initialize');
      const SpotifyPlayer = window.Spotify.Player;
      return await waitForBrowserCallback<SpotifyWebPlayer>((resolve, reject) => {
        const player = new SpotifyPlayer({
          name: 'Navet display',
          volume: 0.5,
          enableMediaSession: true,
          getOAuthToken: (callback) => {
            void fetchMusicJson<{ accessToken: string }>('/spotify/sdk-token')
              .then(({ accessToken }) => callback(accessToken))
              .catch((error) => {
                callback('');
                reject(
                  error instanceof Error
                    ? error
                    : new Error('Spotify could not authorize browser playback')
                );
              });
          },
        });
        player.addListener('ready', (event) => {
          const deviceId = event.device_id;
          if (typeof deviceId !== 'string' || !deviceId) {
            reject(new Error('Spotify did not provide a browser device'));
            return;
          }
          spotifyBrowserDeviceId = deviceId;
          resolve(player);
        });
        player.addListener('not_ready', (event) => {
          if (event.device_id === spotifyBrowserDeviceId) spotifyBrowserDeviceId = null;
        });
        for (const event of [
          'account_error',
          'authentication_error',
          'initialization_error',
          'playback_error',
        ]) {
          player.addListener(event, (value) => {
            const message = typeof value.message === 'string' ? value.message : undefined;
            reject(new Error(message || 'Spotify browser playback is unavailable'));
          });
        }
        void player.connect().then((connected) => {
          if (!connected) reject(new Error('Spotify browser playback could not connect'));
        }, reject);
      }, 'Spotify browser playback did not become ready');
    });
    spotifyBrowserPlayerPromise = pending.catch((error) => {
      spotifyBrowserPlayerPromise = null;
      spotifyBrowserDeviceId = null;
      throw error;
    });
  }
  return await spotifyBrowserPlayerPromise;
}

export function disconnectSpotifyBrowserPlayer() {
  void spotifyBrowserPlayerPromise?.then((player) => player.disconnect()).catch(() => undefined);
  spotifyBrowserPlayerPromise = null;
  spotifyBrowserDeviceId = null;
  spotifyAccountId = null;
}

const SPOTIFY_CAPABILITIES = {
  search: true,
  library: true,
  itemDetails: true,
  queue: true,
  favorites: true,
  favoriteMutation: true,
  playlistMutation: true,
  browserPlayback: true,
  playbackHandoff: true,
} as const;

function mapTrack(track: SpotifyTrack, isFavorite = false): MusicItem | null {
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
    isFavorite,
    uri: track.uri,
  };
}

function mapContextItem(
  item: SpotifyContextItem | null,
  type: 'album' | 'playlist',
  isFavorite = false
) {
  if (!item?.id || !item.name) return null;
  return {
    id: item.id,
    sourceId: 'spotify' as const,
    type,
    title: item.name,
    artists: item.artists?.flatMap((artist) => (artist.name ? [artist.name] : [])) ?? [],
    artworkUrl: item.images?.[0]?.url ?? null,
    playable: true,
    isFavorite,
    uri: item.uri,
  } satisfies MusicItem;
}

function mapArtist(artist: SpotifyArtist): MusicItem | null {
  if (!artist.id || !artist.name) return null;
  return {
    id: artist.id,
    sourceId: 'spotify',
    type: 'artist',
    title: artist.name,
    artists: [],
    artworkUrl: artist.images?.[0]?.url ?? null,
    playable: true,
    uri: artist.uri,
  };
}

function isSavableSpotifyItem(item: MusicItem): item is MusicItem & { uri: string } {
  return (
    item.sourceId === 'spotify' &&
    (item.type === 'track' || item.type === 'album' || item.type === 'playlist') &&
    item.uri?.startsWith(`spotify:${item.type}:`) === true
  );
}

function isQueueableSpotifyTrack(item: MusicItem): item is MusicItem & { uri: string } {
  return (
    item.sourceId === 'spotify' &&
    item.type === 'track' &&
    item.playable &&
    item.uri?.startsWith('spotify:track:') === true
  );
}

function mapSpotifyPlaylistDestination(
  playlist: SpotifyContextItem | null,
  accountId: string
): MusicPlaylistDestination | null {
  if (
    !playlist?.id ||
    !playlist.name ||
    (playlist.owner?.id !== accountId && playlist.collaborative !== true)
  ) {
    return null;
  }
  return {
    id: playlist.id,
    sourceId: 'spotify',
    title: playlist.name,
    artworkUrl: playlist.images?.[0]?.url ?? null,
  };
}

async function resolveSpotifyAccountId(signal?: AbortSignal) {
  if (spotifyAccountId) return spotifyAccountId;
  const profile = await fetchMusicJson<SpotifyProfile>('/spotify/api/v1/me', undefined, signal);
  if (typeof profile.id !== 'string' || !profile.id.trim() || profile.id.length > 128) {
    throw new Error('Spotify did not provide a valid account profile');
  }
  spotifyAccountId = profile.id;
  return profile.id;
}

function compactItems(items: Array<MusicItem | null>): MusicItem[] {
  return items.filter((item): item is MusicItem => item !== null);
}

function section(
  id: string,
  kind: MusicBrowseSection['kind'],
  layout: MusicBrowseSection['layout'],
  items: MusicItem[],
  continuation?: string
): MusicBrowseSection | null {
  return items.length
    ? { id, sourceId: 'spotify', kind, layout, items, ...(continuation ? { continuation } : {}) }
    : null;
}

function spotifyContinuation(page: SpotifyPaging<unknown> | null) {
  if (!page?.next) return undefined;
  try {
    const rawOffset = new URL(page.next).searchParams.get('offset');
    if (rawOffset === null) return undefined;
    const offset = Number(rawOffset);
    return Number.isSafeInteger(offset) && offset >= 0 && offset <= 100_000
      ? `offset:${offset}`
      : undefined;
  } catch {
    return undefined;
  }
}

function spotifyContinuationOffset(continuation: string | undefined) {
  const match = /^offset:([0-9]{1,6})$/.exec(continuation ?? '');
  if (!match) return null;
  const offset = Number(match[1]);
  return Number.isSafeInteger(offset) && offset <= 100_000 ? offset : null;
}

function spotifyPage(
  previous: MusicBrowseSection,
  response: SpotifyPaging<unknown>,
  items: MusicItem[]
): MusicBrowseSection {
  return {
    ...previous,
    items,
    continuation: spotifyContinuation(response),
  };
}

function fulfilled<T>(result: PromiseSettledResult<T>): T | null {
  return result.status === 'fulfilled' ? result.value : null;
}

function mapSpotifyPlayback(result: SpotifyPlaybackResponse | null): MusicPlaybackSnapshot {
  const currentItem = result?.item ? mapTrack(result.item) : null;
  return {
    sourceId: 'spotify',
    targetId: result?.device?.id ?? null,
    targetAdapterId:
      result?.device?.id && result.device.id === spotifyBrowserDeviceId
        ? 'spotify-browser'
        : 'spotify-connect',
    state: result?.is_playing ? 'playing' : currentItem ? 'paused' : 'idle',
    currentItem,
    positionMs: result?.progress_ms ?? 0,
    durationMs: currentItem?.durationMs,
    volume:
      typeof result?.device?.volume_percent === 'number'
        ? Math.max(0, Math.min(1, result.device.volume_percent / 100))
        : undefined,
    shuffle: result?.shuffle_state,
    repeat:
      result?.repeat_state === 'track' ? 'one' : result?.repeat_state === 'context' ? 'all' : 'off',
    updatedAt:
      typeof result?.timestamp === 'number'
        ? new Date(result.timestamp).toISOString()
        : new Date().toISOString(),
  };
}

function chooseSpotifyPlayback(
  engine: MusicPlaybackSnapshot | null,
  spotify: MusicPlaybackSnapshot | null
) {
  if (!engine?.currentItem) return spotify ?? engine;
  if (!spotify?.currentItem) return engine;
  const engineUpdatedAt = Date.parse(engine.updatedAt);
  const spotifyUpdatedAt = Date.parse(spotify.updatedAt);
  if (Number.isFinite(engineUpdatedAt) && Number.isFinite(spotifyUpdatedAt)) {
    return spotifyUpdatedAt >= engineUpdatedAt ? spotify : engine;
  }
  if (spotify.state === 'playing' && engine.state !== 'playing') return spotify;
  if (engine.state === 'playing' && spotify.state !== 'playing') return engine;
  return spotify;
}

export const spotifyMusicSourceAdapter: MusicSourceAdapter = {
  id: 'spotify',
  name: 'Spotify',
  presentation: { accentColor: '#1DB954', icon: 'spotify' },
  capabilities: SPOTIFY_CAPABILITIES,
  async getAccountStatus() {
    return await fetchMusicJson<MusicAccountStatus>('/spotify/status');
  },
  async connect() {
    const { authorizationUrl } = await fetchMusicJson<{ authorizationUrl: string }>(
      '/spotify/authorize',
      { method: 'POST' }
    );
    window.location.assign(authorizationUrl);
  },
  async disconnect() {
    disconnectSpotifyBrowserPlayer();
    await fetchMusicJson('/spotify/session', { method: 'DELETE' });
  },
  async search(query, signal) {
    const params = new URLSearchParams({
      q: query,
      type: 'track,album,playlist,artist',
      limit: '8',
    });
    const result = await fetchMusicJson<SpotifySearchResponse>(
      `/spotify/api/v1/search?${params}`,
      undefined,
      signal
    );
    return compactItems([
      ...(result.tracks?.items ?? []).map((track) => mapTrack(track)),
      ...(result.albums?.items ?? []).map((item) => mapContextItem(item, 'album')),
      ...(result.playlists?.items ?? []).map((item) => mapContextItem(item, 'playlist')),
      ...(result.artists?.items ?? []).map(mapArtist),
    ]);
  },
  async browseLibrary(signal) {
    const results = await Promise.allSettled([
      fetchMusicJson<SpotifyPaging<SpotifySavedTrack>>(
        '/spotify/api/v1/me/tracks?limit=20',
        undefined,
        signal
      ),
      fetchMusicJson<SpotifyPaging<SpotifyContextItem | null>>(
        '/spotify/api/v1/me/playlists?limit=20',
        undefined,
        signal
      ),
      fetchMusicJson<SpotifyPaging<SpotifySavedAlbum>>(
        '/spotify/api/v1/me/albums?limit=16',
        undefined,
        signal
      ),
      fetchMusicJson<SpotifyPaging<SpotifySavedTrack>>(
        '/spotify/api/v1/me/player/recently-played?limit=20',
        undefined,
        signal
      ),
      fetchMusicJson<SpotifyPaging<SpotifyArtist>>(
        '/spotify/api/v1/me/top/artists?limit=16&time_range=medium_term',
        undefined,
        signal
      ),
    ]);
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const savedTracks = fulfilled(results[0]);
    const playlists = fulfilled(results[1]);
    const savedAlbums = fulfilled(results[2]);
    const recent = fulfilled(results[3]);
    const artists = fulfilled(results[4]);
    const sections = [
      section(
        'liked-tracks',
        'favorites',
        'list',
        compactItems((savedTracks?.items ?? []).map((entry) => mapTrack(entry.track ?? {}, true))),
        spotifyContinuation(savedTracks)
      ),
      section(
        'playlists',
        'playlists',
        'grid',
        compactItems(
          (playlists?.items ?? []).map((item) => mapContextItem(item, 'playlist', true))
        ),
        spotifyContinuation(playlists)
      ),
      section(
        'albums',
        'albums',
        'grid',
        compactItems(
          (savedAlbums?.items ?? []).map((entry) =>
            mapContextItem(entry.album ?? null, 'album', true)
          )
        ),
        spotifyContinuation(savedAlbums)
      ),
      section(
        'recent',
        'recent',
        'list',
        compactItems((recent?.items ?? []).map((entry) => mapTrack(entry.track ?? {})))
      ),
      section(
        'top-artists',
        'artists',
        'grid',
        compactItems((artists?.items ?? []).map(mapArtist)),
        spotifyContinuation(artists)
      ),
    ].filter((value): value is MusicBrowseSection => value !== null);
    if (sections.length) return sections;
    const failure = results.find((result) => result.status === 'rejected');
    if (failure?.status === 'rejected') {
      if (
        failure.reason instanceof Error &&
        failure.reason.message.includes('Insufficient client scope')
      ) {
        throw new Error('Reconnect Spotify to load your complete music library.');
      }
      throw failure.reason;
    }
    return [];
  },
  async browseItem(item, signal) {
    if (item.type === 'album') {
      const result = await fetchMusicJson<SpotifyPaging<SpotifyTrack>>(
        `/spotify/api/v1/albums/${encodeURIComponent(item.id)}/tracks?limit=50`,
        undefined,
        signal
      );
      const items = compactItems((result.items ?? []).map((track) => mapTrack(track)));
      return items.length
        ? [
            {
              id: `album:${item.id}`,
              sourceId: 'spotify',
              kind: 'tracks',
              layout: 'list',
              items,
              continuation: spotifyContinuation(result),
            },
          ]
        : [];
    }
    if (item.type === 'playlist') {
      const result = await fetchMusicJson<SpotifyPaging<SpotifyPlaylistEntry>>(
        `/spotify/api/v1/playlists/${encodeURIComponent(item.id)}/items?limit=50`,
        undefined,
        signal
      );
      const items = compactItems(
        (result.items ?? []).map((entry) => mapTrack(entry.item ?? entry.track ?? {}))
      );
      return items.length
        ? [
            {
              id: `playlist:${item.id}`,
              sourceId: 'spotify',
              kind: 'tracks',
              layout: 'list',
              items,
              continuation: spotifyContinuation(result),
            },
          ]
        : [];
    }
    if (item.type === 'artist') {
      const result = await fetchMusicJson<SpotifyPaging<SpotifyContextItem>>(
        `/spotify/api/v1/artists/${encodeURIComponent(item.id)}/albums?limit=20`,
        undefined,
        signal
      );
      const items = compactItems(
        (result.items ?? []).map((album) => mapContextItem(album, 'album'))
      );
      return items.length
        ? [
            {
              id: `artist:${item.id}`,
              sourceId: 'spotify',
              kind: 'albums',
              layout: 'grid',
              items,
              continuation: spotifyContinuation(result),
            },
          ]
        : [];
    }
    return [];
  },
  async browseNextPage(previous, signal) {
    if (previous.sourceId !== 'spotify') throw new Error('Invalid Spotify collection');
    const offset = spotifyContinuationOffset(previous.continuation);
    if (offset === null) throw new Error('Invalid Spotify page cursor');
    if (previous.id === 'liked-tracks') {
      const response = await fetchMusicJson<SpotifyPaging<SpotifySavedTrack>>(
        `/spotify/api/v1/me/tracks?limit=50&offset=${offset}`,
        undefined,
        signal
      );
      return spotifyPage(
        previous,
        response,
        compactItems((response.items ?? []).map((entry) => mapTrack(entry.track ?? {}, true)))
      );
    }
    if (previous.id === 'playlists') {
      const response = await fetchMusicJson<SpotifyPaging<SpotifyContextItem | null>>(
        `/spotify/api/v1/me/playlists?limit=50&offset=${offset}`,
        undefined,
        signal
      );
      return spotifyPage(
        previous,
        response,
        compactItems((response.items ?? []).map((item) => mapContextItem(item, 'playlist', true)))
      );
    }
    if (previous.id === 'albums') {
      const response = await fetchMusicJson<SpotifyPaging<SpotifySavedAlbum>>(
        `/spotify/api/v1/me/albums?limit=50&offset=${offset}`,
        undefined,
        signal
      );
      return spotifyPage(
        previous,
        response,
        compactItems(
          (response.items ?? []).map((entry) => mapContextItem(entry.album ?? null, 'album', true))
        )
      );
    }
    if (previous.id === 'top-artists') {
      const response = await fetchMusicJson<SpotifyPaging<SpotifyArtist>>(
        `/spotify/api/v1/me/top/artists?limit=50&offset=${offset}&time_range=medium_term`,
        undefined,
        signal
      );
      return spotifyPage(previous, response, compactItems((response.items ?? []).map(mapArtist)));
    }
    const detail = /^(album|artist|playlist):([A-Za-z0-9]+)$/.exec(previous.id);
    if (!detail) throw new Error('This Spotify collection cannot load another page');
    const [, type, id] = detail;
    if (type === 'album') {
      const response = await fetchMusicJson<SpotifyPaging<SpotifyTrack>>(
        `/spotify/api/v1/albums/${id}/tracks?limit=50&offset=${offset}`,
        undefined,
        signal
      );
      return spotifyPage(
        previous,
        response,
        compactItems((response.items ?? []).map((track) => mapTrack(track)))
      );
    }
    if (type === 'playlist') {
      const response = await fetchMusicJson<SpotifyPaging<SpotifyPlaylistEntry>>(
        `/spotify/api/v1/playlists/${id}/items?limit=50&offset=${offset}`,
        undefined,
        signal
      );
      return spotifyPage(
        previous,
        response,
        compactItems(
          (response.items ?? []).map((entry) => mapTrack(entry.item ?? entry.track ?? {}))
        )
      );
    }
    const response = await fetchMusicJson<SpotifyPaging<SpotifyContextItem>>(
      `/spotify/api/v1/artists/${id}/albums?limit=50&offset=${offset}`,
      undefined,
      signal
    );
    return spotifyPage(
      previous,
      response,
      compactItems((response.items ?? []).map((album) => mapContextItem(album, 'album')))
    );
  },
  canSetFavorite: isSavableSpotifyItem,
  async setFavorite(item, favorite) {
    if (!isSavableSpotifyItem(item)) throw new Error('Spotify cannot save this item');
    const params = new URLSearchParams({ uris: item.uri });
    await spotifyNoContent(`/v1/me/library?${params}`, { method: favorite ? 'PUT' : 'DELETE' });
  },
  async listEditablePlaylists(options) {
    const offset = options?.continuation ? spotifyContinuationOffset(options.continuation) : 0;
    if (offset === null) throw new Error('Invalid Spotify playlist cursor');
    const [accountId, response] = await Promise.all([
      resolveSpotifyAccountId(options?.signal),
      fetchMusicJson<SpotifyPaging<SpotifyContextItem | null>>(
        `/spotify/api/v1/me/playlists?limit=50&offset=${offset}`,
        undefined,
        options?.signal
      ),
    ]);
    return {
      items: (response.items ?? [])
        .map((playlist) => mapSpotifyPlaylistDestination(playlist, accountId))
        .filter((playlist): playlist is MusicPlaylistDestination => playlist !== null),
      continuation: spotifyContinuation(response),
    };
  },
  canAddToPlaylist: isQueueableSpotifyTrack,
  async addToPlaylist(playlist, item) {
    if (
      playlist.sourceId !== 'spotify' ||
      !/^[A-Za-z0-9]+$/.test(playlist.id) ||
      !isQueueableSpotifyTrack(item)
    ) {
      throw new Error('Spotify cannot add this item to the selected playlist');
    }
    await spotifyNoContent(`/v1/playlists/${playlist.id}/items`, {
      method: 'POST',
      body: JSON.stringify({ uris: [item.uri] }),
    });
  },
  async getPlaybackSnapshot() {
    const results = await Promise.allSettled([
      navetMusicEngineClient.getPlayback(),
      fetchMusicJson<SpotifyPlaybackResponse | null>('/spotify/api/v1/me/player'),
    ]);
    const engine = fulfilled(results[0]);
    const spotify = results[1].status === 'fulfilled' ? mapSpotifyPlayback(results[1].value) : null;
    const playback = chooseSpotifyPlayback(engine, spotify);
    if (playback) return playback;
    const failure = results.find((result) => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
    return mapSpotifyPlayback(null);
  },
  async getQueue() {
    const results = await Promise.allSettled([
      navetMusicEngineClient.getQueue(),
      fetchMusicJson<SpotifyQueueResponse>('/spotify/api/v1/me/player/queue'),
    ]);
    const engineQueue = fulfilled(results[0]);
    const spotifyResult = fulfilled(results[1]);
    const currentItem = spotifyResult?.currently_playing
      ? mapTrack(spotifyResult.currently_playing)
      : null;
    const spotifyQueue = {
      sourceId: 'spotify',
      items: compactItems([
        currentItem,
        ...(spotifyResult?.queue ?? []).map((track) => mapTrack(track)),
      ]),
      currentIndex: currentItem ? 0 : null,
    } satisfies MusicQueueSnapshot;
    if (currentItem) return spotifyQueue;
    if (engineQueue?.items.length) return engineQueue;
    if (spotifyResult) return spotifyQueue;
    const failure = results.find((result) => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
    return spotifyQueue;
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
    const payload = (await response.json().catch(() => null)) as {
      error?: string | { message?: string };
    } | null;
    const message = typeof payload?.error === 'string' ? payload.error : payload?.error?.message;
    throw new Error(message || `Spotify command failed (${response.status})`);
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
              detail: 'Spotify Connect',
              reasonUnavailable: device.is_restricted
                ? 'Spotify reports this device as restricted'
                : undefined,
              isActive: device.is_active,
              capabilities: {
                enqueue: true,
                queuePositions: ['next'],
                grouping: false,
                transport: {
                  play: true,
                  pause: true,
                  next: true,
                  previous: true,
                  seek: true,
                  set_volume: device.supports_volume === true,
                  set_shuffle: true,
                  set_repeat: true,
                },
              },
            },
          ]
        : []
    );
  },
  async play(targetId, item) {
    if (!item.uri) throw new Error('Spotify did not provide a playable item');
    const body = item.type === 'track' ? { uris: [item.uri] } : { context_uri: item.uri };
    await spotifyNoContent(`/v1/me/player/play?device_id=${encodeURIComponent(targetId)}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
  },
  canEnqueue: (_targetId, item, position) => position !== 'later' && isQueueableSpotifyTrack(item),
  async enqueue(targetId, item, options) {
    if (options?.position === 'later') {
      throw new Error('Spotify can only play a track next');
    }
    if (!isQueueableSpotifyTrack(item)) {
      throw new Error('Spotify can only play individual tracks next');
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
      set_shuffle: () =>
        spotifyNoContent(
          `/v1/me/player/shuffle?${device}&state=${command.type === 'set_shuffle' && command.enabled}`,
          { method: 'PUT' }
        ),
      set_repeat: () =>
        spotifyNoContent(
          `/v1/me/player/repeat?${device}&state=${
            command.type === 'set_repeat'
              ? command.mode === 'one'
                ? 'track'
                : command.mode === 'all'
                  ? 'context'
                  : 'off'
              : 'off'
          }`,
          { method: 'PUT' }
        ),
    };
    await operations[command.type]();
  },
};

export const spotifyBrowserPlaybackTargetAdapter: MusicPlaybackTargetAdapter = {
  id: 'spotify-browser',
  async listTargets(sourceId) {
    if (sourceId !== 'spotify') return [];
    try {
      await getSpotifyBrowserPlayer();
      if (!spotifyBrowserDeviceId) throw new Error('Spotify did not provide a browser device');
      return [
        {
          id: spotifyBrowserDeviceId,
          adapterId: 'spotify-browser',
          name: 'This Navet display',
          kind: 'browser',
          sourceIds: ['spotify'],
          available: true,
          detail: 'Spotify browser player · Premium',
          capabilities: {
            enqueue: true,
            queuePositions: ['next'],
            grouping: false,
            transport: {
              play: true,
              pause: true,
              next: true,
              previous: true,
              seek: true,
              set_volume: true,
              set_shuffle: true,
              set_repeat: true,
            },
          },
        },
      ];
    } catch (error) {
      return [
        {
          id: 'spotify-browser',
          adapterId: 'spotify-browser',
          name: 'This Navet display',
          kind: 'browser',
          sourceIds: ['spotify'],
          available: false,
          reasonUnavailable:
            error instanceof Error ? error.message : 'Spotify browser playback is unavailable',
          detail: 'Spotify browser player · Premium',
          capabilities: {
            enqueue: false,
            grouping: false,
            transport: {
              play: false,
              pause: false,
              next: false,
              previous: false,
              seek: false,
              set_volume: false,
              set_shuffle: false,
              set_repeat: false,
            },
          },
        },
      ];
    }
  },
  async play(targetId, item) {
    if (!item.uri) throw new Error('Spotify did not provide a playable item');
    const player = await getSpotifyBrowserPlayer();
    if (targetId !== spotifyBrowserDeviceId) {
      throw new Error('The Spotify browser player is no longer available');
    }
    await player.activateElement();
    await spotifyNoContent('/v1/me/player', {
      method: 'PUT',
      body: JSON.stringify({ device_ids: [targetId], play: false }),
    });
    const body = item.type === 'track' ? { uris: [item.uri] } : { context_uri: item.uri };
    await spotifyNoContent(`/v1/me/player/play?device_id=${encodeURIComponent(targetId)}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
  },
  canEnqueue: (_targetId, item, position) => position !== 'later' && isQueueableSpotifyTrack(item),
  async enqueue(targetId, item, options) {
    if (options?.position === 'later') {
      throw new Error('Spotify can only play a track next');
    }
    if (!isQueueableSpotifyTrack(item)) {
      throw new Error('Spotify can only play individual tracks next');
    }
    const params = new URLSearchParams({ uri: item.uri, device_id: targetId });
    await spotifyNoContent(`/v1/me/player/queue?${params}`, { method: 'POST' });
  },
  async execute(targetId, command) {
    if (command.type === 'play') await (await getSpotifyBrowserPlayer()).activateElement();
    await spotifyPlaybackTargetAdapter.execute(targetId, command);
  },
};
