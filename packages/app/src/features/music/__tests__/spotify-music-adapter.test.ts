import type { MusicItem } from '@navet/core/music';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  disconnectSpotifyBrowserPlayer,
  spotifyBrowserPlaybackTargetAdapter,
  spotifyMusicSourceAdapter,
  spotifyPlaybackTargetAdapter,
} from '../adapters/spotify-music-adapter';

afterEach(() => {
  disconnectSpotifyBrowserPlayer();
  delete window.Spotify;
  delete window.onSpotifyWebPlaybackSDKReady;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Spotify music adapter', () => {
  it('advertises favorite, playlist, and queue mutations only for item types Spotify accepts', () => {
    const track: MusicItem = {
      id: 'track-1',
      sourceId: 'spotify',
      type: 'track',
      title: 'Northbound',
      artists: ['Lumen'],
      playable: true,
      uri: 'spotify:track:track-1',
    };
    const playlist: MusicItem = {
      ...track,
      id: 'playlist-1',
      type: 'playlist',
      title: 'Sunday rotation',
      uri: 'spotify:playlist:playlist-1',
    };
    const artist: MusicItem = {
      ...track,
      id: 'artist-1',
      type: 'artist',
      title: 'Lumen',
      playable: false,
      uri: 'spotify:artist:artist-1',
    };

    expect(spotifyMusicSourceAdapter.canSetFavorite?.(track)).toBe(true);
    expect(spotifyMusicSourceAdapter.canSetFavorite?.(playlist)).toBe(true);
    expect(spotifyMusicSourceAdapter.canSetFavorite?.(artist)).toBe(false);
    expect(spotifyMusicSourceAdapter.canAddToPlaylist?.(track)).toBe(true);
    expect(spotifyMusicSourceAdapter.canAddToPlaylist?.(playlist)).toBe(false);
    expect(spotifyPlaybackTargetAdapter.canEnqueue?.('kitchen', track, 'next')).toBe(true);
    expect(spotifyPlaybackTargetAdapter.canEnqueue?.('kitchen', track, 'later')).toBe(false);
    expect(spotifyPlaybackTargetAdapter.canEnqueue?.('kitchen', playlist)).toBe(false);
  });

  it('maps Spotify queueing to play next and rejects unsupported add-to-end', async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL) => new Response(null, { status: 204 })
    );
    vi.stubGlobal('fetch', fetchMock);
    const track: MusicItem = {
      id: 'track-1',
      sourceId: 'spotify',
      type: 'track',
      title: 'Northbound',
      artists: ['Lumen'],
      playable: true,
      uri: 'spotify:track:track-1',
    };

    await spotifyPlaybackTargetAdapter.enqueue?.('kitchen', track, { position: 'next' });

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/v1/me/player/queue?');
    await expect(
      spotifyPlaybackTargetAdapter.enqueue?.('kitchen', track, { position: 'later' })
    ).rejects.toThrow('Spotify can only play a track next');
  });

  it('loads saved music, top artists, and actual recently played tracks into shelves', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ items: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ items: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ items: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            items: [
              {
                track: {
                  id: 'recent-1',
                  uri: 'spotify:track:recent-1',
                  name: 'Recently heard',
                  artists: [{ name: 'Lumen' }],
                  album: { name: 'Night Lines', images: [] },
                },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            items: [
              {
                id: 'artist-1',
                uri: 'spotify:artist:artist-1',
                name: 'Lumen',
                images: [{ url: 'https://img.test/artist.jpg' }],
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(spotifyMusicSourceAdapter.browseLibrary?.()).resolves.toEqual([
      expect.objectContaining({
        id: 'recent',
        kind: 'recent',
        items: [expect.objectContaining({ id: 'recent-1', title: 'Recently heard' })],
      }),
      expect.objectContaining({
        id: 'top-artists',
        kind: 'artists',
        items: [expect.objectContaining({ id: 'artist-1', title: 'Lumen' })],
      }),
    ]);
    expect(fetchMock.mock.calls[3]?.[0]).toContain('/me/player/recently-played?limit=20');
    expect(fetchMock.mock.calls[4]?.[0]).toContain('/me/top/artists?');
  });

  it('asks accounts with the old OAuth grant to reconnect for library permissions', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation(
          async () =>
            new Response(
              JSON.stringify({ error: { status: 403, message: 'Insufficient client scope' } }),
              { status: 403, headers: { 'Content-Type': 'application/json' } }
            )
        )
    );

    await expect(spotifyMusicSourceAdapter.browseLibrary?.()).rejects.toThrow(
      'Reconnect Spotify to load your complete music library.'
    );
  });

  it('loads the next saved-track page from a validated offset cursor', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [
            {
              track: {
                id: 'track-21',
                uri: 'spotify:track:track-21',
                name: 'Beyond the first page',
                artists: [{ name: 'Lumen' }],
              },
            },
          ],
          next: null,
          offset: 20,
          limit: 50,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      spotifyMusicSourceAdapter.browseNextPage?.({
        id: 'liked-tracks',
        sourceId: 'spotify',
        kind: 'favorites',
        layout: 'list',
        items: [],
        continuation: 'offset:20',
      })
    ).resolves.toEqual(
      expect.objectContaining({
        continuation: undefined,
        items: [
          expect.objectContaining({
            id: 'track-21',
            isFavorite: true,
            title: 'Beyond the first page',
          }),
        ],
      })
    );
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/me/tracks?limit=50&offset=20');
  });

  it('rejects malformed Spotify pagination without making a provider request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      spotifyMusicSourceAdapter.browseNextPage?.({
        id: 'liked-tracks',
        sourceId: 'spotify',
        kind: 'favorites',
        layout: 'list',
        items: [],
        continuation: 'https://attacker.example/next',
      })
    ).rejects.toThrow('Invalid Spotify page cursor');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lists only editable Spotify playlists and adds a track through the current items API', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/spotify/api/v1/me')) {
        return new Response(JSON.stringify({ id: 'vishal_user' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('/v1/me/playlists')) {
        return new Response(
          JSON.stringify({
            items: [
              {
                id: 'ownedplaylist1',
                name: 'Kitchen rotation',
                owner: { id: 'vishal_user' },
                images: [{ url: 'https://img.test/playlist.jpg' }],
              },
              {
                id: 'someoneelses',
                name: 'Read only',
                owner: { id: 'another-user' },
              },
            ],
            next: 'https://api.spotify.com/v1/me/playlists?limit=50&offset=50',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      expect(init).toEqual(
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ uris: ['spotify:track:track1'] }),
        })
      );
      return new Response(JSON.stringify({ snapshot_id: 'snapshot-1' }), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const page = await spotifyMusicSourceAdapter.listEditablePlaylists?.();
    expect(page).toEqual({
      items: [
        expect.objectContaining({
          id: 'ownedplaylist1',
          sourceId: 'spotify',
          title: 'Kitchen rotation',
        }),
      ],
      continuation: 'offset:50',
    });

    const destination = page?.items[0];
    expect(destination).toBeDefined();
    if (!destination) throw new Error('Expected an editable Spotify playlist');
    await spotifyMusicSourceAdapter.addToPlaylist?.(destination, {
      id: 'track1',
      sourceId: 'spotify',
      type: 'track',
      title: 'Northbound',
      artists: ['Lumen'],
      playable: true,
      uri: 'spotify:track:track1',
    });
    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain(
      '/spotify/api/v1/playlists/ownedplaylist1/items'
    );
  });

  it('normalizes federated search results into source-scoped music items', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          tracks: {
            items: [
              {
                id: 'track-1',
                uri: 'spotify:track:track-1',
                name: 'Northbound',
                duration_ms: 184000,
                artists: [{ name: 'Lumen' }],
                album: { name: 'Night Lines', images: [{ url: 'https://img.test/cover.jpg' }] },
              },
            ],
          },
          albums: { items: [] },
          playlists: { items: [] },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(spotifyMusicSourceAdapter.search('north')).resolves.toEqual([
      expect.objectContaining({
        id: 'track-1',
        sourceId: 'spotify',
        type: 'track',
        title: 'Northbound',
        artists: ['Lumen'],
        playable: true,
      }),
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/__navet_music__/spotify/api/v1/search?'),
      expect.objectContaining({ credentials: 'same-origin' })
    );
  });

  it('exposes only usable Spotify Connect devices as targets', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            devices: [
              {
                id: 'kitchen',
                name: 'Kitchen',
                is_active: true,
                is_restricted: false,
                supports_volume: true,
              },
              {
                id: 'locked',
                name: 'Locked speaker',
                is_restricted: true,
                supports_volume: false,
              },
              { name: 'Missing identity' },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )
    );

    await expect(spotifyPlaybackTargetAdapter.listTargets('spotify')).resolves.toEqual([
      expect.objectContaining({
        id: 'kitchen',
        available: true,
        isActive: true,
        capabilities: expect.objectContaining({
          transport: expect.objectContaining({ set_volume: true }),
        }),
      }),
      expect.objectContaining({
        id: 'locked',
        available: false,
        capabilities: expect.objectContaining({
          transport: expect.objectContaining({ set_volume: false }),
        }),
      }),
    ]);
  });

  it('maps Spotify playback volume, shuffle, and repeat state', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            sourceId: 'spotify',
            targetId: 'old-sonos-session',
            targetAdapterId: 'navet-music-engine',
            state: 'playing',
            currentItem: {
              id: 'stale-track',
              sourceId: 'spotify',
              type: 'track',
              title: 'Stale engine track',
              artists: [],
              playable: true,
              uri: 'spotify:track:stale-track',
            },
            positionMs: 80_000,
            updatedAt: '2026-08-02T00:00:00.000Z',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            is_playing: true,
            timestamp: Date.parse('2026-08-02T00:01:00.000Z'),
            progress_ms: 12_000,
            repeat_state: 'context',
            shuffle_state: true,
            device: { id: 'kitchen', volume_percent: 64, supports_volume: true },
            item: {
              id: 'track-1',
              uri: 'spotify:track:track-1',
              name: 'Northbound',
              duration_ms: 184_000,
              artists: [{ name: 'Lumen' }],
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(spotifyMusicSourceAdapter.getPlaybackSnapshot?.()).resolves.toEqual(
      expect.objectContaining({
        targetId: 'kitchen',
        targetAdapterId: 'spotify-connect',
        currentItem: expect.objectContaining({ id: 'track-1' }),
        state: 'playing',
        positionMs: 12_000,
        volume: 0.64,
        shuffle: true,
        repeat: 'all',
      })
    );
  });

  it('hands a track to the selected Connect target without proxying audio', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await spotifyPlaybackTargetAdapter.play('kitchen', {
      id: 'track-1',
      sourceId: 'spotify',
      type: 'track',
      title: 'Northbound',
      artists: ['Lumen'],
      playable: true,
      uri: 'spotify:track:track-1',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/spotify/api/v1/me/player/play?device_id=kitchen'),
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ uris: ['spotify:track:track-1'] }),
      })
    );
  });

  it('turns this Navet display into an official Spotify browser target', async () => {
    const listeners = new Map<string, (value: Record<string, unknown>) => void>();
    const activateElement = vi.fn(async () => undefined);
    const disconnect = vi.fn();
    class Player {
      activateElement = activateElement;
      disconnect = disconnect;

      constructor(options: { getOAuthToken: (callback: (token: string) => void) => void }) {
        options.getOAuthToken(() => undefined);
      }

      addListener(event: string, listener: (value: Record<string, unknown>) => void) {
        listeners.set(event, listener);
        return true;
      }

      async connect() {
        listeners.get('ready')?.({ device_id: 'navet-browser-device' });
        return true;
      }
    }
    Object.defineProperty(window, 'Spotify', {
      configurable: true,
      value: { Player },
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/spotify/sdk-token')) {
        return new Response(JSON.stringify({ accessToken: 'browser-access-token' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(null, { status: 204 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(spotifyBrowserPlaybackTargetAdapter.listTargets('spotify')).resolves.toEqual([
      expect.objectContaining({
        id: 'navet-browser-device',
        adapterId: 'spotify-browser',
        kind: 'browser',
        available: true,
      }),
    ]);
    await spotifyBrowserPlaybackTargetAdapter.play('navet-browser-device', {
      id: 'track-1',
      sourceId: 'spotify',
      type: 'track',
      title: 'Northbound',
      artists: ['Lumen'],
      playable: true,
      uri: 'spotify:track:track-1',
    });

    expect(activateElement).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/spotify/api/v1/me/player'),
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({ device_ids: ['navet-browser-device'], play: false }),
      })
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/spotify/api/v1/me/player/play?device_id=navet-browser-device'),
      expect.objectContaining({ method: 'PUT' })
    );
  });

  it('translates Navet repeat modes to Spotify track and context values', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);

    await spotifyPlaybackTargetAdapter.execute('kitchen', { type: 'set_repeat', mode: 'one' });
    await spotifyPlaybackTargetAdapter.execute('kitchen', { type: 'set_repeat', mode: 'all' });

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('state=track');
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('state=context');
  });
});
