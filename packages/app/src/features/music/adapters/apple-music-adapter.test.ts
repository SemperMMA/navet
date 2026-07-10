import { afterEach, describe, expect, it, vi } from 'vitest';

describe('appleMusicSourceAdapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
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
});
