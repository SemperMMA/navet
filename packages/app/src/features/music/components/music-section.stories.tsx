import artwork from '@assets/reference/media/artworks-original.jpg';
import type {
  MusicItem,
  MusicPlaybackTargetAdapter,
  MusicPlaylistDestination,
  MusicSourceAdapter,
  MusicSourceId,
} from '@navet/core/music';
import type { Meta, StoryObj } from '@storybook/react';
import { MusicSection } from './music-section';

const spotifyItems: MusicItem[] = [
  {
    id: 'spotify-olalla',
    sourceId: 'spotify',
    type: 'track',
    title: 'Olalla',
    artists: ['Blanco White'],
    album: 'On the Other Side',
    durationMs: 248000,
    artworkUrl: artwork,
    playable: true,
    uri: 'spotify:track:spotify-olalla',
  },
  {
    id: 'spotify-morning',
    sourceId: 'spotify',
    type: 'playlist',
    title: 'Made for the morning',
    artists: ['Navet household'],
    artworkUrl: artwork,
    playable: true,
    uri: 'spotify:playlist:spotify-morning',
  },
];

const appleItems: MusicItem[] = [
  {
    id: 'apple-pompeii',
    sourceId: 'apple_music',
    type: 'track',
    title: 'Above the Clouds of Pompeii',
    artists: ["Bear's Den"],
    album: 'Islands',
    durationMs: 241000,
    artworkUrl: artwork,
    playable: true,
  },
  {
    id: 'apple-islands',
    sourceId: 'apple_music',
    type: 'album',
    title: 'Islands',
    artists: ["Bear's Den"],
    artworkUrl: artwork,
    playable: true,
    uri: 'apple:albums:apple-islands',
  },
];

const soundCloudItems: MusicItem[] = [
  {
    id: 'soundcloud-sunroom',
    sourceId: 'soundcloud',
    type: 'track',
    title: 'Sunroom Session',
    artists: ['Aster'],
    durationMs: 226000,
    artworkUrl: artwork,
    playable: true,
    uri: 'https://soundcloud.com/aster/sunroom-session',
  },
  {
    id: 'soundcloud:playlists:7',
    sourceId: 'soundcloud',
    type: 'playlist',
    title: 'Sunday rotation',
    artists: ['Navet Sessions'],
    artworkUrl: artwork,
    playable: true,
    uri: 'https://soundcloud.com/navet/sets/sunday-rotation',
  },
];

const youtubeItems: MusicItem[] = [
  {
    id: 'youtube-night-drive',
    sourceId: 'youtube_music',
    type: 'track',
    title: 'Night Drive (Official Audio)',
    artists: ['Harbor Lights'],
    artworkUrl: artwork,
    playable: true,
    uri: 'youtube:video:youtube-night-drive',
  },
  {
    id: 'youtube-slow-sunday',
    sourceId: 'youtube_music',
    type: 'playlist',
    title: 'Slow Sunday',
    artists: ['Vishal'],
    artworkUrl: artwork,
    playable: true,
    uri: 'youtube:playlist:youtube-slow-sunday',
  },
];

const editablePlaylists: Partial<Record<MusicSourceId, MusicPlaylistDestination[]>> = {
  spotify: [
    { id: 'spotify-kitchen', sourceId: 'spotify', title: 'Kitchen rotation', artworkUrl: artwork },
    { id: 'spotify-weekend', sourceId: 'spotify', title: 'Weekend listening' },
  ],
  apple_music: [{ id: 'apple-favorites', sourceId: 'apple_music', title: 'Current favorites' }],
  youtube_music: [
    { id: 'youtube-late-night', sourceId: 'youtube_music', title: 'Late night videos' },
  ],
};

