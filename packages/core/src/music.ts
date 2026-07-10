export const MUSIC_SOURCE_IDS = ['spotify', 'apple_music'] as const;

export type MusicSourceId = (typeof MUSIC_SOURCE_IDS)[number];

export type MusicItemType = 'track' | 'album' | 'artist' | 'playlist' | 'station' | 'episode';

export interface MusicItem {
  id: string;
  sourceId: MusicSourceId;
  type: MusicItemType;
  title: string;
  artists: string[];
  album?: string;
  durationMs?: number;
  artworkUrl?: string | null;
  playable: boolean;
  explicit?: boolean;
  uri?: string;
}

export interface MusicSearchSection {
  sourceId: MusicSourceId;
  title: string;
  items: MusicItem[];
}

export interface MusicSourceCapabilities {
  search: boolean;
  library: boolean;
  queue: boolean;
  favorites: boolean;
  browserPlayback: boolean;
  playbackHandoff: boolean;
}

export type MusicAccountStatus =
  | { state: 'disconnected' }
  | { state: 'connecting' }
  | { state: 'connected'; displayName?: string; subscription?: string }
  | { state: 'unavailable'; reason: string };

export type MusicPlaybackState = 'idle' | 'playing' | 'paused' | 'buffering' | 'unavailable';

export interface MusicQueueSnapshot {
  sourceId: MusicSourceId;
  items: MusicItem[];
  currentIndex: number | null;
  revision?: string;
}

export interface MusicPlaybackSnapshot {
  sourceId: MusicSourceId;
  targetId: string | null;
  state: MusicPlaybackState;
  currentItem: MusicItem | null;
  positionMs: number;
  durationMs?: number;
  volume?: number;
  queue?: MusicQueueSnapshot;
  updatedAt: string;
}

export interface MusicPlaybackTarget {
  id: string;
  adapterId: string;
  name: string;
  kind: 'browser' | 'connect' | 'smart_home';
  sourceIds: MusicSourceId[];
  available: boolean;
  reasonUnavailable?: string;
  room?: string;
  isActive?: boolean;
}

export type MusicTransportCommand =
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'next' }
  | { type: 'previous' }
  | { type: 'seek'; positionMs: number }
  | { type: 'set_volume'; volume: number };

export interface MusicSourceAdapter {
  readonly id: MusicSourceId;
  readonly name: string;
  readonly capabilities: MusicSourceCapabilities;
  getAccountStatus(): Promise<MusicAccountStatus>;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  search(query: string, signal?: AbortSignal): Promise<MusicItem[]>;
  browseLibrary?(signal?: AbortSignal): Promise<MusicItem[]>;
  getPlaybackSnapshot?(): Promise<MusicPlaybackSnapshot>;
  getQueue?(): Promise<MusicQueueSnapshot>;
}

export interface MusicPlaybackTargetAdapter {
  readonly id: string;
  listTargets(sourceId: MusicSourceId): Promise<MusicPlaybackTarget[]>;
  play(targetId: string, item: MusicItem, options?: { replaceQueue?: boolean }): Promise<void>;
  enqueue?(targetId: string, item: MusicItem): Promise<void>;
  execute(targetId: string, command: MusicTransportCommand): Promise<void>;
}

export interface MusicPlaybackSession {
  sourceId: MusicSourceId;
  targetId: string;
  queue: MusicQueueSnapshot;
  playback: MusicPlaybackSnapshot;
}

export function createMusicItemKey(item: Pick<MusicItem, 'sourceId' | 'type' | 'id'>): string {
  return `${item.sourceId}:${item.type}:${item.id}`;
}

export function isMusicSourceId(value: unknown): value is MusicSourceId {
  return typeof value === 'string' && MUSIC_SOURCE_IDS.includes(value as MusicSourceId);
}
