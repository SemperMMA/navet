import {
  createMusicItemKey,
  type MusicAccountStatus,
  type MusicBrowseSection,
  type MusicItem,
  type MusicPlaybackSnapshot,
  type MusicPlaybackTargetAdapter,
  type MusicPlaylistDestination,
  type MusicSourceAdapter,
} from '@navet/core/music';
import { fetchMusicJson } from '../music-endpoints';
import { loadExternalBrowserScript, waitForBrowserCallback } from './browser-player-loader';

export const YOUTUBE_PLAYER_HOST_ID = 'navet-youtube-player-host';
export const YOUTUBE_PLAYER_SURFACE_ID = 'navet-youtube-player-surface';
const YOUTUBE_IFRAME_API = 'https://www.youtube.com/iframe_api';

interface YouTubeThumbnail {
  url?: string;
}

interface YouTubeSnippet {
  channelTitle?: string;
  title?: string;
  thumbnails?: {
    default?: YouTubeThumbnail;
    medium?: YouTubeThumbnail;
    high?: YouTubeThumbnail;
  };
  resourceId?: { videoId?: string };
}

interface YouTubeSearchItem {
  id?: { playlistId?: string; videoId?: string };
  snippet?: YouTubeSnippet;
}

interface YouTubePlaylistItem {
  id?: string;
  snippet?: YouTubeSnippet;
}

interface YouTubeVideoItem {
  id?: string;
  snippet?: YouTubeSnippet;
}

interface YouTubeListResponse<T> {
  items?: T[];
  nextPageToken?: string;
}

interface YouTubePlayer {
  cueVideoById(videoId: string): void;
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  getPlaylist?(): string[];
  getPlaylistIndex?(): number;
  getVolume(): number;
  getVideoData?(): { author?: string; title?: string; video_id?: string };
  loadPlaylist(options: { index: number; list: string; listType: 'playlist' }): void;
  loadVideoById(videoId: string): void;
  nextVideo(): void;
  pauseVideo(): void;
  playVideo(): void;
  previousVideo(): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  setVolume(volume: number): void;
}

interface YouTubePlayerConstructor {
  new (
    elementId: string,
    options: {
      events: {
        onReady: (event: { target: YouTubePlayer }) => void;
        onError: (event: { data: number; target: YouTubePlayer }) => void;
        onStateChange: (event: { data: number; target: YouTubePlayer }) => void;
      };
      height: string;
      playerVars: {
        controls: 1;
        origin: string;
        playsinline: 1;
      };
      videoId: string;
      width: string;
    }
  ): YouTubePlayer;
}

