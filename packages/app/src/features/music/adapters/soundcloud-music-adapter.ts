import type {
  MusicAccountStatus,
  MusicBrowseSection,
  MusicItem,
  MusicPlaybackSnapshot,
  MusicPlaybackTargetAdapter,
  MusicSourceAdapter,
} from '@navet/core/music';
import { fetchMusicJson } from '../music-endpoints';
import { loadExternalBrowserScript, waitForBrowserCallback } from './browser-player-loader';

export const SOUNDCLOUD_PLAYER_FRAME_ID = 'navet-soundcloud-player';
const SOUNDCLOUD_WIDGET_SCRIPT = 'https://w.soundcloud.com/player/api.js';

interface SoundCloudUser {
  id?: number | string;
  urn?: string;
  full_name?: string;
  username?: string;
  avatar_url?: string;
  permalink_url?: string;
}

interface SoundCloudTrack {
  id?: number | string;
  urn?: string;
  title?: string;
  duration?: number;
  artwork_url?: string | null;
  permalink_url?: string;
  streamable?: boolean;
  access?: 'playable' | 'preview' | 'blocked';
  user?: SoundCloudUser;
}

interface SoundCloudPlaylist {
  id?: number | string;
  urn?: string;
  title?: string;
  artwork_url?: string | null;
  permalink_url?: string;
  user?: SoundCloudUser;
}

interface SoundCloudCollection<T> {
  collection?: T[];
  next_href?: string | null;
}

interface SoundCloudWidget {
  bind(event: string, listener: (value?: unknown) => void): void;
  getPosition(callback: (position: number) => void): void;
  getDuration(callback: (duration: number) => void): void;
  getVolume(callback: (volume: number) => void): void;
  isPaused(callback: (paused: boolean) => void): void;
  load(
    url: string,
    options: {
      auto_play: boolean;
      callback: () => void;
      sharing: boolean;
      show_artwork: boolean;
      show_playcount: boolean;
      show_user: boolean;
    }
  ): void;
  next(): void;
  pause(): void;
  play(): void;
  prev(): void;
  seekTo(positionMs: number): void;
  setVolume(volume: number): void;
}

interface SoundCloudWidgetGlobal {
  (frame: HTMLIFrameElement): SoundCloudWidget;
  Events: {
    FINISH: string;
    PAUSE: string;
    PLAY: string;
    READY: string;
  };
}

declare global {
  interface Window {
    SC?: { Widget: SoundCloudWidgetGlobal };
  }
}

let widgetPromise: Promise<SoundCloudWidget> | null = null;
let widgetFrame: HTMLIFrameElement | null = null;
let currentItem: MusicItem | null = null;
let currentIndex: number | null = null;
let queueItems: MusicItem[] = [];
let playbackState: MusicPlaybackSnapshot['state'] = 'idle';

function resetSoundCloudPlayback() {
  currentItem = null;
  currentIndex = null;
  queueItems = [];
  playbackState = 'idle';
  document.getElementById(SOUNDCLOUD_PLAYER_FRAME_ID)?.classList.add('hidden');
}

function collectionItems<T>(value: T[] | SoundCloudCollection<T>): T[] {
  return Array.isArray(value) ? value : (value.collection ?? []);
}

function soundCloudContinuation<T>(value: T[] | SoundCloudCollection<T> | null) {
  if (!value || Array.isArray(value) || !value.next_href) return undefined;
  try {
    const next = new URL(value.next_href);
    if (next.protocol !== 'https:' || next.hostname !== 'api.soundcloud.com') return undefined;
    const cursor = next.searchParams.get('cursor');
    if (cursor && cursor.length <= 512 && /^[A-Za-z0-9._~-]+$/.test(cursor)) {
      return `cursor:${cursor}`;
    }
    const rawOffset = next.searchParams.get('offset');
    if (rawOffset === null) return undefined;
    const offset = Number(rawOffset);
    return Number.isSafeInteger(offset) && offset >= 0 && offset <= 100_000
      ? `offset:${offset}`
      : undefined;
  } catch {
    return undefined;
  }
}

function soundCloudContinuationQuery(continuation: string | undefined) {
  const cursor = /^cursor:([A-Za-z0-9._~-]{1,512})$/.exec(continuation ?? '');
  if (cursor) return new URLSearchParams({ cursor: cursor[1] }).toString();
  const offset = /^offset:([0-9]{1,6})$/.exec(continuation ?? '');
  if (offset && Number(offset[1]) <= 100_000) {
    return new URLSearchParams({ offset: offset[1] }).toString();
  }
  return null;
}

