import type { MusicItem } from '@navet/core/music';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  soundCloudBrowserTargetAdapter,
  soundCloudMusicSourceAdapter,
} from './soundcloud-music-adapter';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('SoundCloud music adapter', () => {
  it('supports likes, follows, and browser queueing only for safe resources', () => {
    const playlist: MusicItem = {
      id: 'soundcloud:playlists:7',
      sourceId: 'soundcloud',
      type: 'playlist',
      title: 'Sunday rotation',
      artists: ['Navet Sessions'],
      playable: true,
      uri: 'https://soundcloud.com/navet/sets/sunday',
    };

    expect(soundCloudMusicSourceAdapter.canSetFavorite?.(playlist)).toBe(true);
    expect(soundCloudBrowserTargetAdapter.canEnqueue?.('soundcloud-browser', playlist)).toBe(true);
    expect(
      soundCloudMusicSourceAdapter.canSetFavorite?.({
        ...playlist,
        id: 'soundcloud:users:7',
        type: 'artist',
      })
    ).toBe(true);
    expect(
      soundCloudBrowserTargetAdapter.canEnqueue?.('soundcloud-browser', {
        ...playlist,
        uri: 'https://attacker.example/playlist',
      })
    ).toBe(false);
  });

  it('normalizes official track and playlist search responses', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            collection: [
              {
                urn: 'soundcloud:tracks:42',
                title: 'Sunroom',
                duration: 183000,
                artwork_url: 'https://i1.sndcdn.com/artworks-cover.jpg',
                permalink_url: 'https://soundcloud.com/navet/sunroom',
                streamable: true,
                access: 'playable',
                user: { username: 'Navet Sessions' },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            collection: [
              {
                urn: 'soundcloud:playlists:7',
                title: 'Sunday rotation',
                permalink_url: 'https://soundcloud.com/navet/sets/sunday',
                user: { username: 'Navet Sessions' },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            collection: [
              {
                urn: 'soundcloud:users:9',
                full_name: 'Navet Sessions',
                username: 'navet',
                permalink_url: 'https://soundcloud.com/navet',
                avatar_url: 'https://i1.sndcdn.com/avatars-navet.jpg',
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(soundCloudMusicSourceAdapter.search('sun')).resolves.toEqual([
      expect.objectContaining({
        id: 'soundcloud:tracks:42',
        sourceId: 'soundcloud',
        title: 'Sunroom',
        artists: ['Navet Sessions'],
        playable: true,
      }),
      expect.objectContaining({
        id: 'soundcloud:playlists:7',
        sourceId: 'soundcloud',
        type: 'playlist',
      }),
      expect.objectContaining({
        id: 'soundcloud:users:9',
        sourceId: 'soundcloud',
        type: 'artist',
        playable: false,
      }),
    ]);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/soundcloud/api/tracks?');
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('/soundcloud/api/playlists?');
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain('/soundcloud/api/users?');
  });

  it('keeps successful search results when one SoundCloud collection fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              collection: [
                {
                  urn: 'soundcloud:tracks:42',
                  title: 'Sunroom',
                  permalink_url: 'https://soundcloud.com/navet/sunroom',
                  streamable: true,
                  access: 'playable',
                  user: { username: 'Navet Sessions' },
                },
              ],
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          )
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ errors: [{ error_message: 'Temporarily unavailable' }] }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' },
          })
        )
    );

    await expect(soundCloudMusicSourceAdapter.search('sun')).resolves.toEqual([
      expect.objectContaining({ id: 'soundcloud:tracks:42', title: 'Sunroom' }),
    ]);
  });

  it('loads a SoundCloud continuation without forwarding a provider URL or token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          collection: [
            {
              urn: 'soundcloud:tracks:84',
              title: 'Beyond the first page',
              permalink_url: 'https://soundcloud.com/navet/beyond',
              streamable: true,
              access: 'playable',
              user: { username: 'Navet Sessions' },
            },
          ],
          next_href: null,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      soundCloudMusicSourceAdapter.browseNextPage?.({
        id: 'liked-tracks',
        sourceId: 'soundcloud',
        kind: 'favorites',
        layout: 'list',
        items: [],
        continuation: 'cursor:safe_cursor-2',
      })
    ).resolves.toEqual(
      expect.objectContaining({
        items: [expect.objectContaining({ id: 'soundcloud:tracks:84', isFavorite: true })],
      })
    );
    const requestUrl = String(fetchMock.mock.calls[0]?.[0]);
    expect(requestUrl).toContain('/me/likes/tracks?');
    expect(requestUrl).toContain('cursor=safe_cursor-2');
    expect(requestUrl).not.toContain('oauth_token');
    expect(requestUrl).not.toContain('attacker.example');
  });

  it('loads account shelves and updates likes without exposing the OAuth token', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'DELETE') return new Response(null, { status: 204 });
      if (url.includes('/me/likes/tracks')) {
        return new Response(
          JSON.stringify({
            collection: [
              {
                urn: 'soundcloud:tracks:42',
                title: 'Sunroom',
                permalink_url: 'https://soundcloud.com/navet/sunroom',
                user: { username: 'Navet Sessions' },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(JSON.stringify({ collection: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(soundCloudMusicSourceAdapter.browseLibrary?.()).resolves.toEqual([
      expect.objectContaining({
        id: 'liked-tracks',
        kind: 'favorites',
        items: [expect.objectContaining({ id: 'soundcloud:tracks:42', isFavorite: true })],
      }),
    ]);

    await soundCloudMusicSourceAdapter.setFavorite?.(
      {
        id: 'soundcloud:tracks:42',
        sourceId: 'soundcloud',
        type: 'track',
        title: 'Sunroom',
        artists: ['Navet Sessions'],
        playable: true,
        uri: 'https://soundcloud.com/navet/sunroom',
      },
      false
    );
    expect(fetchMock).toHaveBeenLastCalledWith(
      expect.stringContaining('/soundcloud/api/likes/tracks/soundcloud:tracks:42'),
      expect.objectContaining({ method: 'DELETE' })
    );
  });

  it('lists followed artists, opens their tracks, and updates follow state', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'PUT' || init?.method === 'DELETE') {
        return new Response(null, { status: 204 });
      }
      if (url.includes('/me/followings')) {
        return new Response(
          JSON.stringify({
            collection: [
              {
                urn: 'soundcloud:users:9',
                full_name: 'Navet Sessions',
                username: 'navet',
                permalink_url: 'https://soundcloud.com/navet',
              },
            ],
            next_href: null,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (url.includes('/users/soundcloud:users:9/tracks')) {
        return new Response(
          JSON.stringify({
            collection: [
              {
                urn: 'soundcloud:tracks:42',
                title: 'Sunroom',
                permalink_url: 'https://soundcloud.com/navet/sunroom',
                streamable: true,
                access: 'playable',
                user: { username: 'Navet Sessions' },
              },
            ],
            next_href: null,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(JSON.stringify({ collection: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const artist: MusicItem = {
      id: 'soundcloud:users:9',
      sourceId: 'soundcloud',
      type: 'artist',
      title: 'Navet Sessions',
      artists: ['navet'],
      playable: false,
      uri: 'https://soundcloud.com/navet',
    };

    await expect(soundCloudMusicSourceAdapter.browseLibrary?.()).resolves.toContainEqual(
      expect.objectContaining({
        id: 'followed-artists',
        kind: 'artists',
        items: [expect.objectContaining({ id: artist.id, isFavorite: true })],
      })
    );
    await expect(soundCloudMusicSourceAdapter.browseItem?.(artist)).resolves.toEqual([
      expect.objectContaining({
        id: `artist:${artist.id}`,
        items: [expect.objectContaining({ id: 'soundcloud:tracks:42' })],
      }),
    ]);

    await soundCloudMusicSourceAdapter.setFavorite?.(artist, true);
    await soundCloudMusicSourceAdapter.setFavorite?.(artist, false);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/soundcloud/api/me/followings/soundcloud:users:9'),
      expect.objectContaining({ method: 'PUT' })
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/soundcloud/api/me/followings/soundcloud:users:9'),
      expect.objectContaining({ method: 'DELETE' })
    );
  });

  it('exposes the official browser widget only for a connected SoundCloud account', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ state: 'connected', displayName: 'Vishal' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          })
      )
    );

    await expect(soundCloudBrowserTargetAdapter.listTargets('soundcloud')).resolves.toEqual([
      expect.objectContaining({
        id: 'soundcloud-browser',
        available: true,
        detail: 'Official SoundCloud player',
      }),
    ]);
    await expect(soundCloudBrowserTargetAdapter.listTargets('spotify')).resolves.toEqual([]);
  });
});
