import artwork from '@assets/reference/media/artworks-original.jpg';
import type { MusicItem, MusicPlaybackTargetAdapter, MusicSourceAdapter } from '@navet/core/music';
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
];

const sources: MusicSourceAdapter[] = [
  {
    id: 'spotify',
    name: 'Spotify',
    capabilities: {
      search: true,
      library: true,
      queue: true,
      favorites: true,
      browserPlayback: false,
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
    browseLibrary: async () => spotifyItems,
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
    capabilities: {
      search: true,
      library: true,
      queue: true,
      favorites: false,
      browserPlayback: true,
      playbackHandoff: false,
    },
    getAccountStatus: async () => ({ state: 'connected', displayName: 'Apple Music subscriber' }),
    connect: async () => undefined,
    disconnect: async () => undefined,
    search: async () => appleItems,
    browseLibrary: async () => appleItems,
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
];

const targets: MusicPlaybackTargetAdapter[] = [
  {
    id: 'preview-targets',
    listTargets: async (sourceId) =>
      sourceId === 'spotify'
        ? [
            {
              id: 'living-room',
              adapterId: 'preview-targets',
              name: 'Living room',
              room: 'Living room',
              kind: 'connect',
              sourceIds: ['spotify'],
              available: true,
              isActive: true,
            },
            {
              id: 'kitchen',
              adapterId: 'preview-targets',
              name: 'Kitchen',
              room: 'Kitchen',
              kind: 'smart_home',
              sourceIds: ['spotify'],
              available: true,
            },
          ]
        : [
            {
              id: 'this-display',
              adapterId: 'preview-targets',
              name: 'This Navet display',
              kind: 'browser',
              sourceIds: ['apple_music'],
              available: true,
            },
          ],
    play: async () => undefined,
    enqueue: async () => undefined,
    execute: async () => undefined,
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
          'Provider-neutral listening surface with federated Spotify and Apple Music libraries, ' +
          'capability-aware output selection, a single-source queue, and persistent now playing.',
      },
    },
  },
} satisfies Meta<typeof MusicSectionStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Desktop: Story = {};

export const TabletPortrait: Story = {
  parameters: { viewport: { defaultViewport: 'tablet' } },
};

export const Mobile: Story = {
  parameters: { viewport: { defaultViewport: 'mobile1' } },
};