function soundCloudId(value: { id?: number | string; urn?: string }) {
  return value.urn ?? (value.id === undefined ? null : `soundcloud:tracks:${value.id}`);
}

function mapTrack(track: SoundCloudTrack, isFavorite = false): MusicItem | null {
  const id = soundCloudId(track);
  if (!id || !track.title || !track.permalink_url) return null;
  return {
    id,
    sourceId: 'soundcloud',
    type: 'track',
    title: track.title,
    artists: track.user?.username ? [track.user.username] : [],
    durationMs: track.duration,
    artworkUrl: track.artwork_url ?? null,
    playable: track.streamable !== false && track.access !== 'blocked',
    isFavorite,
    uri: track.permalink_url,
  };
}

function mapPlaylist(playlist: SoundCloudPlaylist, isFavorite = false): MusicItem | null {
  const id =
    playlist.urn ?? (playlist.id === undefined ? null : `soundcloud:playlists:${playlist.id}`);
  if (!id || !playlist.title || !playlist.permalink_url) return null;
  return {
    id,
    sourceId: 'soundcloud',
    type: 'playlist',
    title: playlist.title,
    artists: playlist.user?.username ? [playlist.user.username] : [],
    artworkUrl: playlist.artwork_url ?? null,
    playable: true,
    isFavorite,
    uri: playlist.permalink_url,
  };
}

function mapUser(user: SoundCloudUser, isFavorite = false): MusicItem | null {
  const id = user.urn ?? (user.id === undefined ? null : `soundcloud:users:${user.id}`);
  const title = user.full_name || user.username;
  if (!id || !title || !user.permalink_url || !isSoundCloudUrn(id, 'users')) return null;
  return {
    id,
    sourceId: 'soundcloud',
    type: 'artist',
    title,
    artists: user.username && user.username !== title ? [user.username] : [],
    artworkUrl: user.avatar_url ?? null,
    playable: false,
    isFavorite,
    uri: user.permalink_url,
  };
}

function compact(items: Array<MusicItem | null>) {
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
    ? { id, sourceId: 'soundcloud', kind, layout, items, ...(continuation ? { continuation } : {}) }
    : null;
}

function soundCloudPage<T>(
  previous: MusicBrowseSection,
  response: T[] | SoundCloudCollection<T>,
  map: (item: T) => MusicItem | null
): MusicBrowseSection {
  return {
    ...previous,
    items: compact(collectionItems(response).map((item) => map(item))),
    continuation: soundCloudContinuation(response),
  };
}

function isSoundCloudUrn(id: string, type: 'tracks' | 'playlists' | 'users') {
  return new RegExp(`^soundcloud:${type}:[0-9]+$`).test(id);
}

