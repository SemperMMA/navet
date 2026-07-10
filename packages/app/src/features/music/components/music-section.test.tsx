import { renderWithProviders } from '@navet/app/test/render';
import type {
  MusicAccountStatus,
  MusicPlaybackSnapshot,
  MusicPlaybackTarget,
  MusicPlaybackTargetAdapter,
  MusicQueueSnapshot,
  MusicSourceAdapter,
} from '@navet/core/music';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MusicSection } from './music-section';

const item = {
  id: 'northbound',
  sourceId: 'spotify' as const,
  type: 'track' as const,
  title: 'Northbound',
  artists: ['Lumen'],
  album: 'Night Lines',
  playable: true,
  uri: 'spotify:track:northbound',
};

const source: MusicSourceAdapter = {
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
  getAccountStatus: vi.fn(
    async (): Promise<MusicAccountStatus> => ({
      state: 'connected',
      displayName: 'Household',
    })
  ),
  connect: vi.fn(async () => undefined),
  disconnect: vi.fn(async () => undefined),
  search: vi.fn(async () => [item]),
  browseLibrary: vi.fn(async () => [item]),
  getPlaybackSnapshot: vi.fn(
    async (): Promise<MusicPlaybackSnapshot> => ({
      sourceId: 'spotify',
      targetId: 'kitchen',
      state: 'playing',
      currentItem: item,
      positionMs: 20_000,
      durationMs: 180_000,
      updatedAt: '2026-07-10T00:00:00.000Z',
    })
  ),
  getQueue: vi.fn(
    async (): Promise<MusicQueueSnapshot> => ({
      sourceId: 'spotify',
      items: [item],
      currentIndex: 0,
    })
  ),
};

const target: MusicPlaybackTargetAdapter = {
  id: 'test-target',
  listTargets: vi.fn(
    async (): Promise<MusicPlaybackTarget[]> => [
      {
        id: 'kitchen',
        adapterId: 'test-target',
        name: 'Kitchen',
        room: 'Kitchen',
        kind: 'connect',
        sourceIds: ['spotify'],
        available: true,
        isActive: true,
      },
    ]
  ),
  play: vi.fn(async () => undefined),
  enqueue: vi.fn(async () => undefined),
  execute: vi.fn(async () => undefined),
};

describe('MusicSection', () => {
  it('starts MusicKit authentication instead of opening token configuration', async () => {
    const connect = vi.fn(async () => undefined);
    const appleSource: MusicSourceAdapter = {
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
      getAccountStatus: vi.fn(
        async (): Promise<MusicAccountStatus> => ({
          state: 'unavailable',
          reason: 'Apple Music authorization is temporarily unavailable',
        })
      ),
      connect,
      disconnect: vi.fn(async () => undefined),
      search: vi.fn(async () => []),
    };

    renderWithProviders(
      <MusicSection
        sourceAdapters={[appleSource]}
        playbackTargetAdapters={[]}
        includeNavetTargets={false}
      />
    );

    const authenticate = await screen.findByRole('button', { name: 'Authenticate' });
    fireEvent.click(authenticate);
    await waitFor(() => expect(connect).toHaveBeenCalledTimes(1));
    expect(screen.queryByLabelText('MusicKit developer token')).not.toBeInTheDocument();
  });

  it('renders connected libraries, compatible outputs, queue, and now playing state', async () => {
    renderWithProviders(
      <MusicSection
        sourceAdapters={[source]}
        playbackTargetAdapters={[target]}
        includeNavetTargets={false}
      />
    );

    expect(screen.getByRole('heading', { name: 'Music, wherever it should play.' })).toBeVisible();
    await waitFor(() => expect(screen.getAllByText('Northbound').length).toBeGreaterThan(1));
    expect(screen.getAllByText('Kitchen')[0]).toBeVisible();
    expect(screen.getByText('Household')).toBeVisible();
  });
});
