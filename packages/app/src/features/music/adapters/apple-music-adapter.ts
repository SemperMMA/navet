import { APP_VERSION } from '@navet/app/constants/app-version';
import {
  createMusicItemKey,
  type MusicAccountStatus,
  type MusicBrowseSection,
  type MusicItem,
  type MusicPlaybackSnapshot,
  type MusicPlaybackTargetAdapter,
  type MusicPlaylistDestination,
  type MusicQueueSnapshot,
  type MusicSourceAdapter,
} from '@navet/core/music';
import { fetchMusicJson } from '../music-endpoints';
import { loadExternalBrowserScript } from './browser-player-loader';

type AppleMusicAttributes = {
  name?: string;
  artistName?: string;
  albumName?: string;
  durationInMillis?: number;
  contentRating?: string;
  canEdit?: boolean;
  inFavorites?: boolean;
  url?: string;
  playParams?: { id?: string; kind?: string };
  artwork?: { url?: string; width?: number; height?: number };
  title?: { stringForDisplay?: string };
};

type AppleMusicResource = {
  id?: string;
  type?: string;
  attributes?: AppleMusicAttributes;
  relationships?: Record<string, { data?: AppleMusicResource[] }>;
};

type AppleMusicApiResponse = {
  data?:
    | AppleMusicResource[]
    | {
        data?: AppleMusicResource[];
        next?: string;
        results?: Record<string, { data?: AppleMusicResource[] }>;
      };
  next?: string;
  results?: Record<string, { data?: AppleMusicResource[] }>;
};

type AppleMusicInstance = {
  isAuthorized?: boolean;
  isPlaying?: boolean;
  storefrontId?: string;
  nowPlayingItem?: AppleMusicResource | null;
  currentPlaybackTime?: number;
  currentPlaybackDuration?: number;
  playbackState?: number;
  repeatMode?: string | number;
  shuffleMode?: string | number;
  volume?: number;
  queue?: { items?: AppleMusicResource[]; position?: number };
  authorize(): Promise<string | undefined>;
  unauthorize(): Promise<void>;
  api: {
    music(
      path: string,
      params?: Record<string, string | number | string[]>,
      options?: { fetchOptions?: RequestInit }
    ): Promise<AppleMusicApiResponse>;
  };
  setQueue(options: Record<string, string | boolean>): Promise<unknown>;
  playNext?(options: Record<string, string | boolean>): Promise<unknown>;
  playLater?(options: Record<string, string | boolean>): Promise<unknown>;
  play(): Promise<void> | void;
  pause(): Promise<void> | void;
  skipToNextItem(): Promise<void>;
  skipToPreviousItem(): Promise<void>;
  seekToTime(time: number): Promise<void>;
};

type MusicKitGlobal = {
  PlayerRepeatMode?: { all: string | number; none: string | number; one: string | number };
  PlayerShuffleMode?: { off: string | number; songs: string | number };
  configure(options: Record<string, unknown>): AppleMusicInstance;
  getInstance(): AppleMusicInstance;
};

declare global {
  interface Window {
    MusicKit?: MusicKitGlobal;
  }
}

const APPLE_MUSICKIT_SCRIPT = 'https://js-cdn.music.apple.com/musickit/v3/musickit.js';
let musicKitPromise: Promise<AppleMusicInstance> | null = null;

function loadScript() {
  return loadExternalBrowserScript({
    src: APPLE_MUSICKIT_SCRIPT,
    isReady: () => Boolean(window.MusicKit),
    errorMessage: 'Unable to load MusicKit',
  });
}

async function getMusicKit() {
  if (!musicKitPromise) {
    const pending = Promise.all([
      loadScript(),
      fetchMusicJson<{ developerToken: string }>('/apple/developer-token'),
    ]).then(([, token]) => {
      if (!window.MusicKit) throw new Error('MusicKit did not initialize');
      return window.MusicKit.configure({
        developerToken: token.developerToken,
        app: { name: 'Navet', build: APP_VERSION },
      });
    });
    musicKitPromise = pending.catch((error) => {
      musicKitPromise = null;
      throw error;
    });
  }
  return await musicKitPromise;
}

function artworkUrl(attributes?: AppleMusicAttributes) {
  return (
    attributes?.artwork?.url?.replace('{w}', '512').replace('{h}', '512').replace('{f}', 'jpg') ??
    null
  );
}

