import musicStore from '@docker/njs/music-store.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

function createMockFs(files: Record<string, string> = {}) {
  const fileMap = new Map(Object.entries(files));
  return {
    readFileSync: vi.fn((path: string) => {
      const value = fileMap.get(path);
      if (value === undefined) {
        const error = new Error(`ENOENT: ${path}`);
        // @ts-expect-error test-only shape
        error.code = 'ENOENT';
        throw error;
      }
      return value;
    }),
    writeFileSync: vi.fn((path: string, value: string) => fileMap.set(path, value)),
    unlinkSync: vi.fn((path: string) => {
      if (!fileMap.delete(path)) {
        const error = new Error(`ENOENT: ${path}`);
        // @ts-expect-error test-only shape
        error.code = 'ENOENT';
        throw error;
      }
    }),
    getFile: (path: string) => fileMap.get(path),
  };
}

function createRequest(method = 'GET', requestText = '') {
  return {
    uri: '/__navet_music__/config',
    method,
    requestText,
    headersIn: { Host: 'navet.local:5200' },
    headersOut: {} as Record<string, string>,
    return: vi.fn(),
  };
}

afterEach(() => {
  musicStore.resetMusicConfigFsForTests();
  musicStore.resetAppleMusicDeveloperTokenCacheForTests();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('music-store', () => {
  it('loads the deployment-owned Apple developer token from Navet without storing user input', async () => {
    const developerToken = `header.payload.${'signature'.repeat(20)}`;
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ developerToken }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
    );
    vi.stubGlobal('ngx', { fetch: fetchMock });

    await expect(musicStore.resolveAppleMusicDeveloperToken()).resolves.toBe(developerToken);
    await expect(musicStore.resolveAppleMusicDeveloperToken()).resolves.toBe(developerToken);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('https://navet.app/api/music/apple/developer-token', {
      headers: { Accept: 'application/json' },
    });
  });

  it('routes Spotify authorization through the hosted relay while preserving the local callback', () => {
    const location = musicStore.getSpotifyAuthorizeLocation(
      createRequest(),
      {
        redirectUri: 'https://navet.app/redirect/oauth',
        ingressPath: '/api/hassio_ingress/navet',
      },
      'https://accounts.spotify.com/authorize?redirect_uri=https%3A%2F%2Fnavet.app%2Fredirect%2Foauth'
    );
    const relay = new URL(location);
    const startParams = new URLSearchParams(relay.hash.replace(/^#/, ''));

    expect(`${relay.origin}${relay.pathname}`).toBe('https://navet.app/redirect/oauth/');
    expect(startParams.get('instance')).toBe(
      'http://navet.local:5200/api/hassio_ingress/navet/__navet_music__/spotify/callback'
    );
    expect(startParams.get('authorize')).toContain('https://accounts.spotify.com/authorize');
  });

  it('stores Spotify configuration in /data and returns only masked status', async () => {
    const mockFs = createMockFs();
    musicStore.setMusicConfigFsForTests(mockFs);
    const request = createRequest(
      'PUT',
      JSON.stringify({
        spotifyClientId: 'spotify-client-1234',
      })
    );

    await musicStore.handle(request);

    expect(mockFs.getFile('/data/navet-music-config.json')).toContain('spotify-client-1234');
    const responseBody = String(request.return.mock.calls[0]?.[1]);
    expect(JSON.parse(responseBody)).toMatchObject({
      spotify: { configured: true, source: 'stored', clientIdHint: '1234' },
    });
  });

  it('migrates stored Spotify settings without retaining a legacy Apple developer token', () => {
    const mockFs = createMockFs({
      '/data/navet-music-config.json': JSON.stringify({
        spotifyClientId: 'spotify-client-1234',
        appleMusicDeveloperToken: 'legacy-user-supplied-token',
      }),
    });
    musicStore.setMusicConfigFsForTests(mockFs);

    expect(musicStore.readMusicConfig()).toEqual({ spotifyClientId: 'spotify-client-1234' });
    expect(mockFs.getFile('/data/navet-music-config.json')).not.toContain(
      'legacy-user-supplied-token'
    );
    expect(musicStore.isMusicConfigPatch({ appleMusicDeveloperToken: 'no-longer-supported' })).toBe(
      false
    );
  });

  it('rejects unknown configuration fields', async () => {
    const mockFs = createMockFs();
    musicStore.setMusicConfigFsForTests(mockFs);
    const request = createRequest('PUT', JSON.stringify({ applePrivateKey: 'never-store-this' }));

    await musicStore.handle(request);

    expect(request.return).toHaveBeenCalledWith(
      400,
      JSON.stringify({ error: 'Unsupported music configuration' })
    );
    expect(mockFs.getFile('/data/navet-music-config.json')).toBeUndefined();
  });

  it('accepts only secure Spotify redirect URIs supported by the packaged njs runtime', () => {
    expect(
      musicStore.isMusicConfigPatch({
        spotifyRedirectUri: 'https://navet.example.com/oauth/callback?source=spotify',
      })
    ).toBe(true);
    expect(
      musicStore.isMusicConfigPatch({
        spotifyRedirectUri: 'http://127.0.0.1:5200/__navet_music__/spotify/callback',
      })
    ).toBe(true);
    expect(
      musicStore.isMusicConfigPatch({
        spotifyRedirectUri: 'http://[::1]:5200/__navet_music__/spotify/callback',
      })
    ).toBe(true);

    for (const spotifyRedirectUri of [
      'http://localhost:5200/callback',
      'http://192.168.1.20:5200/callback',
      'https://user@example.com/callback',
      'https://example.com:70000/callback',
      'https://example.com\\callback',
      'javascript:alert(1)',
    ]) {
      expect(musicStore.isMusicConfigPatch({ spotifyRedirectUri })).toBe(false);
    }
  });
});
