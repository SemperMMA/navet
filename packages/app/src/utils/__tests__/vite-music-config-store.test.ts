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

    store.updateConfig({
      spotifyClientId: 'spotify-client-id',
      spotifyRedirectUri: 'https://navet.app/redirect/oauth',
    });

    expect(createViteMusicConfigStore(filePath).getConfig()).toEqual({
      spotifyClientId: 'spotify-client-id',
      spotifyRedirectUri: 'https://navet.app/redirect/oauth',
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

  it('drops legacy Apple developer tokens while preserving Spotify configuration', () => {
    const { filePath } = createStore();
    writeFileSync(
      filePath,
      JSON.stringify({
        spotifyClientId: 'spotify-client-id',
        appleMusicDeveloperToken: 'legacy-user-supplied-token',
      })
    );

    expect(createViteMusicConfigStore(filePath).getConfig()).toEqual({
      spotifyClientId: 'spotify-client-id',
    });
    expect(readFileSync(filePath, 'utf8')).not.toContain('legacy-user-supplied-token');
    expect(
      isValidMusicServiceConfigPatch({ appleMusicDeveloperToken: 'no-longer-supported' })
    ).toBe(false);
  });
});
