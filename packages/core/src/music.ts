export const MUSIC_SOURCE_IDS = ['spotify', 'apple_music', 'soundcloud', 'youtube_music'] as const;

export type BuiltInMusicSourceId = (typeof MUSIC_SOURCE_IDS)[number];

/**
 * Music sources are registered at runtime. Keeping this contract open allows provider packages to
 * add sources without coupling @navet/core to a product-specific allowlist.
 */
export type MusicSourceId = string;

export interface MusicSourcePresentation {
  /** A small provider-identity accent. Shared surfaces must remain theme-owned. */
  accentColor?: string;
  /** A stable semantic icon key. Unknown keys must fall back to a generic music icon. */
  icon?: string;
}

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
  /** Whether this item is currently saved or favorited in the connected account. */
  isFavorite?: boolean;
  uri?: string;
}

export type MusicBrowseSectionKind =
  | 'recent'
  | 'favorites'
  | 'playlists'
  | 'albums'
  | 'artists'
  | 'tracks'
  | 'recommendations'
  | 'collection';

export interface MusicBrowseSection {
  /** Stable within a source so the UI can preserve shelf identity while refreshing. */
  id: string;
  sourceId: MusicSourceId;
  kind: MusicBrowseSectionKind;
  /** Optional provider-authored title for collections without a shared semantic label. */
  title?: string;
  layout: 'grid' | 'list';
  items: MusicItem[];
  /** Opaque, credential-free provider cursor used only to request the next page. */
  continuation?: string;
}

export interface MusicSearchSection {
  sourceId: MusicSourceId;
  title: string;
  items: MusicItem[];
}

export interface MusicPlaylistDestination {
  id: string;
  sourceId: MusicSourceId;
  title: string;
  artworkUrl?: string | null;
}

export interface MusicPlaylistPage {
  items: MusicPlaylistDestination[];
  /** Opaque, credential-free provider cursor used only to request the next page. */
  continuation?: string;
}

export interface MusicPlaylistBrowseOptions {
  continuation?: string;
  signal?: AbortSignal;
}

export interface MusicSourceCapabilities {
  search: boolean;
  library: boolean;
  itemDetails: boolean;
  queue: boolean;
  favorites: boolean;
  favoriteMutation: boolean;
  /** Whether this source can add supported items to editable account playlists. */
  playlistMutation?: boolean;
  browserPlayback: boolean;
  playbackHandoff: boolean;
}

export interface MusicTransportCapabilities {
  play: boolean;
  pause: boolean;
  next: boolean;
  previous: boolean;
  seek: boolean;
  set_volume: boolean;
  set_shuffle: boolean;
  set_repeat: boolean;
}

export type MusicQueuePosition = 'next' | 'later';

export interface MusicPlaybackTargetCapabilities {
  enqueue: boolean;
  /** Explicit queue positions supported by this output. Omit for legacy add-to-end adapters. */
  queuePositions?: MusicQueuePosition[];
  grouping: boolean;
  transport: MusicTransportCapabilities;
}

export type MusicAccountStatus =
  | { state: 'disconnected' }
  | { state: 'connecting' }
  | { state: 'connected'; displayName?: string; subscription?: string }
  | { state: 'unavailable'; reason: string; canConnect?: boolean };

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
  /** Identifies the adapter namespace for targetId when multiple adapters expose the same ID. */
  targetAdapterId?: string;
  state: MusicPlaybackState;
  currentItem: MusicItem | null;
  positionMs: number;
  durationMs?: number;
  volume?: number;
  shuffle?: boolean;
  repeat?: 'off' | 'all' | 'one';
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
  detail?: string;
  isActive?: boolean;
  groupId?: string;
  groupCoordinatorId?: string;
  groupMemberIds?: string[];
  capabilities?: MusicPlaybackTargetCapabilities;
}

export type MusicTransportCommand =
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'next' }
  | { type: 'previous' }
  | { type: 'seek'; positionMs: number }
  | { type: 'set_volume'; volume: number }
  | { type: 'set_shuffle'; enabled: boolean }
  | { type: 'set_repeat'; mode: 'off' | 'all' | 'one' };

