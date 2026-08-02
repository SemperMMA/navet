import type { MusicItem } from '@navet/core/music';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  youtubeMusicBrowserTargetAdapter,
  youtubeMusicSourceAdapter,
} from './youtube-music-adapter';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('YouTube music adapter', () => {
  it('limits likes, playlist writes, and browser queueing to individual videos', () => {
    const video: MusicItem = {
      id: 'video-1',
      sourceId: 'youtube_music',
      type: 'track',
      title: 'Northbound',
      artists: ['Lumen'],
      playable: true,
      uri: 'youtube:video:video-1',
    };
    const playlist: MusicItem = {
      ...video,
      id: 'playlist-1',
      type: 'playlist',
      title: 'Sunday rotation',
      uri: 'youtube:playlist:playlist-1',
    };

    expect(youtubeMusicSourceAdapter.canSetFavorite?.(video)).toBe(true);
    expect(youtubeMusicBrowserTargetAdapter.canEnqueue?.('youtube-music-browser', video)).toBe(
      true
    );
    expect(youtubeMusicSourceAdapter.canSetFavorite?.(playlist)).toBe(false);
    expect(youtubeMusicSourceAdapter.canAddToPlaylist?.(video)).toBe(true);
    expect(youtubeMusicSourceAdapter.canAddToPlaylist?.(playlist)).toBe(false);
    expect(youtubeMusicBrowserTargetAdapter.canEnqueue?.('youtube-music-browser', playlist)).toBe(
      false
    );
  });

  it('searches embeddable music videos through the YouTube Data API', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const playlistSearch = String(input).includes('type=playlist');
      return new Response(
        JSON.stringify(
          playlistSearch
            ? {
                items: [
                  {
                    id: { playlistId: 'playlist-1' },
                    snippet: { title: 'Sunday rotation', channelTitle: 'Vishal' },
                  },
                ],
              }
            : {
                items: [
                  {
                    id: { videoId: 'video-1' },
                    snippet: {
                      title: 'Northbound &amp; Home',
                      channelTitle: 'Lumen',
                      thumbnails: { high: { url: 'https://i.ytimg.com/cover.jpg' } },
                    },
                  },
                ],
              }
        ),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(youtubeMusicSourceAdapter.search('northbound')).resolves.toEqual([
      expect.objectContaining({
        id: 'video-1',
        sourceId: 'youtube_music',
        title: 'Northbound & Home',
        artists: ['Lumen'],
        uri: 'youtube:video:video-1',
      }),
      expect.objectContaining({
        id: 'playlist-1',
        type: 'playlist',
        uri: 'youtube:playlist:playlist-1',
      }),
    ]);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/youtube/api/youtube/v3/search?');
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('videoEmbeddable=true');
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('type=playlist');
    expect(String(fetchMock.mock.calls[1]?.[0])).not.toContain('videoEmbeddable');
  });

  it('loads liked videos and playlists and updates likes through the official API', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/videos/rate?')) return new Response(null, { status: 204 });
      if (url.includes('/videos?')) {
        return new Response(
          JSON.stringify({
            items: [
              {
                id: 'liked-video',
                snippet: { title: 'Liked song', channelTitle: 'Lumen' },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      expect(init?.method).toBeUndefined();
      return new Response(
        JSON.stringify({
          items: [
            {
              id: 'playlist-1',
              snippet: { title: 'Sunday rotation', channelTitle: 'Vishal' },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(youtubeMusicSourceAdapter.browseLibrary?.()).resolves.toEqual([
      expect.objectContaining({
        id: 'liked-videos',
        kind: 'favorites',
        items: [expect.objectContaining({ id: 'liked-video', isFavorite: true })],
      }),
      expect.objectContaining({
        id: 'playlists',
        kind: 'playlists',
        items: [expect.objectContaining({ id: 'playlist-1', type: 'playlist' })],
      }),
    ]);

    await youtubeMusicSourceAdapter.setFavorite?.(
      {
        id: 'liked-video',
        sourceId: 'youtube_music',
        type: 'track',
        title: 'Liked song',
        artists: ['Lumen'],
        playable: true,
        uri: 'youtube:video:liked-video',
      },
      false
    );
    expect(fetchMock).toHaveBeenLastCalledWith(
      expect.stringContaining('/youtube/api/youtube/v3/videos/rate?id=liked-video&rating=none'),
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('loads another liked-video page from a validated YouTube page token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          items: [
            {
              id: 'video-21',
              snippet: { title: 'Beyond the first page', channelTitle: 'Lumen' },
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      youtubeMusicSourceAdapter.browseNextPage?.({
        id: 'liked-videos',
        sourceId: 'youtube_music',
        kind: 'favorites',
        layout: 'list',
        items: [],
        continuation: 'page:CAUQAA',
      })
    ).resolves.toEqual(
      expect.objectContaining({
        items: [expect.objectContaining({ id: 'video-21', isFavorite: true })],
      })
    );
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('pageToken=CAUQAA');
  });

  it('lists account playlists and adds a video with an explicit JSON write', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/playlistItems?')) {
        return new Response(JSON.stringify({ id: 'playlist-item-1' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      expect(init?.method).toBeUndefined();
      return new Response(
        JSON.stringify({
          items: [
            {
              id: 'playlist-1',
              snippet: { title: 'Kitchen rotation', channelTitle: 'Vishal' },
            },
          ],
          nextPageToken: 'NEXT_PAGE',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const page = await youtubeMusicSourceAdapter.listEditablePlaylists?.();
    expect(page).toEqual({
      items: [
        expect.objectContaining({
          id: 'playlist-1',
          sourceId: 'youtube_music',
          title: 'Kitchen rotation',
        }),
      ],
      continuation: 'page:NEXT_PAGE',
    });
    const destination = page?.items[0];
    expect(destination).toBeDefined();
    if (!destination) throw new Error('Expected an editable YouTube playlist');
    await youtubeMusicSourceAdapter.addToPlaylist?.(destination, {
      id: 'video-1',
      sourceId: 'youtube_music',
      type: 'track',
      title: 'Northbound',
      artists: ['Lumen'],
      playable: true,
      uri: 'youtube:video:video-1',
    });
    expect(fetchMock).toHaveBeenLastCalledWith(
      expect.stringContaining('/youtube/api/youtube/v3/playlistItems?part=snippet'),
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          snippet: {
            playlistId: 'playlist-1',
            resourceId: { kind: 'youtube#video', videoId: 'video-1' },
          },
        }),
      })
    );
  });

  it('exposes only the official browser player for a connected YouTube account', async () => {
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

    await expect(youtubeMusicBrowserTargetAdapter.listTargets('youtube_music')).resolves.toEqual([
      expect.objectContaining({
        id: 'youtube-music-browser',
        available: true,
        detail: 'Official YouTube player',
      }),
    ]);
    await expect(youtubeMusicBrowserTargetAdapter.listTargets('spotify')).resolves.toEqual([]);
  });
});
