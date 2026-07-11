import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  spotifyMusicSourceAdapter,
  spotifyPlaybackTargetAdapter,
} from '../adapters/spotify-music-adapter';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Spotify music adapter', () => {
  it('loads top artists and actual recently played tracks for the music home', async () => {
    const fetchMock = vi
      .fn()
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
      expect.objectContaining({ id: 'artist-1', type: 'artist', title: 'Lumen' }),
      expect.objectContaining({ id: 'recent-1', type: 'track', title: 'Recently heard' }),
    ]);
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/me/player/recently-played?limit=20');
    expect(fetchMock.mock.calls[1]?.[0]).toContain('/me/top/artists?');
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
      'Reconnect Spotify to show recently played music and your top artists.'
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
              { id: 'kitchen', name: 'Kitchen', is_active: true, is_restricted: false },
              { id: 'locked', name: 'Locked speaker', is_restricted: true },
              { name: 'Missing identity' },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )
    );

    await expect(spotifyPlaybackTargetAdapter.listTargets('spotify')).resolves.toEqual([
      expect.objectContaining({ id: 'kitchen', available: true, isActive: true }),
      expect.objectContaining({ id: 'locked', available: false }),
    ]);
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
});
