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
import { afterEach, describe, expect, it, vi } from 'vitest';
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
    itemDetails: true,
    queue: true,
    favorites: true,
    favoriteMutation: true,
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
  browseLibrary: vi.fn(async () => [
    {
      id: 'liked-tracks',
      sourceId: 'spotify' as const,
      kind: 'favorites' as const,
      layout: 'list' as const,
      items: [item],
    },
  ]),
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

function mockMusicConfiguration() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
        spotify: {
          configured: true,
          source: 'stored',
          clientIdHint: '1234',
          redirectUri: 'https://navet.app/redirect/oauth',
        },
        apple: { configured: false, source: 'hosted' },
        soundcloud: {
          configured: false,
          source: 'none',
          clientIdHint: null,
          secretConfigured: false,
          redirectUri: 'https://navet.app/redirect/oauth',
        },
        youtube: {
          configured: false,
          source: 'none',
          clientIdHint: null,
          secretConfigured: false,
          redirectUri: 'https://navet.app/redirect/oauth',
        },
      })
    )
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

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

  it('keeps OAuth as the account action while exposing installation setup in Navet', async () => {
    mockMusicConfiguration();
    renderWithProviders(
      <MusicSection
        sourceAdapters={[source]}
        playbackTargetAdapters={[]}
        includeNavetTargets={false}
      />
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Manage services' }));
    expect(await screen.findByRole('button', { name: 'Disconnect' })).toBeVisible();
    fireEvent.click(await screen.findByRole('button', { name: 'Spotify' }));
    expect(await screen.findByLabelText('Client ID')).toBeVisible();
    expect(screen.queryByLabelText('Client secret')).not.toBeInTheDocument();
  });

  it('opens installation setup when a provider app is unavailable', async () => {
    mockMusicConfiguration();
    const connect = vi.fn(async () => undefined);
    const unconfiguredSpotify: MusicSourceAdapter = {
      ...source,
      getAccountStatus: vi.fn(
        async (): Promise<MusicAccountStatus> => ({
          state: 'unavailable',
          reason: 'Spotify is not configured for this Navet installation',
          canConnect: false,
        })
      ),
      connect,
    };

    renderWithProviders(
      <MusicSection
        sourceAdapters={[unconfiguredSpotify]}
        playbackTargetAdapters={[]}
        includeNavetTargets={false}
      />
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Set up services' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Set up' }));
    expect(await screen.findByLabelText('Client ID')).toBeVisible();
    expect(connect).not.toHaveBeenCalled();
  });

  it('starts MusicKit authentication instead of opening token configuration', async () => {
    mockMusicConfiguration();
    const connect = vi.fn(async () => undefined);
    const appleSource: MusicSourceAdapter = {
      id: 'apple_music',
      name: 'Apple Music',
      capabilities: {
        search: true,
        library: true,
        itemDetails: true,
        queue: true,
        favorites: false,
        favoriteMutation: false,
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

  it('clears playback state after disconnecting its music service', async () => {
    const disconnect = vi.fn(async () => undefined);
    const disconnectableSource: MusicSourceAdapter = { ...source, disconnect };

    renderWithProviders(
      <MusicSection
        sourceAdapters={[disconnectableSource]}
        playbackTargetAdapters={[target]}
        includeNavetTargets={false}
      />
    );

    expect(await screen.findByLabelText('Playing on Kitchen')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Manage services' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Disconnect' }));

    await waitFor(() => expect(disconnect).toHaveBeenCalledTimes(1));
    expect(screen.queryByLabelText('Playing on Kitchen')).not.toBeInTheDocument();
  });

  it('renders connected libraries, compatible outputs, queue, and now playing state', async () => {
    renderWithProviders(
      <MusicSection
        sourceAdapters={[source]}
        playbackTargetAdapters={[target]}
        includeNavetTargets={false}
      />
    );

    expect(screen.getByRole('heading', { name: 'Music' })).toBeVisible();
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
    expect(screen.getByText('Spotify')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Group speakers' }));
    fireEvent.click(screen.getByRole('button', { name: 'Attach Living Room' }));
    await waitFor(() => expect(target.group).toHaveBeenCalledWith('kitchen', ['living-room']));
    fireEvent.click(await screen.findByRole('button', { name: 'Manage services' }));
    expect(screen.getByText('Household')).toBeVisible();
  });

  it('shows only item actions supported by the provider and selected output', async () => {
    const playlist = {
      ...item,
      id: 'sunday-rotation',
      type: 'playlist' as const,
      title: 'Sunday rotation',
      uri: 'spotify:playlist:sunday-rotation',
    };
    const artist = {
      ...item,
      id: 'lumen',
      type: 'artist' as const,
      title: 'Lumen',
      playable: false,
      uri: 'spotify:artist:lumen',
    };
    const typeAwareSource: MusicSourceAdapter = {
      ...source,
      canSetFavorite: (candidate) => candidate.type !== 'artist',
      browseLibrary: vi.fn(async () => [
        {
          id: 'collections',
          sourceId: 'spotify',
          kind: 'playlists' as const,
          layout: 'grid' as const,
          items: [playlist, artist],
        },
      ]),
    };
    const enqueue = vi.fn(async () => undefined);
    const typeAwareTarget: MusicPlaybackTargetAdapter = {
      ...target,
      enqueue,
      canEnqueue: (_targetId, candidate) => candidate.type === 'playlist',
      listTargets: vi.fn(
        async (): Promise<MusicPlaybackTarget[]> => [
          {
            id: 'kitchen',
            adapterId: 'test-target',
            name: 'Kitchen',
            kind: 'connect',
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
        ]
      ),
    };

    renderWithProviders(
      <MusicSection
        sourceAdapters={[typeAwareSource]}
        playbackTargetAdapters={[typeAwareTarget]}
        includeNavetTargets={false}
      />
    );

    const actions = await screen.findByRole('button', {
      name: 'More actions: Sunday rotation',
    });
    expect(screen.queryByRole('button', { name: 'Save: Lumen' })).not.toBeInTheDocument();
    fireEvent.pointerDown(actions);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Play next' }));
    await waitFor(() =>
      expect(enqueue).toHaveBeenCalledWith('kitchen', playlist, { position: 'next' })
    );
    fireEvent.pointerDown(actions);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Add to end of queue' }));
    await waitFor(() =>
      expect(enqueue).toHaveBeenCalledWith('kitchen', playlist, { position: 'later' })
    );
  });

  it('adds a supported track to an editable provider playlist', async () => {
    const listEditablePlaylists = vi.fn(async () => ({
      items: [
        {
          id: 'kitchen-rotation',
          sourceId: 'spotify' as const,
          title: 'Kitchen rotation',
        },
      ],
    }));
    const addToPlaylist = vi.fn(async () => undefined);
    const playlistSource: MusicSourceAdapter = {
      ...source,
      capabilities: { ...source.capabilities, playlistMutation: true },
      listEditablePlaylists,
      canAddToPlaylist: (candidate) => candidate.type === 'track',
      addToPlaylist,
    };

    renderWithProviders(
      <MusicSection
        sourceAdapters={[playlistSource]}
        playbackTargetAdapters={[]}
        includeNavetTargets={false}
      />
    );

    fireEvent.pointerDown(await screen.findByRole('button', { name: 'More actions: Northbound' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Add to playlist' }));
    const destination = await screen.findByRole('button', {
      name: 'Add to playlist: Kitchen rotation',
    });
    fireEvent.click(destination);

    await waitFor(() =>
      expect(addToPlaylist).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'kitchen-rotation', sourceId: 'spotify' }),
        item
      )
    );
    expect(listEditablePlaylists).toHaveBeenCalledWith(
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it('loads and deduplicates another provider library page', async () => {
    const nextItem = { ...item, id: 'southbound', title: 'Southbound' };
    const browseNextPage = vi.fn(async () => ({
      id: 'liked-tracks',
      sourceId: 'spotify',
      kind: 'favorites' as const,
      layout: 'list' as const,
      items: [item, nextItem],
    }));
    const pagedSource: MusicSourceAdapter = {
      ...source,
      browseLibrary: vi.fn(async () => [
        {
          id: 'liked-tracks',
          sourceId: 'spotify',
          kind: 'favorites' as const,
          layout: 'list' as const,
          items: [item],
          continuation: 'offset:20',
        },
      ]),
      browseNextPage,
    };

    renderWithProviders(
      <MusicSection
        sourceAdapters={[pagedSource]}
        playbackTargetAdapters={[]}
        includeNavetTargets={false}
      />
    );

    const loadMore = await screen.findByRole('button', { name: 'Load more Liked songs' });
    const northboundCount = screen.getAllByText('Northbound').length;
    fireEvent.click(loadMore);
    expect(await screen.findByText('Southbound')).toBeVisible();
    expect(screen.getAllByText('Northbound')).toHaveLength(northboundCount);
    expect(browseNextPage).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'liked-tracks', continuation: 'offset:20' })
    );
    expect(screen.queryByRole('button', { name: 'Load more Liked songs' })).not.toBeInTheDocument();
  });

  it('shows fast playback outputs without waiting for a slow provider SDK', async () => {
    let resolveSlow: (targets: MusicPlaybackTarget[]) => void = () => undefined;
    const slowTarget: MusicPlaybackTargetAdapter = {
      id: 'slow-browser-sdk',
      listTargets: vi.fn(
        async () =>
          await new Promise<MusicPlaybackTarget[]>((resolve) => {
            resolveSlow = resolve;
          })
      ),
      play: vi.fn(async () => undefined),
      execute: vi.fn(async () => undefined),
    };
    const fastTarget: MusicPlaybackTargetAdapter = {
      id: 'fast-connect',
      listTargets: vi.fn(
        async (): Promise<MusicPlaybackTarget[]> => [
          {
            id: 'fast-output',
            adapterId: 'fast-connect',
            name: 'Fast output',
            kind: 'connect',
            sourceIds: ['spotify'],
            available: true,
          },
        ]
      ),
      play: vi.fn(async () => undefined),
      execute: vi.fn(async () => undefined),
    };

    renderWithProviders(
      <MusicSection
        sourceAdapters={[source]}
        playbackTargetAdapters={[slowTarget, fastTarget]}
        includeNavetTargets={false}
      />
    );

    expect(await screen.findByRole('button', { name: 'Play on: Fast output' })).toBeVisible();
    resolveSlow([]);
    await waitFor(() => expect(slowTarget.listTargets).toHaveBeenCalledTimes(1));
  });

  it('keeps same-ID targets from different adapters independently selectable', async () => {
    const firstPlay = vi.fn(async () => undefined);
    const secondPlay = vi.fn(async () => undefined);
    const firstTarget: MusicPlaybackTargetAdapter = {
      id: 'first-adapter',
      listTargets: vi.fn(
        async (): Promise<MusicPlaybackTarget[]> => [
          {
            id: 'shared-device-id',
            adapterId: 'first-adapter',
            name: 'First output',
            kind: 'connect',
            sourceIds: ['spotify'],
            available: true,
          },
        ]
      ),
      play: firstPlay,
      execute: vi.fn(async () => undefined),
    };
    const secondTarget: MusicPlaybackTargetAdapter = {
      id: 'second-adapter',
      listTargets: vi.fn(
        async (): Promise<MusicPlaybackTarget[]> => [
          {
            id: 'shared-device-id',
            adapterId: 'second-adapter',
            name: 'Second output',
            kind: 'smart_home',
            sourceIds: ['spotify'],
            available: true,
          },
        ]
      ),
      play: secondPlay,
      execute: vi.fn(async () => undefined),
    };

    renderWithProviders(
      <MusicSection
        sourceAdapters={[source]}
        playbackTargetAdapters={[firstTarget, secondTarget]}
        includeNavetTargets={false}
      />
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Play on: Second output' }));
    const playButtons = await screen.findAllByRole('button', { name: 'Play Northbound' });
    const playButton = playButtons.at(-1);
    expect(playButton).toBeDefined();
    if (playButton) fireEvent.click(playButton);

    await waitFor(() =>
      expect(secondPlay).toHaveBeenCalledWith('shared-device-id', item, {
        replaceQueue: true,
      })
    );
    expect(firstPlay).not.toHaveBeenCalled();
  });

  it('does not reserve player space when nothing is playing', async () => {
    const idleSource: MusicSourceAdapter = {
      ...source,
      getPlaybackSnapshot: vi.fn(
        async (): Promise<MusicPlaybackSnapshot> => ({
          sourceId: 'spotify',
          targetId: null,
          state: 'idle',
          currentItem: null,
          positionMs: 0,
          updatedAt: '2026-08-02T00:00:00.000Z',
        })
      ),
      getQueue: vi.fn(
        async (): Promise<MusicQueueSnapshot> => ({
          sourceId: 'spotify',
          items: [],
          currentIndex: null,
        })
      ),
    };

    renderWithProviders(
      <MusicSection
        sourceAdapters={[idleSource]}
        playbackTargetAdapters={[target]}
        includeNavetTargets={false}
      />
    );

    await waitFor(() => expect(idleSource.getPlaybackSnapshot).toHaveBeenCalled());
    expect(screen.queryByText('No playback')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resume playback' })).not.toBeInTheDocument();
  });
});