function mapAppleItem(item: AppleMusicResource): MusicItem | null {
  const attributes = item.attributes;
  if (!item.id || !attributes?.name) return null;
  const rawType = item.type ?? attributes.playParams?.kind ?? 'songs';
  const type = rawType.includes('album')
    ? 'album'
    : rawType.includes('playlist')
      ? 'playlist'
      : rawType.includes('artist')
        ? 'artist'
        : 'track';
  return {
    id: item.id,
    sourceId: 'apple_music',
    type,
    title: attributes.name,
    artists: attributes.artistName ? [attributes.artistName] : [],
    album: attributes.albumName,
    durationMs: attributes.durationInMillis,
    artworkUrl: artworkUrl(attributes),
    playable: type !== 'artist',
    explicit: attributes.contentRating === 'explicit',
    isFavorite: attributes.inFavorites,
    uri: `apple:${rawType}:${item.id}`,
  };
}

function compact(items: Array<MusicItem | null>) {
  return items.filter((item): item is MusicItem => item !== null);
}

function responseItems(response: AppleMusicApiResponse): AppleMusicResource[] {
  if (Array.isArray(response.data)) return response.data;
  return response.data?.data ?? [];
}

function responseResults(response: AppleMusicApiResponse) {
  return (
    response.results ?? (Array.isArray(response.data) ? undefined : response.data?.results) ?? {}
  );
}

function responseNext(response: AppleMusicApiResponse) {
  return response.next ?? (Array.isArray(response.data) ? undefined : response.data?.next);
}

function appleContinuation(response: AppleMusicApiResponse | null) {
  const next = response ? responseNext(response) : undefined;
  if (!next) return undefined;
  try {
    const rawOffset = new URL(next, 'https://api.music.apple.com').searchParams.get('offset');
    if (rawOffset === null) return undefined;
    const offset = Number(rawOffset);
    return Number.isSafeInteger(offset) && offset >= 0 && offset <= 100_000
      ? `offset:${offset}`
      : undefined;
  } catch {
    return undefined;
  }
}

function appleContinuationOffset(continuation: string | undefined) {
  const match = /^offset:([0-9]{1,6})$/.exec(continuation ?? '');
  if (!match) return null;
  const offset = Number(match[1]);
  return Number.isSafeInteger(offset) && offset <= 100_000 ? offset : null;
}

function section(
  id: string,
  kind: MusicBrowseSection['kind'],
  layout: MusicBrowseSection['layout'],
  items: MusicItem[],
  title?: string,
  continuation?: string
): MusicBrowseSection | null {
  return items.length
    ? {
        id,
        sourceId: 'apple_music',
        kind,
        layout,
        items,
        ...(title ? { title } : {}),
        ...(continuation ? { continuation } : {}),
      }
    : null;
}

function applePage(
  previous: MusicBrowseSection,
  response: AppleMusicApiResponse
): MusicBrowseSection {
  return {
    ...previous,
    items: compact(responseItems(response).map(mapAppleItem)),
    continuation: appleContinuation(response),
  };
}

function appleResourceKind(item: MusicItem) {
  if (!item.uri?.startsWith('apple:')) return '';
  return item.uri.slice('apple:'.length, item.uri.lastIndexOf(':'));
}

function getQueueOption(item: MusicItem): Record<string, string | boolean> {
  if (item.type === 'album') return { album: item.id, startPlaying: true };
  if (item.type === 'playlist') return { playlist: item.id, startPlaying: true };
  return { song: item.id, startPlaying: true };
}

function isQueueableAppleMusicItem(item: MusicItem) {
  return (
    item.sourceId === 'apple_music' &&
    item.playable &&
    (item.type === 'track' || item.type === 'album' || item.type === 'playlist') &&
    appleResourceKind(item).length > 0
  );
}

function isSavableAppleMusicItem(item: MusicItem) {
  const kind = appleResourceKind(item);
  return (
    item.sourceId === 'apple_music' &&
    !item.isFavorite &&
    ((item.type === 'track' && kind === 'songs') ||
      (item.type === 'album' && kind === 'albums') ||
      (item.type === 'playlist' && kind === 'playlists'))
  );
}

const APPLE_PLAYLIST_TRACK_KINDS = new Set([
  'songs',
  'library-songs',
  'music-videos',
  'library-music-videos',
]);

function isApplePlaylistTrack(item: MusicItem) {
  return (
    item.sourceId === 'apple_music' &&
    item.type === 'track' &&
    APPLE_PLAYLIST_TRACK_KINDS.has(appleResourceKind(item))
  );
}