export interface MusicSourceAdapter {
  readonly id: MusicSourceId;
  readonly name: string;
  readonly presentation?: MusicSourcePresentation;
  readonly capabilities: MusicSourceCapabilities;
  getAccountStatus(): Promise<MusicAccountStatus>;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  search(query: string, signal?: AbortSignal): Promise<MusicItem[]>;
  browseLibrary?(signal?: AbortSignal): Promise<MusicBrowseSection[]>;
  browseItem?(item: MusicItem, signal?: AbortSignal): Promise<MusicBrowseSection[]>;
  browseNextPage?(section: MusicBrowseSection, signal?: AbortSignal): Promise<MusicBrowseSection>;
  /** Narrows provider-wide favorite support to the concrete item types the API accepts. */
  canSetFavorite?(item: MusicItem): boolean;
  setFavorite?(item: MusicItem, favorite: boolean): Promise<void>;
  listEditablePlaylists?(options?: MusicPlaylistBrowseOptions): Promise<MusicPlaylistPage>;
  /** Narrows playlist writes to item types the provider accepts. */
  canAddToPlaylist?(item: MusicItem): boolean;
  addToPlaylist?(playlist: MusicPlaylistDestination, item: MusicItem): Promise<void>;
  getPlaybackSnapshot?(): Promise<MusicPlaybackSnapshot>;
  getQueue?(): Promise<MusicQueueSnapshot>;
}

export interface MusicPlaybackTargetAdapter {
  readonly id: string;
  listTargets(sourceId: MusicSourceId): Promise<MusicPlaybackTarget[]>;
  play(targetId: string, item: MusicItem, options?: { replaceQueue?: boolean }): Promise<void>;
  /** Narrows target-wide queue support to the concrete item types the output accepts. */
  canEnqueue?(targetId: string, item: MusicItem, position?: MusicQueuePosition): boolean;
  enqueue?(
    targetId: string,
    item: MusicItem,
    options?: { position?: MusicQueuePosition }
  ): Promise<void>;
  execute(targetId: string, command: MusicTransportCommand): Promise<void>;
  group?(coordinatorId: string, memberIds: string[]): Promise<void>;
  ungroup?(targetId: string): Promise<void>;
}

export interface MusicPlaybackSession {
  sourceId: MusicSourceId;
  targetId: string;
  queue: MusicQueueSnapshot;
  playback: MusicPlaybackSnapshot;
}

export const MUSIC_ENGINE_PROTOCOLS = ['sonos', 'dlna', 'airplay', 'spotify_connect'] as const;

export type MusicEngineProtocol = (typeof MUSIC_ENGINE_PROTOCOLS)[number];

export type MusicEngineStatus =
  | { state: 'unavailable'; reason: string }
  | { state: 'starting' }
  | {
      state: 'ready';
      version: string;
      lanStreamBaseUrl: string;
      spotifyAudioAvailable: boolean;
      localTranscodingAvailable?: boolean;
      reason?: string;
      protocols: MusicEngineProtocol[];
    };

export interface MusicEngineTarget {
  id: string;
  name: string;
  protocol: MusicEngineProtocol;
  available: boolean;
  model?: string;
  room?: string;
  address?: string;
  isActive?: boolean;
  groupId?: string;
  groupCoordinatorId?: string;
  groupMemberIds?: string[];
}

export interface MusicEnginePlayRequest {
  targetId: string;
  item: Pick<
    MusicItem,
    'id' | 'sourceId' | 'type' | 'title' | 'artists' | 'uri' | 'durationMs' | 'artworkUrl'
  >;
  queueMode: 'replace' | 'add' | 'next';
}

export interface MusicEngineClient {
  getStatus(): Promise<MusicEngineStatus>;
  listTargets(): Promise<MusicEngineTarget[]>;
  play(request: MusicEnginePlayRequest): Promise<MusicPlaybackSession>;
  execute(targetId: string, command: MusicTransportCommand): Promise<MusicPlaybackSnapshot>;
  group(coordinatorId: string, memberIds: string[]): Promise<MusicEngineTarget[]>;
  ungroup(targetId: string): Promise<MusicEngineTarget[]>;
  getPlayback(): Promise<MusicPlaybackSnapshot>;
  getQueue(): Promise<MusicQueueSnapshot>;
}

export function createMusicItemKey(item: Pick<MusicItem, 'sourceId' | 'type' | 'id'>): string {
  return `${item.sourceId}:${item.type}:${item.id}`;
}

export function createMusicTargetKey(
  target: Pick<MusicPlaybackTarget, 'adapterId' | 'id'>
): string {
  return JSON.stringify([target.adapterId, target.id]);
}

export function isMusicSourceId(value: unknown): value is MusicSourceId {
  return (
    typeof value === 'string' && value.length <= 64 && /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/.test(value)
  );
}

export function musicTargetSupportsCommand(
  target: MusicPlaybackTarget | null | undefined,
  command: MusicTransportCommand['type']
): boolean {
  return target?.capabilities?.transport[command] ?? true;
}
