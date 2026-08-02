import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createViteMusicConfigStore,
  isSecureSpotifyRedirectUri,
  isValidMusicServiceConfigPatch,
} from '@scripts/vite-music-config-store';
import { afterEach, describe, expect, it } from 'vitest';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createStore() {
  const directory = mkdtempSync(join(tmpdir(), 'navet-music-config-'));
  directories.push(directory);
  const filePath = join(directory, 'music.json');
  return { filePath, store: createViteMusicConfigStore(filePath) };
}

describe('createViteMusicConfigStore', () => {
  it('accepts HTTPS and explicit loopback redirects but rejects insecure LAN callbacks', () => {
    expect(isSecureSpotifyRedirectUri('https://navet.app/redirect/oauth')).toBe(true);
    expect(isSecureSpotifyRedirectUri('http://127.0.0.1:5200/callback')).toBe(true);
    expect(isSecureSpotifyRedirectUri('http://localhost:5200/callback')).toBe(false);
    expect(isSecureSpotifyRedirectUri('http://192.168.1.20:5200/callback')).toBe(false);
  });

  it('persists music credentials with owner-only file permissions', () => {
    const { filePath, store } = createStore();
    const appleMusicDeveloperToken = `header.payload.${'signature'.repeat(20)}`;

    store.updateConfig({
      spotifyClientId: 'spotify-client-id',
      spotifyRedirectUri: 'https://navet.app/redirect/oauth',
      appleMusicDeveloperToken,
      soundcloudClientId: 'soundcloud-client-id',
      soundcloudClientSecret: 'soundcloud-client-secret',
      soundcloudRedirectUri: 'https://navet.app/redirect/oauth',
      youtubeClientId: 'youtube-client-id',
      youtubeClientSecret: 'youtube-client-secret',
      youtubeRedirectUri: 'https://navet.app/redirect/oauth',
    });

    expect(createViteMusicConfigStore(filePath).getConfig()).toEqual({
      spotifyClientId: 'spotify-client-id',
      spotifyRedirectUri: 'https://navet.app/redirect/oauth',
      appleMusicDeveloperToken,
      soundcloudClientId: 'soundcloud-client-id',
      soundcloudClientSecret: 'soundcloud-client-secret',
      soundcloudRedirectUri: 'https://navet.app/redirect/oauth',
      youtubeClientId: 'youtube-client-id',
      youtubeClientSecret: 'youtube-client-secret',
      youtubeRedirectUri: 'https://navet.app/redirect/oauth',
    });
    expect(statSync(filePath).mode & 0o777).toBe(0o600);
  });

  it('removes individual stored Spotify values without deleting the others', () => {
    const { filePath, store } = createStore();
    store.updateConfig({
      spotifyClientId: 'spotify-client-id',
      spotifyRedirectUri: 'https://navet.app/redirect/oauth',
    });

    expect(store.updateConfig({ spotifyClientId: null })).toEqual({
      spotifyRedirectUri: 'https://navet.app/redirect/oauth',
    });
    expect(JSON.parse(readFileSync(filePath, 'utf8'))).toEqual({
      spotifyRedirectUri: 'https://navet.app/redirect/oauth',
    });
  });

  it('accepts signed Apple developer tokens and rejects malformed values', () => {
    const { filePath } = createStore();
    const appleMusicDeveloperToken = `header.payload.${'signature'.repeat(20)}`;
    writeFileSync(
      filePath,
      JSON.stringify({
        spotifyClientId: 'spotify-client-id',
        appleMusicDeveloperToken,
      })
    );

    expect(createViteMusicConfigStore(filePath).getConfig()).toEqual({
      spotifyClientId: 'spotify-client-id',
      appleMusicDeveloperToken,
    });
    expect(isValidMusicServiceConfigPatch({ appleMusicDeveloperToken })).toBe(true);
    expect(isValidMusicServiceConfigPatch({ appleMusicDeveloperToken: 'not-a-jwt' })).toBe(false);
  });
});