const sources: MusicSourceAdapter[] = [
  {
    id: 'spotify',
    name: 'Spotify',
    presentation: { accentColor: '#1DB954', icon: 'spotify' },
    capabilities: {
      search: true,
      library: true,
      itemDetails: true,
      queue: true,
      favorites: true,
      favoriteMutation: true,
      playlistMutation: true,
      browserPlayback: true,
      playbackHandoff: true,
    },
    getAccountStatus: async () => ({
      state: 'connected',
      displayName: 'Vishal',
      subscription: 'premium',
    }),
    connect: async () => undefined,
    disconnect: async () => undefined,
    search: async () => spotifyItems,
    browseLibrary: async () => [
      {
        id: 'spotify-liked',
        sourceId: 'spotify',
        kind: 'favorites',
        layout: 'list',
        items: spotifyItems.filter((item) => item.type === 'track'),
      },
      {
        id: 'spotify-playlists',
        sourceId: 'spotify',
        kind: 'playlists',
        layout: 'grid',
        items: spotifyItems.filter((item) => item.type === 'playlist'),
      },
    ],
    browseItem: async () => [
      {
        id: 'spotify-detail',
        sourceId: 'spotify',
        kind: 'tracks',
        layout: 'list',
        items: spotifyItems.filter((item) => item.type === 'track'),
      },
    ],
    setFavorite: async () => undefined,
    listEditablePlaylists: async () => ({ items: editablePlaylists.spotify ?? [] }),
    canAddToPlaylist: (item) => item.type === 'track',
    addToPlaylist: async () => undefined,
    getPlaybackSnapshot: async () => ({
      sourceId: 'spotify',
      targetId: 'living-room',
      state: 'playing',
      currentItem: spotifyItems[0] ?? null,
      positionMs: 72000,
      durationMs: spotifyItems[0]?.durationMs,
      updatedAt: new Date().toISOString(),
    }),
    getQueue: async () => ({
      sourceId: 'spotify',
      items: spotifyItems,
      currentIndex: 0,
    }),
  },
  {
    id: 'apple_music',
    name: 'Apple Music',
    presentation: { accentColor: '#fa2d48', icon: 'apple_music' },
    capabilities: {
      search: true,
      library: true,
      itemDetails: true,
      queue: true,
      favorites: false,
      favoriteMutation: false,
      playlistMutation: true,
      browserPlayback: true,
      playbackHandoff: false,
    },
    getAccountStatus: async () => ({ state: 'connected', displayName: 'Apple Music subscriber' }),
    connect: async () => undefined,
    disconnect: async () => undefined,
    search: async () => appleItems,
    browseLibrary: async () => [
      {
        id: 'apple-tracks',
        sourceId: 'apple_music',
        kind: 'tracks',
        layout: 'list',
        items: appleItems.filter((item) => item.type === 'track'),
      },
      {
        id: 'apple-albums',
        sourceId: 'apple_music',
        kind: 'albums',
        layout: 'grid',
        items: appleItems.filter((item) => item.type === 'album'),
      },
    ],
    browseItem: async () => [
      {
        id: 'apple-detail',
        sourceId: 'apple_music',
        kind: 'tracks',
        layout: 'list',
        items: appleItems.filter((item) => item.type === 'track'),
      },
    ],
    listEditablePlaylists: async () => ({ items: editablePlaylists.apple_music ?? [] }),
    canAddToPlaylist: (item) => item.type === 'track',
    addToPlaylist: async () => undefined,
    getPlaybackSnapshot: async () => ({
      sourceId: 'apple_music',
      targetId: 'this-display',
      state: 'idle',
      currentItem: null,
      positionMs: 0,
      updatedAt: new Date().toISOString(),
    }),
    getQueue: async () => ({ sourceId: 'apple_music', items: [], currentIndex: null }),
  },
  {
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
    getAccountStatus: async () => ({ state: 'connected', displayName: 'Vishal' }),
    connect: async () => undefined,
    disconnect: async () => undefined,
    search: async () => soundCloudItems,
    browseLibrary: async () => [
      {
        id: 'soundcloud-liked',
        sourceId: 'soundcloud',
        kind: 'favorites',
        layout: 'list',
        items: soundCloudItems.filter((item) => item.type === 'track'),
      },
      {
        id: 'soundcloud-playlists',
        sourceId: 'soundcloud',
        kind: 'playlists',
        layout: 'grid',
        items: soundCloudItems.filter((item) => item.type === 'playlist'),
      },
    ],
    browseItem: async () => [
      {
        id: 'soundcloud-detail',
        sourceId: 'soundcloud',
        kind: 'tracks',
        layout: 'list',
        items: soundCloudItems.filter((item) => item.type === 'track'),
      },
    ],
    setFavorite: async () => undefined,
    getPlaybackSnapshot: async () => ({
      sourceId: 'soundcloud',
      targetId: 'this-display',
      state: 'idle',
      currentItem: null,
      positionMs: 0,
      updatedAt: new Date().toISOString(),
    }),
    getQueue: async () => ({ sourceId: 'soundcloud', items: [], currentIndex: null }),
  },
  {
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
    getAccountStatus: async () => ({ state: 'connected', displayName: 'Vishal' }),
    connect: async () => undefined,
    disconnect: async () => undefined,
    search: async () => youtubeItems,
    browseLibrary: async () => [
      {
        id: 'youtube-liked',
        sourceId: 'youtube_music',
        kind: 'favorites',
        layout: 'list',
        items: youtubeItems.filter((item) => item.type === 'track'),
      },
      {
        id: 'youtube-playlists',
        sourceId: 'youtube_music',
        kind: 'playlists',
        layout: 'grid',
        items: youtubeItems.filter((item) => item.type === 'playlist'),
      },
    ],
    browseItem: async () => [
      {
        id: 'youtube-detail',
        sourceId: 'youtube_music',
        kind: 'tracks',
        layout: 'list',
        items: youtubeItems.filter((item) => item.type === 'track'),
      },
    ],
    setFavorite: async () => undefined,
    listEditablePlaylists: async () => ({ items: editablePlaylists.youtube_music ?? [] }),
    canAddToPlaylist: (item) => item.type === 'track',
    addToPlaylist: async () => undefined,
    getPlaybackSnapshot: async () => ({
      sourceId: 'youtube_music',
      targetId: 'this-display',
      state: 'idle',
      currentItem: null,
      positionMs: 0,
      updatedAt: new Date().toISOString(),
    }),
    getQueue: async () => ({ sourceId: 'youtube_music', items: [], currentIndex: null }),
  },
];

