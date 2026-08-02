import { describe, expect, it } from 'vitest';
import {
  buildNavetCallbackUrl,
  buildStoredNavetCallbackUrl,
  getStoredOAuthProvider,
  getSpotifyAuthorizeState,
  getNavetHomeUrlFromCallback,
  isValidNavetCallbackUrl,
  isValidSoundCloudAuthorizeUrl,
  isValidSpotifyAuthorizeUrl,
  isValidYouTubeAuthorizeUrl,
  NAVET_SOUNDCLOUD_OAUTH_RELAY_URI,
  NAVET_SPOTIFY_OAUTH_RELAY_URI,
  NAVET_YOUTUBE_OAUTH_RELAY_URI,
  normalizeNavetHomeUrl,
} from './oauth-redirect';

describe('Navet OAuth redirect relay', () => {
  it('accepts local Navet callbacks and rejects unrelated redirect targets', () => {
    expect(
      isValidNavetCallbackUrl(
        'http://192.168.1.20:5200/__navet_music__/spotify/callback'
      )
    ).toBe(true);
    expect(isValidNavetCallbackUrl('https://example.com/phishing')).toBe(false);
    expect(
      isValidNavetCallbackUrl('https://example.com/__navet_music__/spotify/callback')
    ).toBe(false);
    expect(
      isValidNavetCallbackUrl('http://172.20.0.2/__navet_music__/spotify/callback')
    ).toBe(true);
    expect(
      isValidNavetCallbackUrl('http://[fd00::20]/__navet_music__/spotify/callback')
    ).toBe(true);
    expect(
      isValidNavetCallbackUrl(
        'https://user:password@example.com/__navet_music__/spotify/callback'
      )
    ).toBe(false);
  });

  it('only forwards Spotify authorization requests using the Navet relay URI', () => {
    const authorize = new URL('https://accounts.spotify.com/authorize');
    authorize.searchParams.set('redirect_uri', NAVET_SPOTIFY_OAUTH_RELAY_URI);
    authorize.searchParams.set('state', 'expected-state');
    expect(isValidSpotifyAuthorizeUrl(authorize.toString())).toBe(true);
    expect(getSpotifyAuthorizeState(authorize.toString())).toBe('expected-state');

    authorize.searchParams.set('redirect_uri', 'https://attacker.example/callback');
    expect(isValidSpotifyAuthorizeUrl(authorize.toString())).toBe(false);
    expect(getSpotifyAuthorizeState(authorize.toString())).toBeNull();
  });

  it('accepts only PKCE SoundCloud authorization requests using the Navet relay URI', () => {
    const authorize = new URL('https://secure.soundcloud.com/authorize');
    authorize.searchParams.set('redirect_uri', NAVET_SOUNDCLOUD_OAUTH_RELAY_URI);
    authorize.searchParams.set('state', 'expected-state');
    authorize.searchParams.set('code_challenge_method', 'S256');

    expect(isValidSoundCloudAuthorizeUrl(authorize.toString())).toBe(true);

    authorize.searchParams.set('code_challenge_method', 'plain');
    expect(isValidSoundCloudAuthorizeUrl(authorize.toString())).toBe(false);
    authorize.searchParams.set('code_challenge_method', 'S256');
    authorize.hostname = 'attacker.example';
    expect(isValidSoundCloudAuthorizeUrl(authorize.toString())).toBe(false);
  });

  it('accepts only PKCE Google authorization requests using the Navet relay URI', () => {
    const authorize = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authorize.searchParams.set('redirect_uri', NAVET_YOUTUBE_OAUTH_RELAY_URI);
    authorize.searchParams.set('state', 'expected-state');
    authorize.searchParams.set('code_challenge_method', 'S256');

    expect(isValidYouTubeAuthorizeUrl(authorize.toString())).toBe(true);

    authorize.pathname = '/signin/oauth';
    expect(isValidYouTubeAuthorizeUrl(authorize.toString())).toBe(false);
  });

  it('forwards only OAuth response parameters to the stored local callback', () => {
    expect(
      buildNavetCallbackUrl(
        'http://navet.local:5200/__navet_music__/spotify/callback',
        '?code=spotify-code&state=expected-state&instance=https://attacker.example'
      )
    ).toBe(
      'http://navet.local:5200/__navet_music__/spotify/callback?code=spotify-code&state=expected-state'
    );
  });

  it('accepts a local SoundCloud callback without accepting a public target', () => {
    expect(
      isValidNavetCallbackUrl(
        'http://navet.local:5200/__navet_music__/soundcloud/callback'
      )
    ).toBe(true);
    expect(
      isValidNavetCallbackUrl(
        'https://example.com/__navet_music__/soundcloud/callback'
      )
    ).toBe(false);
  });

  it('accepts a local YouTube callback without accepting a public target', () => {
    expect(
      isValidNavetCallbackUrl(
        'http://navet.local:5200/__navet_music__/youtube/callback'
      )
    ).toBe(true);
    expect(
      isValidNavetCallbackUrl(
        'https://example.com/__navet_music__/youtube/callback'
      )
    ).toBe(false);
  });

  it('forwards an OAuth response only when its state matches the initiating tab', () => {
    const storedRequest = JSON.stringify({
      callback: 'http://navet.local:5200/__navet_music__/spotify/callback',
      state: 'expected-state',
    });

    expect(
      buildStoredNavetCallbackUrl(storedRequest, '?code=spotify-code&state=expected-state')
    ).toBe(
      'http://navet.local:5200/__navet_music__/spotify/callback?code=spotify-code&state=expected-state'
    );
    expect(
      buildStoredNavetCallbackUrl(storedRequest, '?code=spotify-code&state=attacker-state')
    ).toBeNull();
    expect(buildStoredNavetCallbackUrl('not-json', '?state=expected-state')).toBeNull();
  });

  it('retains the provider across the hosted round trip and enforces its callback path', () => {
    const storedRequest = JSON.stringify({
      callback: 'http://navet.local:5200/__navet_music__/youtube/callback',
      provider: 'youtube',
      state: 'expected-state',
    });

    expect(getStoredOAuthProvider(storedRequest)).toBe('youtube');
    expect(
      buildStoredNavetCallbackUrl(storedRequest, '?code=youtube-code&state=expected-state')
    ).toBe(
      'http://navet.local:5200/__navet_music__/youtube/callback?code=youtube-code&state=expected-state'
    );
    expect(
      buildStoredNavetCallbackUrl(
        JSON.stringify({
          callback: 'http://navet.local:5200/__navet_music__/spotify/callback',
          provider: 'youtube',
          state: 'expected-state',
        }),
        '?code=youtube-code&state=expected-state'
      )
    ).toBeNull();
  });

  it('derives and validates an editable Navet home address without weakening callback validation', () => {
    expect(
      getNavetHomeUrlFromCallback(
        'http://navet.local:5200/__navet_music__/spotify/callback'
      )
    ).toBe('http://navet.local:5200/');
    expect(normalizeNavetHomeUrl(' http://192.168.1.20:5200/dashboard?edit=true#music ')).toBe(
      'http://192.168.1.20:5200/dashboard'
    );
    expect(normalizeNavetHomeUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeNavetHomeUrl('https://user:password@example.com')).toBeNull();
  });
});
