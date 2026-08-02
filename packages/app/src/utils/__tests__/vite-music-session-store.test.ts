import { mkdtempSync, rmSync, statSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createViteMusicSessionStore,
  type SoundCloudSessionData,
  type ViteStoredMusicSession,
  type YouTubeSessionData,
} from '@scripts/vite-music-session-store';
import { getViteProviderRequestSession } from '@scripts/vite-provider-session-store';
import { afterEach, describe, expect, it } from 'vitest';

const fixtureDirectories: string[] = [];

afterEach(() => {
  for (const directory of fixtureDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function createFixture() {
  const directory = mkdtempSync(join(tmpdir(), 'navet-music-session-store-'));
  fixtureDirectories.push(directory);
  const sessionsDirectory = join(directory, 'sessions');
  return {
    sessionsDirectory,
    store: createViteMusicSessionStore({
      legacySessionPath: join(directory, 'legacy.json'),
      sessionsDirectory,
    }),
  };
}

function createRequest(cookie: string): IncomingMessage {
  return {
    headers: { cookie, host: 'navet.local:5200' },
    socket: {},
  } as unknown as IncomingMessage;
}

const SOUNDCLOUD_AUTH: SoundCloudSessionData = {
  accessToken: 'soundcloud-access',
  refreshToken: 'soundcloud-refresh',
  expiresAt: Date.now() + 60_000,
  displayName: 'SoundCloud listener',
};

const YOUTUBE_AUTH: YouTubeSessionData = {
  accessToken: 'youtube-access',
  refreshToken: 'youtube-refresh',
  expiresAt: Date.now() + 60_000,
  displayName: 'YouTube listener',
};

function update(
  session: ViteStoredMusicSession,
  patch: Partial<ViteStoredMusicSession>
): ViteStoredMusicSession {
  return { ...session, updatedAt: Date.now(), ...patch };
}

describe('Vite music session store', () => {
  it('persists multiple provider accounts in one owner-only browser session', () => {
    const fixture = createFixture();
    const created = fixture.store.createSession();
    const connected = update(created.session, {
      soundcloudAuth: SOUNDCLOUD_AUTH,
      youtubeAuth: YOUTUBE_AUTH,
    });

    fixture.store.writeSession(created.cookieId, connected);

    expect(fixture.store.readSession(created.cookieId)).toMatchObject({
      auth: null,
      soundcloudAuth: SOUNDCLOUD_AUTH,
      youtubeAuth: YOUTUBE_AUTH,
    });
    expect(statSync(join(fixture.sessionsDirectory, `${created.cookieId}.json`)).mode & 0o777).toBe(
      0o600
    );
  });

  it('prefers a SoundCloud-only account over a newer pending OAuth session', () => {
    const fixture = createFixture();
    const connected = fixture.store.createSession();
    fixture.store.writeSession(
      connected.cookieId,
      update(connected.session, { soundcloudAuth: SOUNDCLOUD_AUTH })
    );

    const pending = fixture.store.createSession();
    fixture.store.writeSession(
      pending.cookieId,
      update(pending.session, {
        pending: {
          expiresAt: Date.now() + 60_000,
          state: 'a'.repeat(64),
          verifier: 'b'.repeat(64),
        },
        updatedAt: Date.now() + 1_000,
      })
    );

    const request = createRequest(
      `navet_music_session=${pending.cookieId}; navet_music_session=${connected.cookieId}`
    );
    const selected = getViteProviderRequestSession(
      request,
      fixture.store.cookieNames,
      fixture.store
    );

    expect(selected?.cookieId).toBe(connected.cookieId);
    expect(selected?.session.soundcloudAuth).toEqual(SOUNDCLOUD_AUTH);
  });
});