const targets: MusicPlaybackTargetAdapter[] = [
  {
    id: 'preview-targets',
    listTargets: async (sourceId) =>
      sourceId === 'spotify'
        ? [
            {
              id: 'this-display',
              adapterId: 'preview-targets',
              name: 'This Navet display',
              kind: 'browser',
              sourceIds: ['spotify'],
              available: true,
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
            {
              id: 'living-room',
              adapterId: 'preview-targets',
              name: 'Living room',
              room: 'Living room',
              kind: 'connect',
              sourceIds: ['spotify'],
              available: true,
              isActive: true,
              capabilities: {
                enqueue: true,
                queuePositions: ['next', 'later'],
                grouping: true,
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
            {
              id: 'kitchen',
              adapterId: 'preview-targets',
              name: 'Kitchen',
              room: 'Kitchen',
              kind: 'smart_home',
              sourceIds: ['spotify'],
              available: true,
              capabilities: {
                enqueue: true,
                queuePositions: ['next', 'later'],
                grouping: true,
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
          ]
        : [
            {
              id: 'this-display',
              adapterId: 'preview-targets',
              name: 'This Navet display',
              kind: 'browser',
              sourceIds: [sourceId],
              available: true,
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
                  set_volume: false,
                  set_shuffle: false,
                  set_repeat: false,
                },
              },
            },
          ],
    play: async () => undefined,
    enqueue: async () => undefined,
    execute: async () => undefined,
    group: async () => undefined,
    ungroup: async () => undefined,
  },
];

function MusicSectionStory() {
  return (
    <div className="min-h-screen p-3 md:p-6">
      <MusicSection
        sourceAdapters={sources}
        playbackTargetAdapters={targets}
        includeNavetTargets={false}
      />
    </div>
  );
}

const meta = {
  title: 'Pages/Music/Native Music Hub',
  component: MusicSectionStory,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Provider-neutral listening surface with Spotify, Apple Music, SoundCloud, and YouTube Music libraries, ' +
          'capability-aware output selection, a single-source queue, and persistent now playing.',
      },
    },
  },
} satisfies Meta<typeof MusicSectionStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Desktop: Story = {};

export const TabletPortrait: Story = {
  globals: { viewport: { value: 'tablet', isRotated: false } },
};

export const Mobile: Story = {
  globals: { viewport: { value: 'mobile1', isRotated: false } },
};