function mapApplePlaylistDestination(
  playlist: AppleMusicResource
): MusicPlaylistDestination | null {
  if (
    playlist.type !== 'library-playlists' ||
    !playlist.id ||
    !/^[A-Za-z0-9._-]{1,128}$/.test(playlist.id) ||
    !playlist.attributes?.name ||
    playlist.attributes.canEdit !== true
  ) {
    return null;
  }
  return {
    id: playlist.id,
    sourceId: 'apple_music',
    title: playlist.attributes.name,
    artworkUrl: artworkUrl(playlist.attributes),
  };
}

export const appleMusicSourceAdapter: MusicSourceAdapter = {
  id: 'apple_music',
  name: 'Apple Music',
  presentation: { accentColor: '#fa2d48', icon: 'apple_music' },
  capabilities: {
    search: true,
    library: true,
    itemDetails: true,
    queue: true,
    favorites: true,
    favoriteMutation: true,
    playlistMutation: true,
    browserPlayback: true,
    playbackHandoff: false,
  },
  async getAccountStatus(): Promise<MusicAccountStatus> {
    try {
      const availability = await fetchMusicJson<MusicAccountStatus>('/apple/status');
      if (availability.state === 'unavailable') {
        return availability;
      }
      const music = await getMusicKit();
      return music.isAuthorized
        ? { state: 'connected', displayName: 'Apple Music subscriber' }
        : { state: 'disconnected' };
    } catch (error) {
      return {
        state: 'unavailable',
        reason: error instanceof Error ? error.message : 'Apple Music is unavailable',
      };
    }
  },
  async connect() {
    await (await getMusicKit()).authorize();
  },
  async disconnect() {
    const music = await getMusicKit();
    await music.pause();
    await music.unauthorize();
  },
  async search(query, signal) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const music = await getMusicKit();
    const storefront = music.storefrontId || 'us';
    const results = await Promise.allSettled([
      music.api.music(`/v1/catalog/${storefront}/search`, {
        term: query,
        types: 'songs,albums,playlists,artists',
        limit: 8,
      }),
      music.api.music('/v1/me/library/search', {
        term: query,
        types: 'library-songs,library-albums,library-playlists,library-artists',
        limit: 8,
      }),
    ]);
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const items = results.flatMap((result) =>
      result.status === 'fulfilled'
        ? compact(
            Object.values(responseResults(result.value)).flatMap((section) =>
              (section.data ?? []).map(mapAppleItem)
            )
          )
        : []
    );
    if (items.length) {
      return [...new Map(items.map((item) => [createMusicItemKey(item), item])).values()];
    }
    const failure = results.find((result) => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
    return [];
  },
  async browseLibrary(signal) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const music = await getMusicKit();
    const results = await Promise.allSettled([
      music.api.music('/v1/me/recent/played/tracks', { limit: 20 }),
      music.api.music('/v1/me/library/songs', { limit: 20 }),
      music.api.music('/v1/me/library/albums', { limit: 16 }),
      music.api.music('/v1/me/library/playlists', { limit: 16 }),
      music.api.music('/v1/me/library/artists', { limit: 16 }),
      music.api.music('/v1/me/recommendations', { limit: 10, include: 'contents' }),
    ]);
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const response = (index: number): AppleMusicApiResponse | null => {
      const result = results[index];
      return result?.status === 'fulfilled' ? result.value : null;
    };
    const items = (index: number) => {
      const result = response(index);
      return result ? compact(responseItems(result).map(mapAppleItem)) : [];
    };
    const sections = [
      section('recent', 'recent', 'list', items(0), undefined, appleContinuation(response(0))),
      section('songs', 'tracks', 'list', items(1), undefined, appleContinuation(response(1))),
      section('albums', 'albums', 'grid', items(2), undefined, appleContinuation(response(2))),
      section(
        'playlists',
        'playlists',
        'grid',
        items(3),
        undefined,
        appleContinuation(response(3))
      ),
      section('artists', 'artists', 'grid', items(4), undefined, appleContinuation(response(4))),
      ...(results[5]?.status === 'fulfilled'
        ? responseItems(results[5].value).flatMap((recommendation) => {
            const recommendedItems = compact(
              (recommendation.relationships?.contents?.data ?? []).map(mapAppleItem)
            );
            const recommendationSection = section(
              `recommendation:${recommendation.id ?? 'default'}`,
              'recommendations',
              'grid',
              recommendedItems,
              recommendation.attributes?.title?.stringForDisplay
            );
            return recommendationSection ? [recommendationSection] : [];
          })
        : []),
    ].filter((value): value is MusicBrowseSection => value !== null);
    if (sections.length) return sections;
    const failure = results.find((result) => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
    return [];
  },
  async browseItem(item, signal) {
    if (!['album', 'playlist', 'artist'].includes(item.type)) return [];
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const music = await getMusicKit();
    const rawKind = appleResourceKind(item);
    const isLibrary = rawKind.startsWith('library-');
    const plural = item.type === 'artist' ? 'artists' : `${item.type}s`;
    const relationship = item.type === 'artist' ? 'albums' : 'tracks';
    const base = isLibrary
      ? `/v1/me/library/${plural}/${encodeURIComponent(item.id)}`
      : `/v1/catalog/${music.storefrontId || 'us'}/${plural}/${encodeURIComponent(item.id)}`;
    const response = await music.api.music(`${base}/${relationship}`, { limit: 50 });
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const related = compact(responseItems(response).map(mapAppleItem));
    return related.length
      ? [
          {
            id: `detail:${rawKind}:${item.id}`,
            sourceId: 'apple_music',
            kind: item.type === 'artist' ? 'albums' : 'tracks',
            layout: item.type === 'artist' ? 'grid' : 'list',
            items: related,
            continuation: appleContinuation(response),
          },
        ]
      : [];
  },
  async browseNextPage(previous, signal) {
    if (previous.sourceId !== 'apple_music') throw new Error('Invalid Apple Music collection');
    const offset = appleContinuationOffset(previous.continuation);
    if (offset === null) throw new Error('Invalid Apple Music page cursor');
    const endpoints: Record<string, { path: string; limit: number }> = {
      recent: { path: '/v1/me/recent/played/tracks', limit: 20 },
      songs: { path: '/v1/me/library/songs', limit: 50 },
      albums: { path: '/v1/me/library/albums', limit: 25 },
      playlists: { path: '/v1/me/library/playlists', limit: 25 },
      artists: { path: '/v1/me/library/artists', limit: 25 },
    };
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const music = await getMusicKit();
    const endpoint = endpoints[previous.id];
    let path = endpoint?.path;
    let limit = endpoint?.limit;
    if (!path || !limit) {
      const detail = /^detail:(library-)?(albums|artists|playlists):([A-Za-z0-9._-]{1,128})$/.exec(
        previous.id
      );
      if (!detail) throw new Error('This Apple Music collection cannot load another page');
      const [, libraryPrefix, type, id] = detail;
      const relationship = type === 'artists' ? 'albums' : 'tracks';
      path = libraryPrefix
        ? `/v1/me/library/${type}/${encodeURIComponent(id)}/${relationship}`
        : `/v1/catalog/${music.storefrontId || 'us'}/${type}/${encodeURIComponent(id)}/${relationship}`;
      limit = 50;
    }
    const response = await music.api.music(path, { limit, offset });
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    return applePage(previous, response);
  },
  canSetFavorite: isSavableAppleMusicItem,
  async setFavorite(item, favorite) {
    if (!favorite || !isSavableAppleMusicItem(item)) {
      throw new Error('Apple Music can only add catalog music to your library');
    }
    await (await getMusicKit()).api.music(
      '/v1/me/library',
      { ids: [item.id] },
      { fetchOptions: { method: 'POST' } }
    );
  },
  async listEditablePlaylists(options) {
    const offset = options?.continuation ? appleContinuationOffset(options.continuation) : 0;
    if (offset === null) throw new Error('Invalid Apple Music playlist cursor');
    if (options?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const response = await (await getMusicKit()).api.music(
      '/v1/me/library/playlists',
      { limit: 100, offset },
      { fetchOptions: { signal: options?.signal } }
    );
    if (options?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    return {
      items: responseItems(response)
        .map(mapApplePlaylistDestination)
        .filter((playlist): playlist is MusicPlaylistDestination => playlist !== null),
      continuation: appleContinuation(response),
    };
  },
  canAddToPlaylist: isApplePlaylistTrack,
  async addToPlaylist(playlist, item) {
    const itemKind = appleResourceKind(item);
    if (
      playlist.sourceId !== 'apple_music' ||
      !/^[A-Za-z0-9._-]{1,128}$/.test(playlist.id) ||
      !isApplePlaylistTrack(item)
    ) {
      throw new Error('Apple Music cannot add this item to the selected playlist');
    }
    await (await getMusicKit()).api.music(
      `/v1/me/library/playlists/${encodeURIComponent(playlist.id)}/tracks`,
      undefined,
      {
        fetchOptions: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: [{ id: item.id, type: itemKind }] }),
        },
      }
    );
  },
  async getPlaybackSnapshot() {
    const music = await getMusicKit();
    const item = music.nowPlayingItem ? mapAppleItem(music.nowPlayingItem) : null;
    const repeatMode = window.MusicKit?.PlayerRepeatMode;
    const shuffleMode = window.MusicKit?.PlayerShuffleMode;
    return {
      sourceId: 'apple_music',
      targetId: 'apple-music-browser',
      targetAdapterId: 'apple-music-browser',
      state: music.isPlaying || music.playbackState === 2 ? 'playing' : item ? 'paused' : 'idle',
      currentItem: item,
      positionMs: Math.max(0, (music.currentPlaybackTime ?? 0) * 1000),
      durationMs: (music.currentPlaybackDuration ?? 0) * 1000 || item?.durationMs,
      volume: typeof music.volume === 'number' ? Math.max(0, Math.min(1, music.volume)) : undefined,
      shuffle: shuffleMode ? music.shuffleMode === shuffleMode.songs : undefined,
      repeat: repeatMode
        ? music.repeatMode === repeatMode.one
          ? 'one'
          : music.repeatMode === repeatMode.all
            ? 'all'
            : 'off'
        : undefined,
      updatedAt: new Date().toISOString(),
    } satisfies MusicPlaybackSnapshot;
  },
  async getQueue() {
    const music = await getMusicKit();
    return {
      sourceId: 'apple_music',
      items: compact((music.queue?.items ?? []).map(mapAppleItem)),
      currentIndex: music.queue?.position ?? null,
    } satisfies MusicQueueSnapshot;
  },
};