declare global {
  interface Window {
    YT?: {
      Player: YouTubePlayerConstructor;
      PlayerState: {
        BUFFERING: number;
        CUED: number;
        ENDED: number;
        PAUSED: number;
        PLAYING: number;
        UNSTARTED: number;
      };
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

let iframeApiPromise: Promise<void> | null = null;
let playerPromise: Promise<YouTubePlayer> | null = null;
let playerSurface: HTMLElement | null = null;
let currentItem: MusicItem | null = null;
let currentIndex: number | null = null;
let queueItems: MusicItem[] = [];
let playbackState: MusicPlaybackSnapshot['state'] = 'idle';

function resetYouTubePlayback() {
  currentItem = null;
  currentIndex = null;
  queueItems = [];
  playbackState = 'idle';
  document.getElementById(YOUTUBE_PLAYER_SURFACE_ID)?.classList.add('hidden');
}

function decodeYouTubeText(value: string) {
  const textarea = document.createElement('textarea');
  textarea.innerHTML = value;
  return textarea.value;
}

function artwork(snippet?: YouTubeSnippet) {
  return (
    snippet?.thumbnails?.high?.url ??
    snippet?.thumbnails?.medium?.url ??
    snippet?.thumbnails?.default?.url ??
    null
  );
}

function mapSearchItem(item: YouTubeSearchItem): MusicItem | null {
  const videoId = item.id?.videoId;
  const playlistId = item.id?.playlistId;
  const id = videoId ?? playlistId;
  const title = item.snippet?.title;
  if (!id || !isYouTubeId(id) || !title) return null;
  return {
    id,
    sourceId: 'youtube_music',
    type: playlistId ? 'playlist' : 'track',
    title: decodeYouTubeText(title),
    artists: item.snippet?.channelTitle ? [decodeYouTubeText(item.snippet.channelTitle)] : [],
    artworkUrl: artwork(item.snippet),
    playable: true,
    uri: playlistId ? `youtube:playlist:${playlistId}` : `youtube:video:${videoId}`,
  };
}

function mapPlaylist(item: YouTubePlaylistItem): MusicItem | null {
  if (!item.id || !isYouTubeId(item.id) || !item.snippet?.title) return null;
  return {
    id: item.id,
    sourceId: 'youtube_music',
    type: 'playlist',
    title: decodeYouTubeText(item.snippet.title),
    artists: item.snippet.channelTitle ? [decodeYouTubeText(item.snippet.channelTitle)] : [],
    artworkUrl: artwork(item.snippet),
    playable: true,
    uri: `youtube:playlist:${item.id}`,
  };
}

function mapPlaylistDestination(item: YouTubePlaylistItem): MusicPlaylistDestination | null {
  const playlist = mapPlaylist(item);
  return playlist
    ? {
        id: playlist.id,
        sourceId: 'youtube_music',
        title: playlist.title,
        artworkUrl: playlist.artworkUrl,
      }
    : null;
}

function mapVideo(item: YouTubeVideoItem, isFavorite = false): MusicItem | null {
  if (!item.id || !isYouTubeId(item.id) || !item.snippet?.title) return null;
  return {
    id: item.id,
    sourceId: 'youtube_music',
    type: 'track',
    title: decodeYouTubeText(item.snippet.title),
    artists: item.snippet.channelTitle ? [decodeYouTubeText(item.snippet.channelTitle)] : [],
    artworkUrl: artwork(item.snippet),
    playable: true,
    isFavorite,
    uri: `youtube:video:${item.id}`,
  };
}

function mapPlaylistTrack(item: YouTubePlaylistItem): MusicItem | null {
  const videoId = item.snippet?.resourceId?.videoId;
  if (!videoId || !item.snippet?.title) return null;
  return mapVideo({ id: videoId, snippet: item.snippet });
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
    ? {
        id,
        sourceId: 'youtube_music',
        kind,
        layout,
        items,
        ...(continuation ? { continuation } : {}),
      }
    : null;
}

function isYouTubeId(value: string) {
  return value.length >= 6 && value.length <= 128 && /^[a-zA-Z0-9_-]+$/.test(value);
}

function youtubeContinuation<T>(response: YouTubeListResponse<T> | null) {
  const token = response?.nextPageToken;
  return token && token.length <= 512 && /^[A-Za-z0-9_-]+$/.test(token)
    ? `page:${token}`
    : undefined;
}

function youtubePageToken(continuation: string | undefined) {
  return /^page:([A-Za-z0-9_-]{1,512})$/.exec(continuation ?? '')?.[1] ?? null;
}

function youtubePage<T>(
  previous: MusicBrowseSection,
  response: YouTubeListResponse<T>,
  map: (item: T) => MusicItem | null
): MusicBrowseSection {
  return {
    ...previous,
    items: compact((response.items ?? []).map((item) => map(item))),
    continuation: youtubeContinuation(response),
  };
}

function loadIframeApi() {
  if (iframeApiPromise) return iframeApiPromise;
  iframeApiPromise = loadExternalBrowserScript({
    src: YOUTUBE_IFRAME_API,
    isReady: () => Boolean(window.YT?.Player),
    errorMessage: 'Unable to load the YouTube player',
  }).catch((error) => {
    iframeApiPromise = null;
    throw error;
  });
  return iframeApiPromise;
}

function itemVideoId(item: MusicItem) {
  const id = item.uri?.startsWith('youtube:video:') ? item.uri.slice('youtube:video:'.length) : '';
  return isYouTubeId(id) ? id : '';
}

function itemPlaylistId(item: MusicItem) {
  const id = item.uri?.startsWith('youtube:playlist:')
    ? item.uri.slice('youtube:playlist:'.length)
    : '';
  return isYouTubeId(id) ? id : '';
}

function isFavoriteableYouTubeItem(item: MusicItem) {
  return item.sourceId === 'youtube_music' && item.type === 'track' && Boolean(itemVideoId(item));
}

function isQueueableYouTubeItem(item: MusicItem) {
  return isFavoriteableYouTubeItem(item) && item.playable;
}

function syncCurrentYouTubeItem(player: YouTubePlayer) {
  const video = player.getVideoData?.();
  if (!video?.video_id || !isYouTubeId(video.video_id) || !video.title) return;
  currentItem = {
    id: video.video_id,
    sourceId: 'youtube_music',
    type: 'track',
    title: decodeYouTubeText(video.title),
    artists: video.author ? [decodeYouTubeText(video.author)] : [],
    artworkUrl: `https://i.ytimg.com/vi/${video.video_id}/hqdefault.jpg`,
    playable: true,
    uri: `youtube:video:${video.video_id}`,
  };
}

async function ensurePlayer(seedItem: MusicItem) {
  const surface = document.getElementById(YOUTUBE_PLAYER_SURFACE_ID);
  if (!surface) throw new Error('The YouTube player is not available on this display');
  if (playerPromise && playerSurface !== surface) {
    playerPromise = null;
    playerSurface = null;
  }
  surface.classList.remove('hidden');
  if (!playerPromise) {
    playerSurface = surface;
    const seedVideoId = itemVideoId(seedItem);
    if (!seedVideoId && !itemPlaylistId(seedItem)) {
      throw new Error('YouTube did not provide a playable item');
    }
    const pending = loadIframeApi().then(() =>
      waitForBrowserCallback<YouTubePlayer>((resolve, reject) => {
        if (!window.YT?.Player) {
          reject(new Error('YouTube did not initialize'));
          return;
        }
        const host = document.getElementById(YOUTUBE_PLAYER_HOST_ID);
        if (!host) {
          reject(new Error('The YouTube player is not available on this display'));
          return;
        }
        const player = new window.YT.Player(YOUTUBE_PLAYER_HOST_ID, {
          width: '100%',
          height: '100%',
          videoId: seedVideoId,
          playerVars: {
            controls: 1,
            origin: window.location.origin,
            playsinline: 1,
          },
          events: {
            onReady: (event) => resolve(event.target),
            onStateChange: (event) => {
              const states = window.YT?.PlayerState;
              if (!states) return;
              syncCurrentYouTubeItem(event.target);
              if (event.data === states.PLAYING) playbackState = 'playing';
              if (event.data === states.PAUSED || event.data === states.CUED) {
                playbackState = 'paused';
              }
              if (event.data === states.BUFFERING) playbackState = 'buffering';
              if (event.data === states.ENDED) {
                if (queueItems[currentIndex ?? -1]?.type === 'playlist') {
                  const playlist = event.target.getPlaylist?.() ?? [];
                  const playlistIndex = event.target.getPlaylistIndex?.() ?? -1;
                  playbackState =
                    playlist.length > 0 && playlistIndex >= playlist.length - 1
                      ? 'idle'
                      : 'buffering';
                  return;
                }
                const nextIndex = (currentIndex ?? -1) + 1;
                const next = queueItems[nextIndex];
                if (next && itemVideoId(next)) {
                  currentIndex = nextIndex;
                  currentItem = next;
                  void playerPromise?.then((active) => active.loadVideoById(itemVideoId(next)));
                } else {
                  playbackState = 'idle';
                }
              }
            },
            onError: (event) => {
              playbackState = 'unavailable';
              reject(new Error(`YouTube playback failed (${event.data})`));
            },
          },
        });
        void player;
      }, 'YouTube player did not become ready')
    );
    playerPromise = pending.catch((error) => {
      playerPromise = null;
      playerSurface = null;
      document.getElementById(YOUTUBE_PLAYER_SURFACE_ID)?.classList.add('hidden');
      throw error;
    });
  }
  return await playerPromise;
}

async function loadItem(item: MusicItem, replaceQueue: boolean) {
  if (item.sourceId !== 'youtube_music' || !item.playable) {
    throw new Error('YouTube did not provide a playable item');
  }
  const player = await ensurePlayer(item);
  if (replaceQueue || currentIndex === null) {
    queueItems = [item];
    currentIndex = 0;
  }
  currentItem = item;
  const videoId = itemVideoId(item);
  const playlistId = itemPlaylistId(item);
  if (videoId) player.loadVideoById(videoId);
  else if (playlistId) player.loadPlaylist({ list: playlistId, listType: 'playlist', index: 0 });
  else throw new Error('YouTube did not provide a playable item');
  playbackState = 'buffering';
}

export const youtubeMusicSourceAdapter: MusicSourceAdapter = {
  id: 'youtube_music',
  name: 'YouTube Music',
  presentation: { accentColor: '#ff0033', icon: 'youtube_music' },
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
  async getAccountStatus() {
    return await fetchMusicJson<MusicAccountStatus>('/youtube/status');
  },
  async connect() {
    const { authorizationUrl } = await fetchMusicJson<{ authorizationUrl: string }>(
      '/youtube/authorize',
      { method: 'POST' }
    );
    window.location.assign(authorizationUrl);
  },
  async disconnect() {
    await fetchMusicJson('/youtube/session', { method: 'DELETE' });
    if (playerPromise) {
      await playerPromise.then((player) => player.pauseVideo()).catch(() => undefined);
    }
    resetYouTubePlayback();
  },
  async search(query, signal) {
    const videoParams = new URLSearchParams({
      maxResults: '16',
      part: 'snippet',
      q: query,
      type: 'video',
      videoCategoryId: '10',
      videoEmbeddable: 'true',
      videoSyndicated: 'true',
    });
    const playlistParams = new URLSearchParams({
      maxResults: '8',
      part: 'snippet',
      q: query,
      type: 'playlist',
    });
    const results = await Promise.allSettled([
      fetchMusicJson<YouTubeListResponse<YouTubeSearchItem>>(
        `/youtube/api/youtube/v3/search?${videoParams}`,
        undefined,
        signal
      ),
      fetchMusicJson<YouTubeListResponse<YouTubeSearchItem>>(
        `/youtube/api/youtube/v3/search?${playlistParams}`,
        undefined,
        signal
      ),
    ]);
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const items = results.flatMap((result) =>
      result.status === 'fulfilled' ? compact((result.value.items ?? []).map(mapSearchItem)) : []
    );
    if (items.length) {
      return [...new Map(items.map((item) => [createMusicItemKey(item), item])).values()];
    }
    const failure = results.find((result) => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
    return [];
  },
  async browseLibrary(signal) {
    const playlistParams = new URLSearchParams({
      maxResults: '20',
      mine: 'true',
      part: 'snippet',
    });
    const likedParams = new URLSearchParams({
      maxResults: '20',
      myRating: 'like',
      part: 'snippet',
    });
    const results = await Promise.allSettled([
      fetchMusicJson<YouTubeListResponse<YouTubePlaylistItem>>(
        `/youtube/api/youtube/v3/playlists?${playlistParams}`,
        undefined,
        signal
      ),
      fetchMusicJson<YouTubeListResponse<YouTubeVideoItem>>(
        `/youtube/api/youtube/v3/videos?${likedParams}`,
        undefined,
        signal
      ),
    ]);
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const playlists = results[0].status === 'fulfilled' ? results[0].value : null;
    const liked = results[1].status === 'fulfilled' ? results[1].value : null;
    const sections = [
      section(
        'liked-videos',
        'favorites',
        'list',
        compact((liked?.items ?? []).map((item) => mapVideo(item, true))),
        youtubeContinuation(liked)
      ),
      section(
        'playlists',
        'playlists',
        'grid',
        compact((playlists?.items ?? []).map(mapPlaylist)),
        youtubeContinuation(playlists)
      ),
    ].filter((value): value is MusicBrowseSection => value !== null);
    if (sections.length) return sections;
    const failure = results.find((result) => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
    return [];
  },
  async browseItem(item, signal) {
    const playlistId = itemPlaylistId(item);
    if (item.type !== 'playlist' || !playlistId) return [];
    const params = new URLSearchParams({
      maxResults: '50',
      part: 'snippet',
      playlistId,
    });
    const result = await fetchMusicJson<YouTubeListResponse<YouTubePlaylistItem>>(
      `/youtube/api/youtube/v3/playlistItems?${params}`,
      undefined,
      signal
    );
    const items = compact((result.items ?? []).map(mapPlaylistTrack));
    return items.length
      ? [
          {
            id: `playlist:${playlistId}`,
            sourceId: 'youtube_music',
            kind: 'tracks',
            layout: 'list',
            items,
            continuation: youtubeContinuation(result),
          },
        ]
      : [];
  },
  async browseNextPage(previous, signal) {
    if (previous.sourceId !== 'youtube_music') throw new Error('Invalid YouTube collection');
    const pageToken = youtubePageToken(previous.continuation);
    if (!pageToken) throw new Error('Invalid YouTube page cursor');
    if (previous.id === 'liked-videos') {
      const params = new URLSearchParams({
        maxResults: '50',
        myRating: 'like',
        pageToken,
        part: 'snippet',
      });
      const response = await fetchMusicJson<YouTubeListResponse<YouTubeVideoItem>>(
        `/youtube/api/youtube/v3/videos?${params}`,
        undefined,
        signal
      );
      return youtubePage(previous, response, (item) => mapVideo(item, true));
    }
    if (previous.id === 'playlists') {
      const params = new URLSearchParams({
        maxResults: '50',
        mine: 'true',
        pageToken,
        part: 'snippet',
      });
      const response = await fetchMusicJson<YouTubeListResponse<YouTubePlaylistItem>>(
        `/youtube/api/youtube/v3/playlists?${params}`,
        undefined,
        signal
      );
      return youtubePage(previous, response, mapPlaylist);
    }
    const playlistId = /^playlist:([A-Za-z0-9_-]{6,128})$/.exec(previous.id)?.[1];
    if (!playlistId || !isYouTubeId(playlistId)) {
      throw new Error('This YouTube collection cannot load another page');
    }
    const params = new URLSearchParams({
      maxResults: '50',
      pageToken,
      part: 'snippet',
      playlistId,
    });
    const response = await fetchMusicJson<YouTubeListResponse<YouTubePlaylistItem>>(
      `/youtube/api/youtube/v3/playlistItems?${params}`,
      undefined,
      signal
    );
    return youtubePage(previous, response, mapPlaylistTrack);
  },
  canSetFavorite: isFavoriteableYouTubeItem,
  async setFavorite(item, favorite) {
    const videoId = itemVideoId(item);
    if (item.type !== 'track' || !videoId) {
      throw new Error('YouTube can only like individual videos');
    }
    const params = new URLSearchParams({ id: videoId, rating: favorite ? 'like' : 'none' });
    await fetchMusicJson(`/youtube/api/youtube/v3/videos/rate?${params}`, { method: 'POST' });
  },
  async listEditablePlaylists(options) {
    const pageToken = options?.continuation ? youtubePageToken(options.continuation) : undefined;
    if (options?.continuation && !pageToken) {
      throw new Error('Invalid YouTube playlist cursor');
    }
    const params = new URLSearchParams({
      maxResults: '50',
      mine: 'true',
      part: 'snippet',
    });
    if (pageToken) params.set('pageToken', pageToken);
    const response = await fetchMusicJson<YouTubeListResponse<YouTubePlaylistItem>>(
      `/youtube/api/youtube/v3/playlists?${params}`,
      undefined,
      options?.signal
    );
    return {
      items: (response.items ?? [])
        .map(mapPlaylistDestination)
        .filter((playlist): playlist is MusicPlaylistDestination => playlist !== null),
      continuation: youtubeContinuation(response),
    };
  },
  canAddToPlaylist(item) {
    return item.sourceId === 'youtube_music' && item.type === 'track' && Boolean(itemVideoId(item));
  },
  async addToPlaylist(playlist, item) {
    const videoId = itemVideoId(item);
    if (
      playlist.sourceId !== 'youtube_music' ||
      !isYouTubeId(playlist.id) ||
      item.type !== 'track' ||
      !videoId
    ) {
      throw new Error('YouTube cannot add this item to the selected playlist');
    }
    await fetchMusicJson('/youtube/api/youtube/v3/playlistItems?part=snippet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        snippet: {
          playlistId: playlist.id,
          resourceId: { kind: 'youtube#video', videoId },
        },
      }),
    });
  },
  async getPlaybackSnapshot() {
    if (!currentItem || !playerPromise) {
      return {
        sourceId: 'youtube_music',
        targetId: 'youtube-music-browser',
        targetAdapterId: 'youtube-music-browser',
        state: 'idle',
        currentItem: null,
        positionMs: 0,
        updatedAt: new Date().toISOString(),
      };
    }
    const player = await ensurePlayer(currentItem);
    syncCurrentYouTubeItem(player);
    const states = window.YT?.PlayerState;
    const state = player.getPlayerState();
    if (states) {
      playbackState =
        state === states.PLAYING
          ? 'playing'
          : state === states.BUFFERING
            ? 'buffering'
            : state === states.PAUSED || state === states.CUED
              ? 'paused'
              : playbackState;
    }
    return {
      sourceId: 'youtube_music',
      targetId: 'youtube-music-browser',
      targetAdapterId: 'youtube-music-browser',
      state: playbackState,
      currentItem,
      positionMs: Math.max(0, player.getCurrentTime() * 1000),
      durationMs: Math.max(0, player.getDuration() * 1000) || currentItem.durationMs,
      volume: Math.max(0, Math.min(1, player.getVolume() / 100)),
      updatedAt: new Date().toISOString(),
    };
  },
  async getQueue() {
    return {
      sourceId: 'youtube_music',
      items: queueItems,
      currentIndex,
      revision: `${queueItems.length}:${currentIndex ?? 'none'}`,
    };
  },
};

export const youtubeMusicBrowserTargetAdapter: MusicPlaybackTargetAdapter = {
  id: 'youtube-music-browser',
  async listTargets(sourceId) {
    if (sourceId !== 'youtube_music') return [];
    const status = await youtubeMusicSourceAdapter.getAccountStatus();
    return [
      {
        id: 'youtube-music-browser',
        adapterId: 'youtube-music-browser',
        name: 'This Navet display',
        kind: 'browser',
        sourceIds: ['youtube_music'],
        available: status.state === 'connected',
        reasonUnavailable:
          status.state === 'connected' ? undefined : 'Connect YouTube to play in this browser',
        detail: 'Official YouTube player',
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
  canEnqueue: (_targetId, item) => isQueueableYouTubeItem(item),
  async enqueue(_targetId, item, options) {
    if (!isQueueableYouTubeItem(item)) {
      throw new Error('YouTube can only enqueue playable individual videos');
    }
    if (options?.position === 'next') {
      const insertAt = currentIndex === null ? 0 : currentIndex + 1;
      queueItems = [...queueItems.slice(0, insertAt), item, ...queueItems.slice(insertAt)];
      return;
    }
    queueItems = [...queueItems, item];
  },
  async execute(_targetId, command) {
    if (!currentItem) throw new Error('Choose something to play first');
    const player = await ensurePlayer(currentItem);
    if (command.type === 'play') player.playVideo();
    if (command.type === 'pause') player.pauseVideo();
    if (command.type === 'seek') player.seekTo(command.positionMs / 1000, true);
    if (command.type === 'set_volume') player.setVolume(Math.round(command.volume * 100));
    if (command.type === 'next') {
      const nextIndex = (currentIndex ?? -1) + 1;
      const next = queueItems[nextIndex];
      if (next) {
        currentIndex = nextIndex;
        await loadItem(next, false);
      } else {
        player.nextVideo();
      }
    }
    if (command.type === 'previous') {
      const previousIndex = (currentIndex ?? 0) - 1;
      const previous = queueItems[previousIndex];
      if (previous) {
        currentIndex = previousIndex;
        await loadItem(previous, false);
      } else {
        player.previousVideo();
      }
    }
  },
};
