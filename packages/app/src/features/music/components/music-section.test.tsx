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
import { collapseQueueEntries, MusicSection } from './music-section';

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
      {
        id: 'living-room',
        adapterId: 'test-target',
        name: 'Living Room',
        room: 'Living Room',
        kind: 'connect',
        sourceIds: ['spotify'],
        available: true,
      },
    ]
  ),
  play: vi.fn(async () => undefined),
  enqueue: vi.fn(async () => undefined),
  execute: vi.fn(async () => undefined),
  group: vi.fn(async () => undefined),
  ungroup: vi.fn(async () => undefined),
};

describe('MusicSection', () => {
  it('collapses repeated upcoming queue entries without merging the current track', () => {
    expect(
      collapseQueueEntries({
        sourceId: 'spotify',
        items: [item, item, item, { ...item, id: 'next', title: 'Next song' }],
        currentIndex: 0,
      })
    ).toEqual([
      expect.objectContaining({ item, count: 1, startIndex: 0, isCurrent: true }),
      expect.objectContaining({ item, count: 2, startIndex: 1, isCurrent: false }),
      expect.objectContaining({ count: 1, startIndex: 3, isCurrent: false }),
    ]);
  });

  it('keeps Spotify configuration editable after the account is connected', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          spotify: {
            configured: true,
            source: 'stored',
            clientIdHint: '1234',
            redirectUri: 'https://navet.app/redirect/oauth',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    renderWithProviders(
      <MusicSection
        sourceAdapters={[source]}
        playbackTargetAdapters={[]}
        includeNavetTargets={false}
      />
    );

    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'Manage services' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));

    expect(await screen.findByLabelText('Spotify Client ID')).toBeVisible();
    expect(screen.getByPlaceholderText('••••1234')).toBeVisible();
  });

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

    fireEvent.click(await screen.findByRole('button', { name: 'Set up services' }));
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
    expect(screen.getByLabelText('Playing on Kitchen')).toBeVisible();
    expect(screen.getByRole('slider', { name: 'Seek' })).toBeVisible();
    expect(screen.getByRole('slider', { name: 'Volume' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Linear playback' }));
    fireEvent.click(screen.getByRole('button', { name: 'Repeat off' }));
    await waitFor(() => {
      expect(target.execute).toHaveBeenCalledWith('kitchen', {
        type: 'set_shuffle',
        enabled: true,
      });
      expect(target.execute).toHaveBeenCalledWith('kitchen', {
        type: 'set_repeat',
        mode: 'all',
      });
    });
    expect(screen.queryByText('Household')).not.toBeInTheDocument();
    expect(screen.getByText('Spotify · Connected')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Group speakers' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Living Room' }));
    fireEvent.click(screen.getByRole('button', { name: 'Play on this group' }));
    await waitFor(() => expect(target.group).toHaveBeenCalledWith('kitchen', ['living-room']));
    fireEvent.click(await screen.findByRole('button', { name: 'Manage services' }));
    expect(screen.getByText('Household')).toBeVisible();
  });
});
