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
    renameSync: vi.fn((from: string, to: string) => {
      const value = fileMap.get(from);
      if (value === undefined) throw new Error(`ENOENT: ${from}`);
      fileMap.set(to, value);
      fileMap.delete(from);
    }),
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

function createRequest(
  method = 'GET',
  requestText = '',
  options: {
    headers?: Record<string, string>;
    uri?: string;
  } = {}
) {
  return {
    uri: options.uri ?? '/__navet_music__/config',
    method,
    requestText,
    headersIn: {
      Host: 'navet.local:5200',
      Origin: 'http://navet.local:5200',
      ...options.headers,
    },
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

  it('stores installation credentials from a same-origin Navet UI without returning secrets', async () => {
    const mockFs = createMockFs();
    musicStore.setMusicConfigFsForTests(mockFs);
    const appleMusicDeveloperToken = `header.payload.${'signature'.repeat(20)}`;
    const request = createRequest(
      'PUT',
      JSON.stringify({
        spotifyClientId: 'spotify-client-1234',
        appleMusicDeveloperToken,
        soundcloudClientId: 'soundcloud-client-5678',
        soundcloudClientSecret: 'soundcloud-secret-value',
        youtubeClientId: 'youtube-client-9012',
        youtubeClientSecret: 'youtube-secret-value',
      })
    );

    await musicStore.handle(request);

    expect(request.return).toHaveBeenCalledWith(200, expect.any(String));
    const response = JSON.parse(request.return.mock.calls[0]?.[1] as string);
    expect(response).toMatchObject({
      spotify: { configured: true, source: 'stored', clientIdHint: '1234' },
      apple: { configured: true, source: 'stored' },
      soundcloud: { configured: true, source: 'stored', secretConfigured: true },
      youtube: { configured: true, source: 'stored', secretConfigured: true },
    });
    expect(JSON.stringify(response)).not.toContain('soundcloud-secret-value');
    expect(JSON.stringify(response)).not.toContain('youtube-secret-value');
    expect(JSON.stringify(response)).not.toContain(appleMusicDeveloperToken);
    expect(mockFs.getFile('/data/navet-music-config.json')).toContain('soundcloud-secret-value');
  });

  it('preserves a valid stored Apple developer token while dropping malformed legacy fields', () => {
    const appleMusicDeveloperToken = `header.payload.${'signature'.repeat(20)}`;
    const mockFs = createMockFs({
      '/data/navet-music-config.json': JSON.stringify({
        spotifyClientId: 'spotify-client-1234',
        appleMusicDeveloperToken,
        applePrivateKey: 'never-store-this',
      }),
    });
    musicStore.setMusicConfigFsForTests(mockFs);

    expect(musicStore.readMusicConfig()).toEqual({
      spotifyClientId: 'spotify-client-1234',
      appleMusicDeveloperToken,
    });
    expect(mockFs.getFile('/data/navet-music-config.json')).not.toContain('never-store-this');
    expect(musicStore.isMusicConfigPatch({ appleMusicDeveloperToken })).toBe(true);
    expect(musicStore.isMusicConfigPatch({ appleMusicDeveloperToken: 'malformed' })).toBe(false);
  });

  it('rejects unknown or malformed configuration fields', async () => {
    const mockFs = createMockFs();
    musicStore.setMusicConfigFsForTests(mockFs);
    const request = createRequest('PUT', JSON.stringify({ applePrivateKey: 'never-store-this' }));

    await musicStore.handle(request);

    expect(request.return).toHaveBeenCalledWith(
      400,
      JSON.stringify({ error: 'Invalid music configuration' })
    );
    expect(mockFs.getFile('/data/navet-music-config.json')).toBeUndefined();
  });

  it('rejects configuration mutation from cross-origin callers', async () => {
    const mockFs = createMockFs();
    musicStore.setMusicConfigFsForTests(mockFs);
    const request = createRequest(
      'PUT',
      JSON.stringify({ spotifyClientId: 'spotify-client-1234' }),
      { headers: { Origin: 'https://attacker.example' } }
    );

    await musicStore.handle(request);

    expect(request.return).toHaveBeenCalledWith(
      403,
      JSON.stringify({ error: 'Cross-origin music configuration is not allowed' })
    );
    expect(mockFs.getFile('/data/navet-music-config.json')).toBeUndefined();
  });

  it('allows only known same-origin music-engine operations', () => {
    expect(
      musicStore.engineRequestAllowed(
        createRequest('GET', '', { uri: '/__navet_music_engine__/queue' })
      )
    ).toBe('1');
    expect(
      musicStore.engineRequestAllowed(
        createRequest('POST', '', { uri: '/__navet_music_engine__/control' })
      )
    ).toBe('1');
    expect(
      musicStore.engineRequestAllowed(
        createRequest('POST', '', {
          headers: { Origin: 'https://attacker.example' },
          uri: '/__navet_music_engine__/control',
        })
      )
    ).toBe('');
    expect(
      musicStore.engineRequestAllowed(
        createRequest('DELETE', '', { uri: '/__navet_music_engine__/queue' })
      )
    ).toBe('');
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
