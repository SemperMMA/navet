import musicProviderPolicy from '@docker/njs/music-provider-policy.js';
import { describe, expect, it } from 'vitest';

const { isAllowedSoundCloudOperation, isAllowedSpotifyOperation, isAllowedYouTubeOperation } =
  musicProviderPolicy;

describe('music provider proxy policy', () => {
  it('keeps Spotify OAuth permissions aligned with the exposed library and playback actions', () => {
    expect(musicProviderPolicy.SPOTIFY_OAUTH_SCOPES).toEqual(
      expect.arrayContaining([
        'streaming',
        'user-library-read',
        'user-library-modify',
        'playlist-read-private',
        'playlist-modify-public',
        'playlist-modify-private',
        'user-modify-playback-state',
      ])
    );
    expect(
      musicProviderPolicy.hasRequiredSpotifyScopes(
        musicProviderPolicy.SPOTIFY_OAUTH_SCOPES.join(' ')
      )
    ).toBe(true);
    expect(
      musicProviderPolicy.hasRequiredSpotifyScopes(
        musicProviderPolicy.SPOTIFY_OAUTH_SCOPES.filter(
          (scope) => scope !== 'playlist-modify-private'
        ).join(' ')
      )
    ).toBe(false);
  });

  it('allows only the Spotify library, detail, favorite, and playback operations Navet uses', () => {
    expect(isAllowedSpotifyOperation('GET', '/v1/me')).toBe(true);
    expect(isAllowedSpotifyOperation('GET', '/v1/me/tracks')).toBe(true);
    expect(isAllowedSpotifyOperation('GET', '/v1/playlists/37i9dQZF1DX/items')).toBe(true);
    expect(isAllowedSpotifyOperation('POST', '/v1/playlists/37i9dQZF1DX/items')).toBe(true);
    expect(isAllowedSpotifyOperation('PUT', '/v1/me/library')).toBe(true);
    expect(isAllowedSpotifyOperation('DELETE', '/v1/me/library')).toBe(true);
    expect(isAllowedSpotifyOperation('PUT', '/v1/me/player')).toBe(true);
    expect(isAllowedSpotifyOperation('DELETE', '/v1/playlists/37i9dQZF1DX')).toBe(false);
    expect(isAllowedSpotifyOperation('POST', '/v1/playlists/37i9dQZF1DX/items/extra')).toBe(false);
    expect(isAllowedSpotifyOperation('GET', '/v1/../me')).toBe(false);
    expect(isAllowedSpotifyOperation('POST', '/v1/playlists/../items')).toBe(false);
  });

  it('allows only exact SoundCloud collection, like, and follow operations', () => {
    expect(isAllowedSoundCloudOperation('GET', '/me/playlists')).toBe(true);
    expect(isAllowedSoundCloudOperation('GET', '/users')).toBe(true);
    expect(isAllowedSoundCloudOperation('GET', '/me/followings')).toBe(true);
    expect(isAllowedSoundCloudOperation('GET', '/users/soundcloud:users:12345/tracks')).toBe(true);
    expect(isAllowedSoundCloudOperation('POST', '/likes/tracks/soundcloud:tracks:12345')).toBe(
      true
    );
    expect(isAllowedSoundCloudOperation('DELETE', '/likes/playlists/soundcloud:playlists:42')).toBe(
      true
    );
    expect(isAllowedSoundCloudOperation('PUT', '/me/followings/soundcloud:users:12345')).toBe(true);
    expect(isAllowedSoundCloudOperation('DELETE', '/me/followings/soundcloud:users:12345')).toBe(
      true
    );
    expect(isAllowedSoundCloudOperation('POST', '/tracks')).toBe(false);
    expect(isAllowedSoundCloudOperation('DELETE', '/likes/tracks/soundcloud:playlists:42')).toBe(
      false
    );
    expect(isAllowedSoundCloudOperation('PUT', '/me/followings/soundcloud:tracks:12345')).toBe(
      false
    );
    expect(isAllowedSoundCloudOperation('PUT', '/me/followings/../tracks')).toBe(false);
  });

  it('keeps YouTube reads, ratings, and playlist writes explicit', () => {
    expect(isAllowedYouTubeOperation('GET', '/youtube/v3/playlistItems')).toBe(true);
    expect(isAllowedYouTubeOperation('POST', '/youtube/v3/videos/rate')).toBe(true);
    expect(isAllowedYouTubeOperation('POST', '/youtube/v3/playlistItems')).toBe(true);
    expect(isAllowedYouTubeOperation('POST', '/youtube/v3/playlists')).toBe(false);
    expect(isAllowedYouTubeOperation('POST', '/youtube/v3/playlistItems/extra')).toBe(false);
    expect(isAllowedYouTubeOperation('DELETE', '/youtube/v3/videos')).toBe(false);
  });
});
