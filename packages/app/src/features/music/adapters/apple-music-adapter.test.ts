import type { MusicItem } from '@navet/core/music';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('appleMusicSourceAdapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('lets MusicKit queue playable songs, albums, and playlists but not artists', async () => {
    const { appleMusicBrowserTargetAdapter } = await import('./apple-music-adapter');
    const song: MusicItem = {
      id: 'song-1',
      sourceId: 'apple_music',
      type: 'track',
      title: 'Northbound',
      artists: ['Lumen'],
      playable: true,
      uri: 'apple:songs:song-1',
    };

    expect(appleMusicBrowserTargetAdapter.canEnqueue?.('apple-music-browser', song)).toBe(true);
    expect(
      appleMusicBrowserTargetAdapter.canEnqueue?.('apple-music-browser', {
        ...song,
        id: 'album-1',
        type: 'album',
        uri: 'apple:albums:album-1',
      })
    ).toBe(true);
    expect(
      appleMusicBrowserTargetAdapter.canEnqueue?.('apple-music-browser', {
        ...song,
        id: 'playlist-1',
        type: 'playlist',
        uri: 'apple:playlists:playlist-1',
      })
    ).toBe(true);
    expect(
      appleMusicBrowserTargetAdapter.canEnqueue?.('apple-music-browser', {
        ...song,
        id: 'artist-1',
        type: 'artist',
        playable: false,
        uri: 'apple:artists:artist-1',
      })
    ).toBe(false);
  });

  it('uses the matching MusicKit operation for play next and play later', async () => {
    const playNext = vi.fn(async () => ({}));
    const playLater = vi.fn(async () => ({}));
    const musicKit = {
      isAuthorized: true,
      authorize: vi.fn(),
      unauthorize: vi.fn(),
      api: { music: vi.fn() },
      setQueue: vi.fn(),
      playNext,
      playLater,
      play: vi.fn(),
      pause: vi.fn(),
      skipToNextItem: vi.fn(),
      skipToPreviousItem: vi.fn(),
      seekToTime: vi.fn(),
    };
    Object.defineProperty(window, 'MusicKit', {
      configurable: true,
      value: { configure: vi.fn(() => musicKit), getInstance: vi.fn(() => musicKit) },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ developerToken: 'x'.repeat(128) }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
      )
    );
    const { appleMusicBrowserTargetAdapter } = await import('./apple-music-adapter');
    const song: MusicItem = {
      id: 'song-1',
      sourceId: 'apple_music',
      type: 'track',
      title: 'Northbound',
      artists: ['Lumen'],
      playable: true,
      uri: 'apple:songs:song-1',
    };

    await appleMusicBrowserTargetAdapter.enqueue?.('apple-music-browser', song, {
      position: 'next',
    });
    await appleMusicBrowserTargetAdapter.enqueue?.('apple-music-browser', song, {
      position: 'later',
    });

    expect(playNext).toHaveBeenCalledWith({ song: 'song-1', startPlaying: false });
    expect(playLater).toHaveBeenCalledWith({ song: 'song-1', startPlaying: false });
    delete window.MusicKit;
  });

  it('adds catalog music to the Apple library without advertising unsupported removal', async () => {
    const apiMusic = vi.fn(async () => ({}));
    const musicKit = {
      isAuthorized: true,
      authorize: vi.fn(),
      unauthorize: vi.fn(),
      api: { music: apiMusic },
      setQueue: vi.fn(),
      play: vi.fn(),
      pause: vi.fn(),
      skipToNextItem: vi.fn(),
      skipToPreviousItem: vi.fn(),
      seekToTime: vi.fn(),
    };
    Object.defineProperty(window, 'MusicKit', {
      configurable: true,
      value: { configure: vi.fn(() => musicKit), getInstance: vi.fn(() => musicKit) },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ developerToken: 'x'.repeat(128) }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
      )
    );

    const { appleMusicSourceAdapter } = await import('./apple-music-adapter');
    const song: MusicItem = {
      id: 'song-1',
      sourceId: 'apple_music',
      type: 'track',
      title: 'Northbound',
      artists: ['Lumen'],
      playable: true,
      uri: 'apple:songs:song-1',
    };
    expect(appleMusicSourceAdapter.canSetFavorite?.(song)).toBe(true);
    await appleMusicSourceAdapter.setFavorite?.(song, true);
    expect(apiMusic).toHaveBeenCalledWith(
      '/v1/me/library',
      { ids: ['song-1'] },
      { fetchOptions: { method: 'POST' } }
    );
    expect(appleMusicSourceAdapter.canSetFavorite?.({ ...song, isFavorite: true })).toBe(false);
    expect(
      appleMusicSourceAdapter.canSetFavorite?.({
        ...song,
        id: 'library-song-1',
        uri: 'apple:library-songs:library-song-1',
      })
    ).toBe(false);
    await expect(appleMusicSourceAdapter.setFavorite?.(song, false)).rejects.toThrow(
      'Apple Music can only add catalog music to your library'
    );
    delete window.MusicKit;
  });

  it('lists editable Apple playlists and adds a song with the MusicKit user token', async () => {
    const apiMusic = vi.fn(async (path: string) => {
      if (path === '/v1/me/library/playlists') {
        return {
          data: [
            {
              id: 'p.editable1',
              type: 'library-playlists',
              attributes: { name: 'Kitchen rotation', canEdit: true },
            },
            {
              id: 'p.readonly1',
              type: 'library-playlists',
              attributes: { name: 'Read only', canEdit: false },
            },
          ],
          next: '/v1/me/library/playlists?offset=100',
        };
      }
      return {};
    });
    const musicKit = {
      isAuthorized: true,
      authorize: vi.fn(),
      unauthorize: vi.fn(),
      api: { music: apiMusic },
      setQueue: vi.fn(),
      play: vi.fn(),
      pause: vi.fn(),
      skipToNextItem: vi.fn(),
      skipToPreviousItem: vi.fn(),
      seekToTime: vi.fn(),
    };
    Object.defineProperty(window, 'MusicKit', {
      configurable: true,
      value: { configure: vi.fn(() => musicKit), getInstance: vi.fn(() => musicKit) },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ developerToken: 'x'.repeat(128) }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
      )
    );

    const { appleMusicSourceAdapter } = await import('./apple-music-adapter');
    const page = await appleMusicSourceAdapter.listEditablePlaylists?.();
    expect(page).toEqual({
      items: [
        expect.objectContaining({
          id: 'p.editable1',
          sourceId: 'apple_music',
          title: 'Kitchen rotation',
        }),
      ],
      continuation: 'offset:100',
    });
    const song: MusicItem = {
      id: 'song-1',
      sourceId: 'apple_music',
      type: 'track',
      title: 'Northbound',
      artists: ['Lumen'],
      playable: true,
      uri: 'apple:songs:song-1',
    };
    expect(appleMusicSourceAdapter.canAddToPlaylist?.(song)).toBe(true);
    const destination = page?.items[0];
    expect(destination).toBeDefined();
    if (!destination) throw new Error('Expected an editable Apple Music playlist');
    await appleMusicSourceAdapter.addToPlaylist?.(destination, song);
    expect(apiMusic).toHaveBeenLastCalledWith(
      '/v1/me/library/playlists/p.editable1/tracks',
      undefined,
      {
        fetchOptions: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ data: [{ id: 'song-1', type: 'songs' }] }),
        },
      }
    );
    delete window.MusicKit;
  });

  it('reports an unavailable authorization service without requesting a developer token', async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL) =>
        new Response(
          JSON.stringify({
            state: 'unavailable',
            reason: 'Navet Apple Music authorization is unavailable',
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }
        )
    );
    vi.stubGlobal('fetch', fetchMock);

    const { appleMusicSourceAdapter } = await import('./apple-music-adapter');

    await expect(appleMusicSourceAdapter.getAccountStatus()).resolves.toEqual({
      state: 'unavailable',
      reason: 'Navet Apple Music authorization is unavailable',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/__navet_music__/apple/status');
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain('/apple/developer-token');
  });

  it('authenticates the subscriber through MusicKit authorization', async () => {
    const authorize = vi.fn(async () => 'music-user-token');
    const musicKit = {
      isAuthorized: false,
      authorize,
      unauthorize: vi.fn(),
      api: { music: vi.fn() },
      setQueue: vi.fn(),
      play: vi.fn(),
      pause: vi.fn(),
      skipToNextItem: vi.fn(),
      skipToPreviousItem: vi.fn(),
      seekToTime: vi.fn(),
    };
    Object.defineProperty(window, 'MusicKit', {
      configurable: true,
      value: { configure: vi.fn(() => musicKit), getInstance: vi.fn(() => musicKit) },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ developerToken: 'navet-distributed-developer-token' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
      )
    );

    const { appleMusicSourceAdapter } = await import('./apple-music-adapter');
    await appleMusicSourceAdapter.connect();

    expect(authorize).toHaveBeenCalledTimes(1);
    delete window.MusicKit;
  });

  it('searches artists and turns Apple recommendations into titled shelves', async () => {
    const apiMusic = vi.fn(async (path: string) => {
      if (path.includes('/search')) {
        return {
          results: {
            artists: {
              data: [
                {
                  id: 'artist-1',
                  type: 'artists',
                  attributes: { name: 'Lumen' },
                },
              ],
            },
          },
        };
      }
      if (path === '/v1/me/recommendations') {
        return {
          data: [
            {
              id: 'made-for-you',
              type: 'personal-recommendation',
              attributes: { title: { stringForDisplay: 'Made for You' } },
              relationships: {
                contents: {
                  data: [
                    {
                      id: 'playlist-1',
                      type: 'playlists',
                      attributes: { name: 'New Music Mix' },
                    },
                  ],
                },
              },
            },
          ],
        };
      }
      return { data: [] };
    });
    const musicKit = {
      isAuthorized: true,
      storefrontId: 'se',
      authorize: vi.fn(),
      unauthorize: vi.fn(),
      api: { music: apiMusic },
      setQueue: vi.fn(),
      play: vi.fn(),
      pause: vi.fn(),
      skipToNextItem: vi.fn(),
      skipToPreviousItem: vi.fn(),
      seekToTime: vi.fn(),
    };
    Object.defineProperty(window, 'MusicKit', {
      configurable: true,
      value: { configure: vi.fn(() => musicKit), getInstance: vi.fn(() => musicKit) },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ developerToken: 'x'.repeat(128) }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
      )
    );

    const { appleMusicSourceAdapter } = await import('./apple-music-adapter');
    await expect(appleMusicSourceAdapter.search('lumen')).resolves.toEqual([
      expect.objectContaining({ id: 'artist-1', type: 'artist', title: 'Lumen' }),
    ]);
    await expect(appleMusicSourceAdapter.browseLibrary?.()).resolves.toEqual([
      expect.objectContaining({
        id: 'recommendation:made-for-you',
        kind: 'recommendations',
        title: 'Made for You',
        items: [expect.objectContaining({ id: 'playlist-1', type: 'playlist' })],
      }),
    ]);
    expect(apiMusic).toHaveBeenCalledWith(
      '/v1/catalog/se/search',
      expect.objectContaining({ types: 'songs,albums,playlists,artists' })
    );
    delete window.MusicKit;
  });

  it('loads another Apple library page from an opaque offset', async () => {
    const apiMusic = vi.fn(async () => ({
      data: [
        {
          id: 'song-21',
          type: 'library-songs',
          attributes: { name: 'Beyond the first page', artistName: 'Lumen' },
        },
      ],
    }));
    const musicKit = {
      isAuthorized: true,
      authorize: vi.fn(),
      unauthorize: vi.fn(),
      api: { music: apiMusic },
      setQueue: vi.fn(),
      play: vi.fn(),
      pause: vi.fn(),
      skipToNextItem: vi.fn(),
      skipToPreviousItem: vi.fn(),
      seekToTime: vi.fn(),
    };
    Object.defineProperty(window, 'MusicKit', {
      configurable: true,
      value: { configure: vi.fn(() => musicKit), getInstance: vi.fn(() => musicKit) },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ developerToken: 'x'.repeat(128) }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
      )
    );

    const { appleMusicSourceAdapter } = await import('./apple-music-adapter');
    await expect(
      appleMusicSourceAdapter.browseNextPage?.({
        id: 'songs',
        sourceId: 'apple_music',
        kind: 'tracks',
        layout: 'list',
        items: [],
        continuation: 'offset:20',
      })
    ).resolves.toEqual(
      expect.objectContaining({
        items: [expect.objectContaining({ id: 'song-21', title: 'Beyond the first page' })],
      })
    );
    expect(apiMusic).toHaveBeenCalledWith('/v1/me/library/songs', { limit: 50, offset: 20 });
    delete window.MusicKit;
  });

  it('exposes MusicKit volume, shuffle, and repeat controls', async () => {
    const musicKit = {
      isAuthorized: true,
      isPlaying: true,
      nowPlayingItem: {
        id: 'song-1',
        type: 'songs',
        attributes: { name: 'Northbound', artistName: 'Lumen' },
      },
      currentPlaybackTime: 12,
      currentPlaybackDuration: 180,
      volume: 0.4,
      shuffleMode: 'songs',
      repeatMode: 'all',
      authorize: vi.fn(),
      unauthorize: vi.fn(),
      api: { music: vi.fn() },
      setQueue: vi.fn(),
      play: vi.fn(),
      pause: vi.fn(),
      skipToNextItem: vi.fn(),
      skipToPreviousItem: vi.fn(),
      seekToTime: vi.fn(),
    };
    Object.defineProperty(window, 'MusicKit', {
      configurable: true,
      value: {
        PlayerRepeatMode: { all: 'all', none: 'none', one: 'one' },
        PlayerShuffleMode: { off: 'off', songs: 'songs' },
        configure: vi.fn(() => musicKit),
        getInstance: vi.fn(() => musicKit),
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ developerToken: 'x'.repeat(128) }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
      )
    );

    const { appleMusicBrowserTargetAdapter, appleMusicSourceAdapter } = await import(
      './apple-music-adapter'
    );
    await expect(appleMusicSourceAdapter.getPlaybackSnapshot?.()).resolves.toEqual(
      expect.objectContaining({
        state: 'playing',
        volume: 0.4,
        shuffle: true,
        repeat: 'all',
      })
    );
    await appleMusicBrowserTargetAdapter.execute('apple-music-browser', {
      type: 'set_volume',
      volume: 0.7,
    });
    await appleMusicBrowserTargetAdapter.execute('apple-music-browser', {
      type: 'set_shuffle',
      enabled: false,
    });
    await appleMusicBrowserTargetAdapter.execute('apple-music-browser', {
      type: 'set_repeat',
      mode: 'one',
    });

    expect(musicKit.volume).toBe(0.7);
    expect(musicKit.shuffleMode).toBe('off');
    expect(musicKit.repeatMode).toBe('one');
    delete window.MusicKit;
  });
});
