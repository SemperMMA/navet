import { APP_VERSION } from '@navet/app/constants/app-version';
import type {
  MusicAccountStatus,
  MusicItem,
  MusicPlaybackSnapshot,
  MusicPlaybackTargetAdapter,
  MusicQueueSnapshot,
  MusicSourceAdapter,
} from '@navet/core/music';
import { fetchMusicJson } from '../music-endpoints';

type AppleMusicAttributes = {
  name?: string;
  artistName?: string;
  albumName?: string;
  durationInMillis?: number;
  contentRating?: string;
  url?: string;
  playParams?: { id?: string; kind?: string };
  artwork?: { url?: string; width?: number; height?: number };
};

type AppleMusicResource = {
  id?: string;
  type?: string;
  attributes?: AppleMusicAttributes;
};

type AppleMusicApiResponse = {
  data?: Array<{
    id?: string;
    type?: string;
    attributes?: AppleMusicAttributes;
  }>;
  results?: Record<string, { data?: AppleMusicResource[] }>;
};

type AppleMusicInstance = {
  isAuthorized?: boolean;
  storefrontId?: string;
  nowPlayingItem?: AppleMusicResource | null;
  currentPlaybackTime?: number;
  currentPlaybackDuration?: number;
  playbackState?: number;
  queue?: { items?: AppleMusicResource[]; position?: number };
  authorize(): Promise<string | undefined>;
  unauthorize(): Promise<void>;
  api: {
    music(path: string, params?: Record<string, string | number>): Promise<AppleMusicApiResponse>;
  };
  setQueue(options: Record<string, string | boolean>): Promise<unknown>;
  playLater?(options: Record<string, string | boolean>): Promise<unknown>;
  play(): Promise<void> | void;
  pause(): Promise<void> | void;
  skipToNextItem(): Promise<void>;
  skipToPreviousItem(): Promise<void>;
  seekToTime(time: number): Promise<void>;
};

type MusicKitGlobal = {
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
  if (window.MusicKit) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${APPLE_MUSICKIT_SCRIPT}"]`
    );
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Unable to load MusicKit')), {
        once: true,
      });
      return;
    }
    const script = document.createElement('script');
    script.src = APPLE_MUSICKIT_SCRIPT;
    script.async = true;
    script.addEventListener('load', () => resolve(), { once: true });
    script.addEventListener('error', () => reject(new Error('Unable to load MusicKit')), {
      once: true,
    });
    document.head.append(script);
  });
}

async function getMusicKit() {
  if (!musicKitPromise) {
    musicKitPromise = Promise.all([
      loadScript(),
      fetchMusicJson<{ developerToken: string }>('/apple/developer-token'),
    ]).then(([, token]) => {
      if (!window.MusicKit) throw new Error('MusicKit did not initialize');
      return window.MusicKit.configure({
        developerToken: token.developerToken,
        app: { name: 'Navet', build: APP_VERSION },
      });
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
    uri: attributes.url,
  };
}

function compact(items: Array<MusicItem | null>) {
  return items.filter((item): item is MusicItem => item !== null);
}

function getQueueOption(item: MusicItem): Record<string, string | boolean> {
  if (item.type === 'album') return { album: item.id, startPlaying: true };
  if (item.type === 'playlist') return { playlist: item.id, startPlaying: true };
  return { song: item.id, startPlaying: true };
}

export const appleMusicSourceAdapter: MusicSourceAdapter = {
  id: 'apple_music',
  name: 'Apple Music',
  capabilities: {
    search: true,
    library: true,
    queue: true,
    favorites: false,
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
    await (await getMusicKit()).unauthorize();
  },
  async search(query, signal) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const music = await getMusicKit();
    const storefront = music.storefrontId || 'us';
    const response = await music.api.music(`/v1/catalog/${storefront}/search`, {
      term: query,
      types: 'songs,albums,playlists',
      limit: 8,
    });
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    return compact(
      Object.values(response.results ?? {}).flatMap((section) =>
        (section.data ?? []).map(mapAppleItem)
      )
    );
  },
  async browseLibrary(signal) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const response = await (await getMusicKit()).api.music('/v1/me/recent/played/tracks', {
      limit: 20,
    });
    return compact((response.data ?? []).map(mapAppleItem));
  },
  async getPlaybackSnapshot() {
    const music = await getMusicKit();
    const item = music.nowPlayingItem ? mapAppleItem(music.nowPlayingItem) : null;
    return {
      sourceId: 'apple_music',
      targetId: 'apple-music-browser',
      state: music.playbackState === 2 ? 'playing' : item ? 'paused' : 'idle',
      currentItem: item,
      positionMs: Math.max(0, (music.currentPlaybackTime ?? 0) * 1000),
      durationMs: (music.currentPlaybackDuration ?? 0) * 1000 || item?.durationMs,
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
      },
    ];
  },
  async play(_targetId, item) {
    await (await getMusicKit()).setQueue(getQueueOption(item));
  },
  async enqueue(_targetId, item) {
    const music = await getMusicKit();
    if (!music.playLater) throw new Error('This MusicKit runtime cannot add to the queue');
    const queue = await music.playLater({ ...getQueueOption(item), startPlaying: false });
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
      throw new Error('Apple Music browser volume follows the device volume');
    }
  },
};