function soundCloudPlayableUrl(value: string | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' &&
      (url.hostname === 'soundcloud.com' || url.hostname.endsWith('.soundcloud.com'))
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function loadWidgetScript() {
  return loadExternalBrowserScript({
    src: SOUNDCLOUD_WIDGET_SCRIPT,
    isReady: () => Boolean(window.SC?.Widget),
    errorMessage: 'Unable to load the SoundCloud player',
  });
}

function callbackValue<T>(
  read: (callback: (value: T) => void) => void,
  errorMessage: string
): Promise<T> {
  return waitForBrowserCallback((resolve) => read(resolve), errorMessage);
}

function requirePlayableSoundCloudItem(item: MusicItem) {
  const playableUrl = soundCloudPlayableUrl(item.uri);
  if (item.sourceId !== 'soundcloud' || !item.playable || !playableUrl) {
    throw new Error('SoundCloud did not provide a safe playable item');
  }
  return playableUrl;
}

function isQueueableSoundCloudItem(item: MusicItem) {
  return (
    item.sourceId === 'soundcloud' &&
    item.playable &&
    (item.type === 'track' || item.type === 'playlist') &&
    soundCloudPlayableUrl(item.uri) !== null
  );
}

function isFavoriteableSoundCloudItem(item: MusicItem) {
  const resource =
    item.type === 'track'
      ? 'tracks'
      : item.type === 'playlist'
        ? 'playlists'
        : item.type === 'artist'
          ? 'users'
          : null;
  return item.sourceId === 'soundcloud' && resource !== null && isSoundCloudUrn(item.id, resource);
}

async function getWidget(item: MusicItem) {
  const frame = document.getElementById(SOUNDCLOUD_PLAYER_FRAME_ID);
  if (!(frame instanceof HTMLIFrameElement)) {
    throw new Error('The SoundCloud player is not available on this display');
  }
  if (widgetPromise && widgetFrame !== frame) {
    widgetPromise = null;
    widgetFrame = null;
  }
  frame.classList.remove('hidden');
  if (!widgetPromise) {
    widgetFrame = frame;
    const playableUrl = requirePlayableSoundCloudItem(item);
    frame.src = `https://w.soundcloud.com/player/?url=${encodeURIComponent(
      playableUrl
    )}&auto_play=false&show_artwork=true&show_user=true&show_playcount=true`;
    widgetPromise = loadWidgetScript()
      .then(async () => {
        if (!window.SC?.Widget) throw new Error('SoundCloud did not initialize');
        const soundCloudWidget = window.SC.Widget;
        const widget = soundCloudWidget(frame);
        const ready = waitForBrowserCallback<SoundCloudWidget>(
          (resolve) => widget.bind(soundCloudWidget.Events.READY, () => resolve(widget)),
          'SoundCloud player did not become ready'
        );
        widget.bind(soundCloudWidget.Events.PLAY, () => {
          playbackState = 'playing';
        });
        widget.bind(soundCloudWidget.Events.PAUSE, () => {
          playbackState = 'paused';
        });
        widget.bind(soundCloudWidget.Events.FINISH, () => {
          if (currentIndex !== null && queueItems[currentIndex + 1]) {
            currentIndex += 1;
            const next = queueItems[currentIndex];
            currentItem = next;
            const nextUrl = next ? soundCloudPlayableUrl(next.uri) : null;
            if (next?.playable && nextUrl) {
              playbackState = 'buffering';
              void waitForBrowserCallback<void>((resolve) => {
                widget.load(nextUrl, {
                  auto_play: true,
                  callback: () => {
                    widget.play();
                    resolve();
                  },
                  sharing: true,
                  show_artwork: true,
                  show_playcount: true,
                  show_user: true,
                });
              }, 'SoundCloud did not advance the queue').catch(() => {
                playbackState = 'unavailable';
              });
              return;
            }
            playbackState = 'unavailable';
            return;
          }
          playbackState = 'idle';
        });
        return await ready;
      })
      .catch((error) => {
        widgetPromise = null;
        widgetFrame = null;
        throw error;
      });
  }
  return await widgetPromise;
}

async function loadItem(item: MusicItem, replaceQueue: boolean) {
  const playableUrl = requirePlayableSoundCloudItem(item);
  const widget = await getWidget(item);
  if (replaceQueue || currentIndex === null) {
    queueItems = [item];
    currentIndex = 0;
  }
  currentItem = item;
  await waitForBrowserCallback<void>((resolve) => {
    widget.load(playableUrl, {
      auto_play: true,
      callback: () => {
        widget.play();
        resolve();
      },
      sharing: true,
      show_artwork: true,
      show_playcount: true,
      show_user: true,
    });
  }, 'SoundCloud did not start playback');
  playbackState = 'playing';
}

export const soundCloudMusicSourceAdapter: MusicSourceAdapter = {
  id: 'soundcloud',
  name: 'SoundCloud',
  presentation: { accentColor: '#ff5500', icon: 'soundcloud' },
  capabilities: {
    search: true,
    library: true,
    itemDetails: true,
    queue: true,
    favorites: true,
    favoriteMutation: true,
    browserPlayback: true,
    playbackHandoff: false,
  },
  async getAccountStatus() {
    return await fetchMusicJson<MusicAccountStatus>('/soundcloud/status');
  },
  async connect() {
    const { authorizationUrl } = await fetchMusicJson<{ authorizationUrl: string }>(
      '/soundcloud/authorize',
      { method: 'POST' }
    );
    window.location.assign(authorizationUrl);
  },
  async disconnect() {
    await fetchMusicJson('/soundcloud/session', { method: 'DELETE' });
    if (widgetPromise) {
      await widgetPromise.then((widget) => widget.pause()).catch(() => undefined);
    }
    resetSoundCloudPlayback();
  },
  async search(query, signal) {
    const params = new URLSearchParams({
      access: 'playable',
      limit: '8',
      linked_partitioning: 'true',
      q: query,
    });
    const results = await Promise.allSettled([
      fetchMusicJson<SoundCloudTrack[] | SoundCloudCollection<SoundCloudTrack>>(
        `/soundcloud/api/tracks?${params}`,
        undefined,
        signal
      ),
      fetchMusicJson<SoundCloudPlaylist[] | SoundCloudCollection<SoundCloudPlaylist>>(
        `/soundcloud/api/playlists?q=${encodeURIComponent(query)}&limit=6&linked_partitioning=true`,
        undefined,
        signal
      ),
      fetchMusicJson<SoundCloudUser[] | SoundCloudCollection<SoundCloudUser>>(
        `/soundcloud/api/users?q=${encodeURIComponent(query)}&limit=6&linked_partitioning=true`,
        undefined,
        signal
      ),
    ]);
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const tracks = results[0].status === 'fulfilled' ? results[0].value : null;
    const playlists = results[1].status === 'fulfilled' ? results[1].value : null;
    const users = results[2].status === 'fulfilled' ? results[2].value : null;
    const items = compact([
      ...(tracks ? collectionItems(tracks).map((track) => mapTrack(track)) : []),
      ...(playlists ? collectionItems(playlists).map((playlist) => mapPlaylist(playlist)) : []),
      ...(users ? collectionItems(users).map((user) => mapUser(user)) : []),
    ]);
    if (items.length) return items;
    const failure = results.find((result) => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
    return [];
  },
  async browseLibrary(signal) {
    const results = await Promise.allSettled([
      fetchMusicJson<SoundCloudTrack[] | SoundCloudCollection<SoundCloudTrack>>(
        '/soundcloud/api/me/recently-played/tracks?limit=20&linked_partitioning=true',
        undefined,
        signal
      ),
      fetchMusicJson<SoundCloudTrack[] | SoundCloudCollection<SoundCloudTrack>>(
        '/soundcloud/api/me/likes/tracks?limit=20&linked_partitioning=true',
        undefined,
        signal
      ),
      fetchMusicJson<SoundCloudPlaylist[] | SoundCloudCollection<SoundCloudPlaylist>>(
        '/soundcloud/api/me/likes/playlists?limit=16&linked_partitioning=true',
        undefined,
        signal
      ),
      fetchMusicJson<SoundCloudPlaylist[] | SoundCloudCollection<SoundCloudPlaylist>>(
        '/soundcloud/api/me/playlists?limit=16&linked_partitioning=true&show_tracks=false',
        undefined,
        signal
      ),
      fetchMusicJson<SoundCloudUser[] | SoundCloudCollection<SoundCloudUser>>(
        '/soundcloud/api/me/followings?limit=16&linked_partitioning=true',
        undefined,
        signal
      ),
    ]);
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const values = results.map((result) => (result.status === 'fulfilled' ? result.value : null));
    const sections = [
      section(
        'liked-tracks',
        'favorites',
        'list',
        compact(
          values[1]
            ? collectionItems(
                values[1] as SoundCloudTrack[] | SoundCloudCollection<SoundCloudTrack>
              ).map((track) => mapTrack(track, true))
            : []
        ),
        soundCloudContinuation(
          values[1] as SoundCloudTrack[] | SoundCloudCollection<SoundCloudTrack> | null
        )
      ),
      section(
        'playlists',
        'playlists',
        'grid',
        compact(
          values[3]
            ? collectionItems(
                values[3] as SoundCloudPlaylist[] | SoundCloudCollection<SoundCloudPlaylist>
              ).map((playlist) => mapPlaylist(playlist))
            : []
        ),
        soundCloudContinuation(
          values[3] as SoundCloudPlaylist[] | SoundCloudCollection<SoundCloudPlaylist> | null
        )
      ),
      section(
        'liked-playlists',
        'playlists',
        'grid',
        compact(
          values[2]
            ? collectionItems(
                values[2] as SoundCloudPlaylist[] | SoundCloudCollection<SoundCloudPlaylist>
              ).map((playlist) => mapPlaylist(playlist, true))
            : []
        ),
        soundCloudContinuation(
          values[2] as SoundCloudPlaylist[] | SoundCloudCollection<SoundCloudPlaylist> | null
        )
      ),
      section(
        'recent',
        'recent',
        'list',
        compact(
          values[0]
            ? collectionItems(
                values[0] as SoundCloudTrack[] | SoundCloudCollection<SoundCloudTrack>
              ).map((track) => mapTrack(track))
            : []
        ),
        soundCloudContinuation(
          values[0] as SoundCloudTrack[] | SoundCloudCollection<SoundCloudTrack> | null
        )
      ),
      section(
        'followed-artists',
        'artists',
        'grid',
        compact(
          values[4]
            ? collectionItems(
                values[4] as SoundCloudUser[] | SoundCloudCollection<SoundCloudUser>
              ).map((user) => mapUser(user, true))
            : []
        ),
        soundCloudContinuation(
          values[4] as SoundCloudUser[] | SoundCloudCollection<SoundCloudUser> | null
        )
      ),
    ].filter((value): value is MusicBrowseSection => value !== null);
    if (sections.length) return sections;
    const failure = results.find((result) => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
    return [];
  },
  async browseItem(item, signal) {
    const resource =
      item.type === 'playlist' ? 'playlists' : item.type === 'artist' ? 'users' : null;
    if (!resource || !isSoundCloudUrn(item.id, resource)) return [];
    const tracks = await fetchMusicJson<SoundCloudTrack[] | SoundCloudCollection<SoundCloudTrack>>(
      `/soundcloud/api/${resource}/${item.id}/tracks?limit=50&linked_partitioning=true`,
      undefined,
      signal
    );
    const items = compact(collectionItems(tracks).map((track) => mapTrack(track)));
    return items.length
      ? [
          {
            id: `${item.type}:${item.id}`,
            sourceId: 'soundcloud',
            kind: 'tracks',
            layout: 'list',
            items,
            continuation: soundCloudContinuation(tracks),
          },
        ]
      : [];
  },
  async browseNextPage(previous, signal) {
    if (previous.sourceId !== 'soundcloud') throw new Error('Invalid SoundCloud collection');
    const continuation = soundCloudContinuationQuery(previous.continuation);
    if (!continuation) throw new Error('Invalid SoundCloud page cursor');
    const suffix = `limit=50&linked_partitioning=true&${continuation}`;
    if (previous.id === 'liked-tracks' || previous.id === 'recent') {
      const path =
        previous.id === 'liked-tracks' ? '/me/likes/tracks' : '/me/recently-played/tracks';
      const response = await fetchMusicJson<
        SoundCloudTrack[] | SoundCloudCollection<SoundCloudTrack>
      >(`/soundcloud/api${path}?${suffix}`, undefined, signal);
      return soundCloudPage(previous, response, (track) =>
        mapTrack(track, previous.id === 'liked-tracks')
      );
    }
    if (previous.id === 'playlists' || previous.id === 'liked-playlists') {
      const path = previous.id === 'playlists' ? '/me/playlists' : '/me/likes/playlists';
      const response = await fetchMusicJson<
        SoundCloudPlaylist[] | SoundCloudCollection<SoundCloudPlaylist>
      >(`/soundcloud/api${path}?${suffix}&show_tracks=false`, undefined, signal);
      return soundCloudPage(previous, response, (playlist) =>
        mapPlaylist(playlist, previous.id === 'liked-playlists')
      );
    }
    if (previous.id === 'followed-artists') {
      const response = await fetchMusicJson<
        SoundCloudUser[] | SoundCloudCollection<SoundCloudUser>
      >(`/soundcloud/api/me/followings?${suffix}`, undefined, signal);
      return soundCloudPage(previous, response, (user) => mapUser(user, true));
    }
    const detail = /^(artist|playlist):(soundcloud:(users|playlists):[0-9]+)$/.exec(previous.id);
    if (!detail) throw new Error('This SoundCloud collection cannot load another page');
    const resource = detail[1] === 'artist' ? 'users' : 'playlists';
    const response = await fetchMusicJson<
      SoundCloudTrack[] | SoundCloudCollection<SoundCloudTrack>
    >(`/soundcloud/api/${resource}/${detail[2]}/tracks?${suffix}`, undefined, signal);
    return soundCloudPage(previous, response, mapTrack);
  },
  canSetFavorite: isFavoriteableSoundCloudItem,
  async setFavorite(item, favorite) {
    if (item.type === 'artist' && isSoundCloudUrn(item.id, 'users')) {
      await fetchMusicJson(`/soundcloud/api/me/followings/${item.id}`, {
        method: favorite ? 'PUT' : 'DELETE',
      });
      return;
    }
    const resource =
      item.type === 'track' ? 'tracks' : item.type === 'playlist' ? 'playlists' : null;
    if (!resource || !isSoundCloudUrn(item.id, resource)) {
      throw new Error('SoundCloud cannot save this item');
    }
    await fetchMusicJson(`/soundcloud/api/likes/${resource}/${item.id}`, {
      method: favorite ? 'POST' : 'DELETE',
    });
  },
  async getPlaybackSnapshot() {
    if (!currentItem || !widgetPromise) {
      return {
        sourceId: 'soundcloud',
        targetId: 'soundcloud-browser',
        targetAdapterId: 'soundcloud-browser',
        state: 'idle',
        currentItem: null,
        positionMs: 0,
        updatedAt: new Date().toISOString(),
      };
    }
    const widget = await getWidget(currentItem);
    const [position, duration, volume, paused] = await Promise.all([
      callbackValue<number>(
        (callback) => widget.getPosition(callback),
        'SoundCloud did not report position'
      ),
      callbackValue<number>(
        (callback) => widget.getDuration(callback),
        'SoundCloud did not report duration'
      ),
      callbackValue<number>(
        (callback) => widget.getVolume(callback),
        'SoundCloud did not report volume'
      ),
      callbackValue<boolean>(
        (callback) => widget.isPaused(callback),
        'SoundCloud did not report playback state'
      ),
    ]);
    playbackState = paused ? 'paused' : 'playing';
    return {
      sourceId: 'soundcloud',
      targetId: 'soundcloud-browser',
      targetAdapterId: 'soundcloud-browser',
      state: playbackState,
      currentItem,
      positionMs: position,
      durationMs: duration || currentItem.durationMs,
      volume: Math.max(0, Math.min(1, volume / 100)),
      updatedAt: new Date().toISOString(),
    };
  },
  async getQueue() {
    return {
      sourceId: 'soundcloud',
      items: queueItems,
      currentIndex,
      revision: `${queueItems.length}:${currentIndex ?? 'none'}`,
    };
  },
};

export const soundCloudBrowserTargetAdapter: MusicPlaybackTargetAdapter = {
  id: 'soundcloud-browser',
  async listTargets(sourceId) {
    if (sourceId !== 'soundcloud') return [];
    const status = await soundCloudMusicSourceAdapter.getAccountStatus();
    return [
      {
        id: 'soundcloud-browser',
        adapterId: 'soundcloud-browser',
        name: 'This Navet display',
        kind: 'browser',
        sourceIds: ['soundcloud'],
        available: status.state === 'connected',
        reasonUnavailable:
          status.state === 'connected' ? undefined : 'Connect SoundCloud to play in this browser',
        detail: 'Official SoundCloud player',
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
            set_shuffle: false,
            set_repeat: false,
          },
        },
      },
    ];
  },
  async play(_targetId, item) {
    await loadItem(item, true);
  },
  canEnqueue: (_targetId, item) => isQueueableSoundCloudItem(item),
  async enqueue(_targetId, item, options) {
    requirePlayableSoundCloudItem(item);
    if (options?.position === 'next') {
      const insertAt = currentIndex === null ? 0 : currentIndex + 1;
      queueItems = [...queueItems.slice(0, insertAt), item, ...queueItems.slice(insertAt)];
      return;
    }
    queueItems = [...queueItems, item];
  },
  async execute(_targetId, command) {
    if (!currentItem) throw new Error('Choose something to play first');
    const widget = await getWidget(currentItem);
    if (command.type === 'play') widget.play();
    if (command.type === 'pause') widget.pause();
    if (command.type === 'seek') widget.seekTo(command.positionMs);
    if (command.type === 'set_volume') widget.setVolume(Math.round(command.volume * 100));
    if (command.type === 'next') {
      const nextIndex = (currentIndex ?? -1) + 1;
      const next = queueItems[nextIndex];
      if (next) {
        currentIndex = nextIndex;
        await loadItem(next, false);
      } else {
        widget.next();
      }
    }
    if (command.type === 'previous') {
      const previousIndex = (currentIndex ?? 0) - 1;
      const previous = queueItems[previousIndex];
      if (previous) {
        currentIndex = previousIndex;
        await loadItem(previous, false);
      } else {
        widget.prev();
      }
    }
  },
};