export const appleMusicBrowserTargetAdapter: MusicPlaybackTargetAdapter = {
  id: 'apple-music-browser',
  async listTargets(sourceId) {
    if (sourceId !== 'apple_music') return [];
    const status = await appleMusicSourceAdapter.getAccountStatus();
    return [
      {
        id: 'apple-music-browser',
        adapterId: 'apple-music-browser',
        name: 'This Navet display',
        kind: 'browser',
        sourceIds: ['apple_music'],
        available: status.state === 'connected',
        reasonUnavailable:
          status.state === 'connected' ? undefined : 'Connect Apple Music to play in this browser',
        capabilities: {
          enqueue: true,
          queuePositions: ['next', 'later'],
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
  },
  async play(_targetId, item) {
    await (await getMusicKit()).setQueue(getQueueOption(item));
  },
  canEnqueue: (_targetId, item) => isQueueableAppleMusicItem(item),
  async enqueue(_targetId, item, options) {
    if (!isQueueableAppleMusicItem(item)) {
      throw new Error('Apple Music cannot add this item to the queue');
    }
    const music = await getMusicKit();
    const position = options?.position ?? 'later';
    const insert = position === 'next' ? music.playNext : music.playLater;
    if (!insert) throw new Error(`This MusicKit runtime cannot play music ${position}`);
    const queue = await insert.call(music, { ...getQueueOption(item), startPlaying: false });
    if (!queue) throw new Error('Apple Music could not update the queue');
  },
  async execute(_targetId, command) {
    const music = await getMusicKit();
    if (command.type === 'play') await music.play();
    if (command.type === 'pause') await music.pause();
    if (command.type === 'next') await music.skipToNextItem();
    if (command.type === 'previous') await music.skipToPreviousItem();
    if (command.type === 'seek') await music.seekToTime(command.positionMs / 1000);
    if (command.type === 'set_volume') {
      music.volume = Math.max(0, Math.min(1, command.volume));
    }
    if (command.type === 'set_shuffle') {
      const modes = window.MusicKit?.PlayerShuffleMode;
      if (!modes) throw new Error('MusicKit did not expose shuffle controls');
      music.shuffleMode = command.enabled ? modes.songs : modes.off;
    }
    if (command.type === 'set_repeat') {
      const modes = window.MusicKit?.PlayerRepeatMode;
      if (!modes) throw new Error('MusicKit did not expose repeat controls');
      music.repeatMode =
        command.mode === 'one' ? modes.one : command.mode === 'all' ? modes.all : modes.none;
    }
  },
};
