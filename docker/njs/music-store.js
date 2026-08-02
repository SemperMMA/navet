import crypto from 'crypto';
import fs from 'fs';
import musicProviderPolicy from './music-provider-policy.js';
import providerSessionStore from './provider-session-store.js';

const isAllowedSoundCloudOperation = musicProviderPolicy.isAllowedSoundCloudOperation;
const isAllowedSpotifyOperation = musicProviderPolicy.isAllowedSpotifyOperation;
const isAllowedYouTubeOperation = musicProviderPolicy.isAllowedYouTubeOperation;
const hasRequiredSpotifyScopes = musicProviderPolicy.hasRequiredSpotifyScopes;
const SPOTIFY_OAUTH_SCOPE = musicProviderPolicy.SPOTIFY_OAUTH_SCOPES.join(' ');

const SESSION_PATH = '/data/navet-music-spotify-session.json';
const MUSIC_SESSION_COOKIE_NAME = 'navet_music_session';
const MUSIC_SESSIONS_DIRECTORY = '/data/navet-provider-sessions/music';
const MUSIC_CONFIG_PATH = '/data/navet-music-config.json';
const SPOTIFY_ACCOUNTS_URL = 'https://accounts.spotify.com';
const SPOTIFY_API_URL = 'https://api.spotify.com';
const SOUNDCLOUD_ACCOUNTS_URL = 'https://secure.soundcloud.com';
const SOUNDCLOUD_API_URL = 'https://api.soundcloud.com';
const GOOGLE_ACCOUNTS_URL = 'https://accounts.google.com';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const YOUTUBE_API_URL = 'https://www.googleapis.com';
const CALLBACK_PATH = '/__navet_music__/spotify/callback';
const SOUNDCLOUD_CALLBACK_PATH = '/__navet_music__/soundcloud/callback';
const YOUTUBE_CALLBACK_PATH = '/__navet_music__/youtube/callback';
const NAVET_SPOTIFY_OAUTH_RELAY_URI = 'https://navet.app/redirect/oauth';
const NAVET_SOUNDCLOUD_OAUTH_RELAY_URI = 'https://navet.app/redirect/oauth';
const NAVET_YOUTUBE_OAUTH_RELAY_URI = 'https://navet.app/redirect/oauth';
const NAVET_APPLE_MUSIC_DEVELOPER_TOKEN_URL =
  'https://navet.app/api/music/apple/developer-token';
const MAX_SESSION_BYTES = 32 * 1024;
const OAUTH_PENDING_TTL_MS = 10 * 60 * 1000;
let musicConfigFs = fs;
let cachedAppleMusicDeveloperToken = '';
let cachedAppleMusicDeveloperTokenExpiresAt = 0;

function setMusicConfigFsForTests(mockFs) {
  musicConfigFs = mockFs;
}

function resetMusicConfigFsForTests() {
  musicConfigFs = fs;
}

function resetAppleMusicDeveloperTokenCacheForTests() {
  clearAppleMusicDeveloperTokenCache();
}

function clearAppleMusicDeveloperTokenCache() {
  cachedAppleMusicDeveloperToken = '';
  cachedAppleMusicDeveloperTokenExpiresAt = 0;
}

function isPendingSession(value) {
  return (
    value &&
    typeof value.verifier === 'string' &&
    value.verifier.length >= 43 &&
    value.verifier.length <= 128 &&
    typeof value.state === 'string' &&
    /^[a-f0-9]{64}$/.test(value.state) &&
    typeof value.expiresAt === 'number' &&
    Number.isFinite(value.expiresAt)
  );
}

function isStoredMusicSession(value) {
  return (
    value &&
    value.version === 1 &&
    typeof value.createdAt === 'number' &&
    Number.isFinite(value.createdAt) &&
    typeof value.updatedAt === 'number' &&
    Number.isFinite(value.updatedAt) &&
    (value.auth === null || isSession(value.auth)) &&
    (value.pending === null || isPendingSession(value.pending)) &&
    (value.soundcloudAuth === undefined ||
      value.soundcloudAuth === null ||
      isSession(value.soundcloudAuth)) &&
    (value.soundcloudPending === undefined ||
      value.soundcloudPending === null ||
      isPendingSession(value.soundcloudPending)) &&
    (value.youtubeAuth === undefined ||
      value.youtubeAuth === null ||
      isSession(value.youtubeAuth)) &&
    (value.youtubePending === undefined ||
      value.youtubePending === null ||
      isPendingSession(value.youtubePending))
  );
}

function createEmptyMusicSession() {
  const now = Date.now();
  return {
    version: 1,
    createdAt: now,
    updatedAt: now,
    auth: null,
    pending: null,
    soundcloudAuth: null,
    soundcloudPending: null,
    youtubeAuth: null,
    youtubePending: null,
  };
}

const musicSessionStore = providerSessionStore.createProviderSessionStore({
  cookieName: MUSIC_SESSION_COOKIE_NAME,
  sessionsDirectory: MUSIC_SESSIONS_DIRECTORY,
  legacySessionPath: SESSION_PATH,
  maxRecordBytes: MAX_SESSION_BYTES,
  createRecord: createEmptyMusicSession,
  isValidRecord: isStoredMusicSession,
  isActiveRecord: function (record, now) {
    return Boolean(
      record.auth ||
      record.soundcloudAuth ||
        record.youtubeAuth ||
        (record.pending && record.pending.expiresAt >= now) ||
        (record.soundcloudPending && record.soundcloudPending.expiresAt >= now) ||
        (record.youtubePending && record.youtubePending.expiresAt >= now)
    );
  },
  isAuthenticatedRecord: function (record) {
    return Boolean(record.auth || record.soundcloudAuth || record.youtubeAuth);
  },
});

function writeMusicSession(context, overrides) {
  const next = {};
  const persisted = musicSessionStore.readSession(context.cookieId);
  const base = persisted || context.session;
  let key;
  for (key in base) {
    if (Object.prototype.hasOwnProperty.call(base, key)) {
      next[key] = base[key];
    }
  }
  for (key in overrides) {
    if (Object.prototype.hasOwnProperty.call(overrides, key)) {
      next[key] = overrides[key];
    }
  }
  next.updatedAt = Date.now();
  musicSessionStore.writeSession(context.cookieId, next);
  context.session = next;
  return next;
}

function engineRequestAllowed(r) {
  const path = r.uri.replace(/^\/__navet_music_engine__/, '') || '/';
  const allowedRead =
    r.method === 'GET' && ['/status', '/targets', '/playback', '/queue'].indexOf(path) !== -1;
  const allowedMutation =
    r.method === 'POST' &&
    ['/play', '/group', '/ungroup', '/control'].indexOf(path) !== -1;
  if (allowedRead) return '1';
  if (allowedMutation && providerSessionStore.isStrictSameOriginMutation(r)) return '1';
  return '';
}

function sendJson(r, status, payload) {
  r.headersOut['Cache-Control'] = 'no-store';
  r.headersOut['Content-Type'] = 'application/json; charset=utf-8';
  r.return(status, JSON.stringify(payload));
}

function sendRedirect(r, location) {
  r.headersOut['Cache-Control'] = 'no-store';
  r.return(302, location);
}

function base64Url(buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomValue(bytes) {
  return base64Url(crypto.randomBytes(bytes));
}

function normalizeIngressPath(value) {
  const trimmed = typeof value === 'string' ? value.trim().replace(/\/+$/, '') : '';
  return trimmed && trimmed.startsWith('/') ? trimmed : '';
}

function getOrigin(r) {
  return providerSessionStore.getRequestOrigin(r);
}

function getConfig(r) {
  const stored = readMusicConfig();
  const ingressPath = normalizeIngressPath(r.headersIn['X-Ingress-Path']);
  const redirectUri =
    stored.spotifyRedirectUri ||
    process.env.NAVET_SPOTIFY_REDIRECT_URI ||
    NAVET_SPOTIFY_OAUTH_RELAY_URI;
  const clientId = stored.spotifyClientId || process.env.NAVET_SPOTIFY_CLIENT_ID || '';
  const appleMusicDeveloperToken =
    stored.appleMusicDeveloperToken || process.env.NAVET_APPLE_MUSIC_DEVELOPER_TOKEN || '';
  return {
    clientId: clientId,
    redirectUri: redirectUri,
    ingressPath: ingressPath,
    spotifySource: stored.spotifyClientId ? 'stored' : clientId ? 'environment' : 'none',
    appleMusicDeveloperToken: appleMusicDeveloperToken,
    appleMusicSource: stored.appleMusicDeveloperToken
      ? 'stored'
      : appleMusicDeveloperToken
        ? 'environment'
        : 'hosted',
    soundcloudClientId:
      stored.soundcloudClientId || process.env.NAVET_SOUNDCLOUD_CLIENT_ID || '',
    soundcloudClientSecret:
      stored.soundcloudClientSecret || process.env.NAVET_SOUNDCLOUD_CLIENT_SECRET || '',
    soundcloudRedirectUri:
      stored.soundcloudRedirectUri ||
      process.env.NAVET_SOUNDCLOUD_REDIRECT_URI ||
      NAVET_SOUNDCLOUD_OAUTH_RELAY_URI,
    soundcloudSource:
      stored.soundcloudClientId || stored.soundcloudClientSecret
        ? 'stored'
        : process.env.NAVET_SOUNDCLOUD_CLIENT_ID && process.env.NAVET_SOUNDCLOUD_CLIENT_SECRET
          ? 'environment'
          : 'none',
    youtubeClientId: stored.youtubeClientId || process.env.NAVET_YOUTUBE_CLIENT_ID || '',
    youtubeClientSecret:
      stored.youtubeClientSecret || process.env.NAVET_YOUTUBE_CLIENT_SECRET || '',
    youtubeRedirectUri:
      stored.youtubeRedirectUri ||
      process.env.NAVET_YOUTUBE_REDIRECT_URI ||
      NAVET_YOUTUBE_OAUTH_RELAY_URI,
    youtubeSource:
      stored.youtubeClientId || stored.youtubeClientSecret
        ? 'stored'
        : process.env.NAVET_YOUTUBE_CLIENT_ID && process.env.NAVET_YOUTUBE_CLIENT_SECRET
          ? 'environment'
          : 'none',
  };
}

function getSpotifyAuthorizeLocation(r, config, spotifyAuthorizeUri) {
  if (config.redirectUri !== NAVET_SPOTIFY_OAUTH_RELAY_URI) return spotifyAuthorizeUri;
  const localCallbackUri = getOrigin(r) + config.ingressPath + CALLBACK_PATH;
  return (
    NAVET_SPOTIFY_OAUTH_RELAY_URI +
    '/#instance=' +
    encodeURIComponent(localCallbackUri) +
    '&authorize=' +
    encodeURIComponent(spotifyAuthorizeUri)
  );
}

function getSoundCloudAuthorizeLocation(r, config, soundcloudAuthorizeUri) {
  if (config.soundcloudRedirectUri !== NAVET_SOUNDCLOUD_OAUTH_RELAY_URI) {
    return soundcloudAuthorizeUri;
  }
  const localCallbackUri = getOrigin(r) + config.ingressPath + SOUNDCLOUD_CALLBACK_PATH;
  return (
    NAVET_SOUNDCLOUD_OAUTH_RELAY_URI +
    '/#instance=' +
    encodeURIComponent(localCallbackUri) +
    '&authorize=' +
    encodeURIComponent(soundcloudAuthorizeUri) +
    '&provider=soundcloud'
  );
}

function getYouTubeAuthorizeLocation(r, config, youtubeAuthorizeUri) {
  if (config.youtubeRedirectUri !== NAVET_YOUTUBE_OAUTH_RELAY_URI) {
    return youtubeAuthorizeUri;
  }
  const localCallbackUri = getOrigin(r) + config.ingressPath + YOUTUBE_CALLBACK_PATH;
  return (
    NAVET_YOUTUBE_OAUTH_RELAY_URI +
    '/#instance=' +
    encodeURIComponent(localCallbackUri) +
    '&authorize=' +
    encodeURIComponent(youtubeAuthorizeUri) +
    '&provider=youtube'
  );
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isAppleMusicDeveloperToken(value) {
  if (typeof value !== 'string') return false;
  const candidate = value.trim();
  if (candidate.length < 100 || candidate.length > 8192) return false;
  return candidate.split('.').length === 3 && /^[A-Za-z0-9._-]+$/.test(candidate);
}

function isMusicConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const allowed = [
    'spotifyClientId',
    'spotifyRedirectUri',
    'appleMusicDeveloperToken',
    'soundcloudClientId',
    'soundcloudClientSecret',
    'soundcloudRedirectUri',
    'youtubeClientId',
    'youtubeClientSecret',
    'youtubeRedirectUri',
  ];
  const keys = Object.keys(value);
  if (keys.some((key) => allowed.indexOf(key) === -1)) return false;
  if (value.spotifyClientId !== undefined && !isNonEmptyString(value.spotifyClientId)) return false;
  if (
    value.spotifyRedirectUri !== undefined &&
    (!isNonEmptyString(value.spotifyRedirectUri) ||
      !isSecureSpotifyRedirectUri(value.spotifyRedirectUri))
  ) {
    return false;
  }
  if (
    value.appleMusicDeveloperToken !== undefined &&
    !isAppleMusicDeveloperToken(value.appleMusicDeveloperToken)
  ) {
    return false;
  }
  if (
    value.soundcloudClientId !== undefined &&
    !isNonEmptyString(value.soundcloudClientId)
  ) {
    return false;
  }
  if (
    value.soundcloudClientSecret !== undefined &&
    !isNonEmptyString(value.soundcloudClientSecret)
  ) {
    return false;
  }
  if (
    value.soundcloudRedirectUri !== undefined &&
    (!isNonEmptyString(value.soundcloudRedirectUri) ||
      !isSecureSpotifyRedirectUri(value.soundcloudRedirectUri))
  ) {
    return false;
  }
  if (value.youtubeClientId !== undefined && !isNonEmptyString(value.youtubeClientId)) {
    return false;
  }
  if (
    value.youtubeClientSecret !== undefined &&
    !isNonEmptyString(value.youtubeClientSecret)
  ) {
    return false;
  }
  if (
    value.youtubeRedirectUri !== undefined &&
    (!isNonEmptyString(value.youtubeRedirectUri) ||
      !isSecureSpotifyRedirectUri(value.youtubeRedirectUri))
  ) {
    return false;
  }
  return true;
}

function isMusicConfigPatch(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const allowed = [
    'spotifyClientId',
    'spotifyRedirectUri',
    'appleMusicDeveloperToken',
    'soundcloudClientId',
    'soundcloudClientSecret',
    'soundcloudRedirectUri',
    'youtubeClientId',
    'youtubeClientSecret',
    'youtubeRedirectUri',
  ];
  const keys = Object.keys(value);
  const redirectUri = value.spotifyRedirectUri;
  const redirectUriIsSecure =
    typeof redirectUri !== 'string' || isSecureSpotifyRedirectUri(redirectUri);
  const soundcloudRedirectUri = value.soundcloudRedirectUri;
  const soundcloudRedirectUriIsSecure =
    typeof soundcloudRedirectUri !== 'string' ||
    isSecureSpotifyRedirectUri(soundcloudRedirectUri);
  const youtubeRedirectUri = value.youtubeRedirectUri;
  const youtubeRedirectUriIsSecure =
    typeof youtubeRedirectUri !== 'string' || isSecureSpotifyRedirectUri(youtubeRedirectUri);
  return (
    keys.length > 0 &&
    keys.every((key) => allowed.indexOf(key) !== -1) &&
    keys.every((key) => value[key] === null || isNonEmptyString(value[key])) &&
    redirectUriIsSecure &&
    (typeof value.appleMusicDeveloperToken !== 'string' ||
      isAppleMusicDeveloperToken(value.appleMusicDeveloperToken)) &&
    soundcloudRedirectUriIsSecure &&
    youtubeRedirectUriIsSecure
  );
}

function hasUnsafeUrlCharacters(value) {
  return /[\u0000-\u0020\u007f\\]/.test(value);
}

function isValidUrlPort(value) {
  if (!value) return true;
  if (!/^[0-9]+$/.test(value)) return false;
  const port = Number(value);
  return Number.isFinite(port) && port >= 0 && port <= 65535;
}

function isSecureSpotifyRedirectUri(value) {
  if (typeof value !== 'string') return false;
  const candidate = value.trim();
  if (!candidate || hasUnsafeUrlCharacters(candidate)) return false;

  const match = /^(https?):\/\/(\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9._-]+)(?::([0-9]+))?(?:[/?#].*)?$/i.exec(
    candidate
  );
  if (!match || !match[1] || !match[2] || !isValidUrlPort(match[3] || '')) {
    return false;
  }

  const protocol = match[1].toLowerCase();
  const hostname = match[2].toLowerCase();
  return protocol === 'https' || hostname === '127.0.0.1' || hostname === '[::1]';
}

function writeMusicConfig(config) {
  const temporaryPath = MUSIC_CONFIG_PATH + '.tmp-' + randomValue(8);
  try {
    musicConfigFs.writeFileSync(temporaryPath, JSON.stringify(config), {
      encoding: 'utf8',
      mode: 0o600,
    });
    musicConfigFs.renameSync(temporaryPath, MUSIC_CONFIG_PATH);
  } catch (error) {
    try {
      musicConfigFs.unlinkSync(temporaryPath);
    } catch (_cleanupError) {
      // Ignore a missing temporary file.
    }
    throw error;
  }
}

function readMusicConfig() {
  try {
    const parsed = JSON.parse(musicConfigFs.readFileSync(MUSIC_CONFIG_PATH, 'utf8'));
    if (isMusicConfig(parsed)) return parsed;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const migrated = {};
    if (isNonEmptyString(parsed.spotifyClientId)) {
      migrated.spotifyClientId = parsed.spotifyClientId.trim();
    }
    if (isNonEmptyString(parsed.spotifyRedirectUri)) {
      migrated.spotifyRedirectUri = parsed.spotifyRedirectUri.trim();
    }
    if (isAppleMusicDeveloperToken(parsed.appleMusicDeveloperToken)) {
      migrated.appleMusicDeveloperToken = parsed.appleMusicDeveloperToken.trim();
    }
    if (isNonEmptyString(parsed.soundcloudClientId)) {
      migrated.soundcloudClientId = parsed.soundcloudClientId.trim();
    }
    if (isNonEmptyString(parsed.soundcloudClientSecret)) {
      migrated.soundcloudClientSecret = parsed.soundcloudClientSecret.trim();
    }
    if (isNonEmptyString(parsed.soundcloudRedirectUri)) {
      migrated.soundcloudRedirectUri = parsed.soundcloudRedirectUri.trim();
    }
    if (isNonEmptyString(parsed.youtubeClientId)) {
      migrated.youtubeClientId = parsed.youtubeClientId.trim();
    }
    if (isNonEmptyString(parsed.youtubeClientSecret)) {
      migrated.youtubeClientSecret = parsed.youtubeClientSecret.trim();
    }
    if (isNonEmptyString(parsed.youtubeRedirectUri)) {
      migrated.youtubeRedirectUri = parsed.youtubeRedirectUri.trim();
    }
    if (!isMusicConfig(migrated)) return {};
    if (Object.keys(parsed).some((key) => migrated[key] === undefined)) {
      writeMusicConfig(migrated);
    }
    return migrated;
  } catch (error) {
    if (error && error.code === 'ENOENT') return {};
    return {};
  }
}

function updateMusicConfig(patch) {
  const current = readMusicConfig();
  const next = {};
  const currentKeys = Object.keys(current);
  for (let currentIndex = 0; currentIndex < currentKeys.length; currentIndex += 1) {
    const currentKey = currentKeys[currentIndex];
    next[currentKey] = current[currentKey];
  }
  const patchKeys = Object.keys(patch);
  for (let patchIndex = 0; patchIndex < patchKeys.length; patchIndex += 1) {
    const key = patchKeys[patchIndex];
    if (patch[key] === null) delete next[key];
    else next[key] = patch[key].trim();
  }
  writeMusicConfig(next);
  return next;
}

function clearMusicConfig() {
  try {
    musicConfigFs.unlinkSync(MUSIC_CONFIG_PATH);
  } catch (error) {
    if (!error || error.code !== 'ENOENT') throw error;
  }
}

function getMusicConfigStatus(r) {
  const config = getConfig(r);
  return {
    spotify: {
      configured: Boolean(config.clientId),
      source: config.spotifySource,
      clientIdHint: config.clientId ? config.clientId.slice(-4) : null,
      redirectUri: config.redirectUri,
    },
    apple: {
      configured: Boolean(config.appleMusicDeveloperToken),
      source: config.appleMusicSource,
    },
    soundcloud: {
      configured: Boolean(config.soundcloudClientId && config.soundcloudClientSecret),
      source: config.soundcloudSource,
      secretConfigured: Boolean(config.soundcloudClientSecret),
      clientIdHint: config.soundcloudClientId
        ? config.soundcloudClientId.slice(-4)
        : null,
      redirectUri: config.soundcloudRedirectUri,
    },
    youtube: {
      configured: Boolean(config.youtubeClientId && config.youtubeClientSecret),
      source: config.youtubeSource,
      secretConfigured: Boolean(config.youtubeClientSecret),
      clientIdHint: config.youtubeClientId ? config.youtubeClientId.slice(-4) : null,
      redirectUri: config.youtubeRedirectUri,
    },
  };
}

async function resolveAppleMusicDeveloperToken() {
  const stored = readMusicConfig();
  const configuredToken =
    stored.appleMusicDeveloperToken || process.env.NAVET_APPLE_MUSIC_DEVELOPER_TOKEN || '';
  if (configuredToken) return configuredToken;
  if (
    cachedAppleMusicDeveloperToken &&
    cachedAppleMusicDeveloperTokenExpiresAt > Date.now()
  ) {
    return cachedAppleMusicDeveloperToken;
  }

  const tokenUrl =
    process.env.NAVET_APPLE_MUSIC_DEVELOPER_TOKEN_URL ||
    NAVET_APPLE_MUSIC_DEVELOPER_TOKEN_URL;
  const response = await ngx.fetch(tokenUrl, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error('Navet Apple Music authorization is unavailable');
  let payload;
  try {
    payload = await response.json();
  } catch (_error) {
    throw new Error('Navet Apple Music authorization returned an invalid credential');
  }
  if (typeof payload.developerToken !== 'string' || payload.developerToken.length < 100) {
    throw new Error('Navet Apple Music authorization returned an invalid credential');
  }
  cachedAppleMusicDeveloperToken = payload.developerToken;
  cachedAppleMusicDeveloperTokenExpiresAt = Date.now() + 60 * 60 * 1000;
  return cachedAppleMusicDeveloperToken;
}

function returnPath(config, status) {
  return (config.ingressPath || '') + '/music?music_oauth=spotify&status=' + status;
}

function isSession(value) {
  return (
    value &&
    typeof value.accessToken === 'string' &&
    typeof value.refreshToken === 'string' &&
    typeof value.expiresAt === 'number'
  );
}

async function exchangeToken(body) {
  const response = await ngx.fetch(SPOTIFY_ACCOUNTS_URL + '/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body,
  });
  if (!response.ok) throw new Error('Spotify token exchange failed');
  return await response.json();
}

async function refreshSession(r, context) {
  if (!context || !context.session || !isSession(context.session.auth)) return null;
  const latest = musicSessionStore.readSession(context.cookieId);
  if (!latest || !isSession(latest.auth)) return null;
  context.session = latest;
  const session = latest.auth;
  if (session.expiresAt > Date.now() + 30000) return session;
  const config = getConfig(r);
  if (!config.clientId) throw new Error('Spotify is not configured');
  let token;
  try {
    token = await exchangeToken(
      'grant_type=refresh_token&refresh_token=' +
        encodeURIComponent(session.refreshToken) +
        '&client_id=' +
        encodeURIComponent(config.clientId)
    );
  } catch (error) {
    const concurrent = musicSessionStore.readSession(context.cookieId);
    if (
      concurrent &&
      isSession(concurrent.auth) &&
      (concurrent.auth.accessToken !== session.accessToken ||
        concurrent.auth.expiresAt > session.expiresAt)
    ) {
      context.session = concurrent;
      return concurrent.auth;
    }
    throw error;
  }
  const next = {
    accessToken: token.access_token,
    refreshToken: token.refresh_token || session.refreshToken,
    expiresAt: Date.now() + Number(token.expires_in || 3600) * 1000,
    profile: session.profile || null,
    scope: token.scope || session.scope || '',
  };
  writeMusicSession(context, { auth: next });
  musicSessionStore.setSessionCookie(r, context.cookieId);
  return next;
}

async function loadProfile(accessToken) {
  const response = await ngx.fetch(SPOTIFY_API_URL + '/v1/me', {
    headers: { Authorization: 'Bearer ' + accessToken },
  });
  if (!response.ok) return null;
  const profile = await response.json();
  return {
    displayName: profile.display_name || profile.id || 'Spotify account',
    product: profile.product || null,
  };
}

async function handleAuthorize(r) {
  if (r.method !== 'POST') {
    r.headersOut.Allow = 'POST';
    return sendJson(r, 405, { error: 'Method not allowed' });
  }
  if (!providerSessionStore.isStrictSameOriginMutation(r)) {
    return sendJson(r, 403, { error: 'Cross-origin OAuth start is not allowed' });
  }
  const config = getConfig(r);
  if (!config.clientId) return sendJson(r, 503, { error: 'Spotify is not configured' });
  const verifier = randomValue(64);
  const challenge = base64Url(crypto.createHash('sha256').update(verifier).digest());
  const state = providerSessionStore.secureRandomHex(32);
  let context = musicSessionStore.getRequestSession(r);
  if (!context) context = musicSessionStore.createRequestSession(r);
  writeMusicSession(context, {
    pending: {
      verifier: verifier,
      state: state,
      expiresAt: Date.now() + OAUTH_PENDING_TTL_MS,
    },
  });
  musicSessionStore.setSessionCookie(r, context.cookieId);
  const query =
    'response_type=code&client_id=' +
    encodeURIComponent(config.clientId) +
    '&redirect_uri=' +
    encodeURIComponent(config.redirectUri) +
    '&scope=' +
    encodeURIComponent(SPOTIFY_OAUTH_SCOPE) +
    '&state=' +
    encodeURIComponent(state) +
    '&code_challenge_method=S256&code_challenge=' +
    encodeURIComponent(challenge);
  const spotifyAuthorizeUri = SPOTIFY_ACCOUNTS_URL + '/authorize?' + query;
  sendJson(r, 200, {
    authorizationUrl: getSpotifyAuthorizeLocation(r, config, spotifyAuthorizeUri),
  });
}

async function handleCallback(r) {
  const config = getConfig(r);
  const context = musicSessionStore.getRequestSession(r);
  const pending = context && context.session ? context.session.pending : null;
  if (
    !pending ||
    pending.expiresAt < Date.now() ||
    !r.args ||
    r.args.state !== pending.state ||
    typeof r.args.code !== 'string'
  ) {
    return sendRedirect(r, returnPath(config, 'failed'));
  }
  try {
    const token = await exchangeToken(
      'grant_type=authorization_code&code=' +
        encodeURIComponent(r.args.code) +
        '&redirect_uri=' +
        encodeURIComponent(config.redirectUri) +
        '&client_id=' +
        encodeURIComponent(config.clientId) +
        '&code_verifier=' +
        encodeURIComponent(pending.verifier)
    );
    if (typeof token.refresh_token !== 'string' || !token.refresh_token) {
      throw new Error('Spotify did not return a refresh token');
    }
    const profile = await loadProfile(token.access_token);
    const latest = musicSessionStore.readSession(context.cookieId) || context.session;
    musicSessionStore.rotateRequestSession(r, context.cookieId, {
      version: 1,
      createdAt: latest.createdAt,
      updatedAt: Date.now(),
      auth: {
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        expiresAt: Date.now() + Number(token.expires_in || 3600) * 1000,
        profile: profile,
        scope: token.scope || '',
      },
      pending: null,
      soundcloudAuth: latest.soundcloudAuth || null,
      soundcloudPending: latest.soundcloudPending || null,
      youtubeAuth: latest.youtubeAuth || null,
      youtubePending: latest.youtubePending || null,
    });
    sendRedirect(r, returnPath(config, 'connected'));
  } catch (_error) {
    if (context) writeMusicSession(context, { pending: null });
    sendRedirect(r, returnPath(config, 'failed'));
  }
}

async function handleStatus(r) {
  const config = getConfig(r);
  if (!config.clientId) {
    return sendJson(r, 200, {
      state: 'unavailable',
      reason: 'Spotify is not configured for this Navet installation',
      canConnect: false,
    });
  }
  const context = musicSessionStore.getRequestSession(r);
  if (!context || !isSession(context.session.auth)) {
    return sendJson(r, 200, { state: 'disconnected' });
  }
  try {
    const session = await refreshSession(r, context);
    if (!session) return sendJson(r, 200, { state: 'disconnected' });
    musicSessionStore.setSessionCookie(r, context.cookieId);
    if (!hasRequiredSpotifyScopes(session.scope)) {
      return sendJson(r, 200, {
        state: 'unavailable',
        reason: 'Reconnect Spotify to grant Navet the latest library and playback permissions.',
        canConnect: true,
      });
    }
    sendJson(r, 200, {
      state: 'connected',
      displayName: session.profile && session.profile.displayName,
      subscription: session.profile && session.profile.product,
    });
  } catch (_error) {
    sendJson(r, 200, {
      state: 'unavailable',
      reason: 'Spotify could not refresh this browser session. Retry or reconnect.',
    });
  }
}

async function handleSpotifySdkToken(r) {
  if (r.method !== 'GET') {
    r.headersOut.Allow = 'GET';
    return sendJson(r, 405, { error: 'Method not allowed' });
  }
  const context = musicSessionStore.getRequestSession(r);
  if (!context || !isSession(context.session.auth)) {
    return sendJson(r, 401, { error: 'Connect Spotify first' });
  }
  try {
    const session = await refreshSession(r, context);
    if (!session) return sendJson(r, 401, { error: 'Connect Spotify first' });
    if (typeof session.scope !== 'string' || session.scope.split(/\s+/).indexOf('streaming') === -1) {
      return sendJson(r, 409, {
        error: 'Reconnect Spotify to enable playback on this Navet display',
      });
    }
    musicSessionStore.setSessionCookie(r, context.cookieId);
    return sendJson(r, 200, {
      accessToken: session.accessToken,
      expiresAt: session.expiresAt,
    });
  } catch (_error) {
    return sendJson(r, 502, { error: 'Spotify could not refresh browser playback' });
  }
}

async function handleApi(r) {
  const context = musicSessionStore.getRequestSession(r);
  if (!context || !isSession(context.session.auth)) {
    return sendJson(r, 401, { error: 'Connect Spotify first' });
  }
  const session = await refreshSession(r, context);
  if (!session) return sendJson(r, 401, { error: 'Connect Spotify first' });
  musicSessionStore.setSessionCookie(r, context.cookieId);
  const path = r.uri.slice('/__navet_music__/spotify/api'.length);
  if (!path.startsWith('/v1/') || path.indexOf('..') !== -1) {
    return sendJson(r, 400, { error: 'Invalid Spotify API path' });
  }
  if (!isAllowedSpotifyOperation(r.method, path)) {
    return sendJson(r, 404, { error: 'Unsupported Spotify operation' });
  }
  if (
    r.method !== 'GET' &&
    r.method !== 'HEAD' &&
    !providerSessionStore.isStrictSameOriginMutation(r)
  ) {
    return sendJson(r, 403, { error: 'Cross-origin playback control is not allowed' });
  }
  const query = r.variables.args ? '?' + r.variables.args : '';
  const options = {
    method: r.method,
    headers: {
      Authorization: 'Bearer ' + session.accessToken,
      Accept: 'application/json',
      'Content-Type': r.headersIn['Content-Type'] || 'application/json',
    },
  };
  if (r.method !== 'GET' && r.method !== 'HEAD' && r.requestText) {
    options.body = r.requestText;
  }
  const response = await ngx.fetch(SPOTIFY_API_URL + path + query, options);
  const text = await response.text();
  r.headersOut['Cache-Control'] = 'no-store';
  r.headersOut['Content-Type'] = response.headers.get('Content-Type') || 'application/json';
  r.return(response.status, text);
}

function soundcloudReturnPath(config, status) {
  return (
    (config.ingressPath || '') +
    '/music?music_oauth=soundcloud&status=' +
    status
  );
}

async function exchangeSoundCloudToken(body) {
  const response = await ngx.fetch(SOUNDCLOUD_ACCOUNTS_URL + '/oauth/token', {
    method: 'POST',
    headers: {
      Accept: 'application/json; charset=utf-8',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body,
  });
  if (!response.ok) throw new Error('SoundCloud token exchange failed');
  const token = await response.json();
  const expiresIn = Number(token.expires_in);
  if (
    typeof token.access_token !== 'string' ||
    !token.access_token ||
    typeof token.refresh_token !== 'string' ||
    !token.refresh_token ||
    !Number.isFinite(expiresIn) ||
    expiresIn <= 0
  ) {
    throw new Error('SoundCloud returned an invalid credential');
  }
  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    expiresIn: expiresIn,
    scope: typeof token.scope === 'string' ? token.scope : '',
  };
}

async function refreshSoundCloudSession(r, context) {
  if (!context || !context.session || !isSession(context.session.soundcloudAuth)) {
    return null;
  }
  const latest = musicSessionStore.readSession(context.cookieId);
  if (!latest || !isSession(latest.soundcloudAuth)) return null;
  context.session = latest;
  const session = latest.soundcloudAuth;
  if (session.expiresAt > Date.now() + 30000) return session;
  const config = getConfig(r);
  if (!config.soundcloudClientId || !config.soundcloudClientSecret) {
    throw new Error('SoundCloud is not configured');
  }
  let token;
  try {
    token = await exchangeSoundCloudToken(
      'grant_type=refresh_token&client_id=' +
        encodeURIComponent(config.soundcloudClientId) +
        '&client_secret=' +
        encodeURIComponent(config.soundcloudClientSecret) +
        '&refresh_token=' +
        encodeURIComponent(session.refreshToken)
    );
  } catch (error) {
    const concurrent = musicSessionStore.readSession(context.cookieId);
    if (
      concurrent &&
      isSession(concurrent.soundcloudAuth) &&
      (concurrent.soundcloudAuth.accessToken !== session.accessToken ||
        concurrent.soundcloudAuth.expiresAt > session.expiresAt)
    ) {
      context.session = concurrent;
      return concurrent.soundcloudAuth;
    }
    throw error;
  }
  const next = {
    accessToken: token.accessToken,
    refreshToken: token.refreshToken,
    expiresAt: Date.now() + token.expiresIn * 1000,
    profile: session.profile || null,
    scope: token.scope || session.scope || '',
  };
  writeMusicSession(context, { soundcloudAuth: next });
  musicSessionStore.setSessionCookie(r, context.cookieId);
  return next;
}

async function loadSoundCloudProfile(accessToken) {
  const response = await ngx.fetch(SOUNDCLOUD_API_URL + '/me', {
    headers: {
      Accept: 'application/json; charset=utf-8',
      Authorization: 'OAuth ' + accessToken,
    },
  });
  if (!response.ok) return null;
  const profile = await response.json();
  return {
    displayName: profile.full_name || profile.username || 'SoundCloud account',
    avatarUrl: profile.avatar_url || null,
  };
}

async function handleSoundCloudAuthorize(r) {
  if (r.method !== 'POST') {
    r.headersOut.Allow = 'POST';
    return sendJson(r, 405, { error: 'Method not allowed' });
  }
  if (!providerSessionStore.isStrictSameOriginMutation(r)) {
    return sendJson(r, 403, { error: 'Cross-origin OAuth start is not allowed' });
  }
  const config = getConfig(r);
  if (!config.soundcloudClientId || !config.soundcloudClientSecret) {
    return sendJson(r, 503, { error: 'SoundCloud is not configured' });
  }
  const verifier = randomValue(64);
  const challenge = base64Url(crypto.createHash('sha256').update(verifier).digest());
  const state = providerSessionStore.secureRandomHex(32);
  let context = musicSessionStore.getRequestSession(r);
  if (!context) context = musicSessionStore.createRequestSession(r);
  writeMusicSession(context, {
    soundcloudPending: {
      verifier: verifier,
      state: state,
      expiresAt: Date.now() + OAUTH_PENDING_TTL_MS,
    },
  });
  musicSessionStore.setSessionCookie(r, context.cookieId);
  const query =
    'client_id=' +
    encodeURIComponent(config.soundcloudClientId) +
    '&redirect_uri=' +
    encodeURIComponent(config.soundcloudRedirectUri) +
    '&response_type=code&code_challenge=' +
    encodeURIComponent(challenge) +
    '&code_challenge_method=S256&state=' +
    encodeURIComponent(state);
  const authorizeUri = SOUNDCLOUD_ACCOUNTS_URL + '/authorize?' + query;
  return sendJson(r, 200, {
    authorizationUrl: getSoundCloudAuthorizeLocation(r, config, authorizeUri),
  });
}

async function handleSoundCloudCallback(r) {
  const config = getConfig(r);
  const context = musicSessionStore.getRequestSession(r);
  const pending = context && context.session ? context.session.soundcloudPending : null;
  if (
    !pending ||
    pending.expiresAt < Date.now() ||
    !r.args ||
    r.args.state !== pending.state ||
    typeof r.args.code !== 'string'
  ) {
    return sendRedirect(r, soundcloudReturnPath(config, 'failed'));
  }
  try {
    const token = await exchangeSoundCloudToken(
      'grant_type=authorization_code&client_id=' +
        encodeURIComponent(config.soundcloudClientId) +
        '&client_secret=' +
        encodeURIComponent(config.soundcloudClientSecret) +
        '&redirect_uri=' +
        encodeURIComponent(config.soundcloudRedirectUri) +
        '&code_verifier=' +
        encodeURIComponent(pending.verifier) +
        '&code=' +
        encodeURIComponent(r.args.code)
    );
    const profile = await loadSoundCloudProfile(token.accessToken);
    const latest = musicSessionStore.readSession(context.cookieId) || context.session;
    musicSessionStore.rotateRequestSession(r, context.cookieId, {
      version: 1,
      createdAt: latest.createdAt,
      updatedAt: Date.now(),
      auth: latest.auth || null,
      pending: latest.pending || null,
      soundcloudAuth: {
        accessToken: token.accessToken,
        refreshToken: token.refreshToken,
        expiresAt: Date.now() + token.expiresIn * 1000,
        profile: profile,
        scope: token.scope,
      },
      soundcloudPending: null,
      youtubeAuth: latest.youtubeAuth || null,
      youtubePending: latest.youtubePending || null,
    });
    sendRedirect(r, soundcloudReturnPath(config, 'connected'));
  } catch (_error) {
    if (context) writeMusicSession(context, { soundcloudPending: null });
    sendRedirect(r, soundcloudReturnPath(config, 'failed'));
  }
}

async function handleSoundCloudStatus(r) {
  const config = getConfig(r);
  if (!config.soundcloudClientId || !config.soundcloudClientSecret) {
    return sendJson(r, 200, {
      state: 'unavailable',
      reason: 'SoundCloud is not configured for this Navet installation',
      canConnect: false,
    });
  }
  const context = musicSessionStore.getRequestSession(r);
  if (!context || !isSession(context.session.soundcloudAuth)) {
    return sendJson(r, 200, { state: 'disconnected' });
  }
  try {
    const session = await refreshSoundCloudSession(r, context);
    if (!session) return sendJson(r, 200, { state: 'disconnected' });
    musicSessionStore.setSessionCookie(r, context.cookieId);
    return sendJson(r, 200, {
      state: 'connected',
      displayName: session.profile && session.profile.displayName,
    });
  } catch (_error) {
    return sendJson(r, 200, {
      state: 'unavailable',
      reason: 'SoundCloud could not refresh this browser session. Retry or reconnect.',
    });
  }
}

async function handleSoundCloudApi(r) {
  const context = musicSessionStore.getRequestSession(r);
  if (!context || !isSession(context.session.soundcloudAuth)) {
    return sendJson(r, 401, { error: 'Connect SoundCloud first' });
  }
  const session = await refreshSoundCloudSession(r, context);
  if (!session) return sendJson(r, 401, { error: 'Connect SoundCloud first' });
  musicSessionStore.setSessionCookie(r, context.cookieId);
  const path = r.uri.slice('/__navet_music__/soundcloud/api'.length);
  const allowed = isAllowedSoundCloudOperation(r.method, path);
  if (!allowed) return sendJson(r, 404, { error: 'Unsupported SoundCloud operation' });
  if (
    r.method !== 'GET' &&
    r.method !== 'HEAD' &&
    !providerSessionStore.isStrictSameOriginMutation(r)
  ) {
    return sendJson(r, 403, { error: 'Cross-origin library changes are not allowed' });
  }
  const query = r.variables.args ? '?' + r.variables.args : '';
  const response = await ngx.fetch(SOUNDCLOUD_API_URL + path + query, {
    method: r.method,
    headers: {
      Accept: 'application/json; charset=utf-8',
      Authorization: 'OAuth ' + session.accessToken,
    },
  });
  const text = await response.text();
  r.headersOut['Cache-Control'] = 'no-store';
  r.headersOut['Content-Type'] = response.headers.get('Content-Type') || 'application/json';
  r.return(response.status, text);
}

function youtubeReturnPath(config, status) {
  return (
    (config.ingressPath || '') +
    '/music?music_oauth=youtube_music&status=' +
    status
  );
}

async function exchangeYouTubeToken(body, fallbackRefreshToken) {
  const response = await ngx.fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body,
  });
  if (!response.ok) throw new Error('YouTube token exchange failed');
  const token = await response.json();
  const expiresIn = Number(token.expires_in);
  const refreshToken = token.refresh_token || fallbackRefreshToken || '';
  if (
    typeof token.access_token !== 'string' ||
    !token.access_token ||
    typeof refreshToken !== 'string' ||
    !refreshToken ||
    !Number.isFinite(expiresIn) ||
    expiresIn <= 0
  ) {
    throw new Error('YouTube returned an invalid credential');
  }
  return {
    accessToken: token.access_token,
    refreshToken: refreshToken,
    expiresIn: expiresIn,
    scope: typeof token.scope === 'string' ? token.scope : '',
  };
}

async function refreshYouTubeSession(r, context) {
  if (!context || !context.session || !isSession(context.session.youtubeAuth)) {
    return null;
  }
  const latest = musicSessionStore.readSession(context.cookieId);
  if (!latest || !isSession(latest.youtubeAuth)) return null;
  context.session = latest;
  const session = latest.youtubeAuth;
  if (session.expiresAt > Date.now() + 30000) return session;
  const config = getConfig(r);
  if (!config.youtubeClientId || !config.youtubeClientSecret) {
    throw new Error('YouTube is not configured');
  }
  let token;
  try {
    token = await exchangeYouTubeToken(
      'client_id=' +
        encodeURIComponent(config.youtubeClientId) +
        '&client_secret=' +
        encodeURIComponent(config.youtubeClientSecret) +
        '&grant_type=refresh_token&refresh_token=' +
        encodeURIComponent(session.refreshToken),
      session.refreshToken
    );
  } catch (error) {
    const concurrent = musicSessionStore.readSession(context.cookieId);
    if (
      concurrent &&
      isSession(concurrent.youtubeAuth) &&
      (concurrent.youtubeAuth.accessToken !== session.accessToken ||
        concurrent.youtubeAuth.expiresAt > session.expiresAt)
    ) {
      context.session = concurrent;
      return concurrent.youtubeAuth;
    }
    throw error;
  }
  const next = {
    accessToken: token.accessToken,
    refreshToken: token.refreshToken,
    expiresAt: Date.now() + token.expiresIn * 1000,
    profile: session.profile || null,
    scope: token.scope || session.scope || '',
  };
  writeMusicSession(context, { youtubeAuth: next });
  musicSessionStore.setSessionCookie(r, context.cookieId);
  return next;
}

async function loadYouTubeProfile(accessToken) {
  const response = await ngx.fetch(
    YOUTUBE_API_URL + '/youtube/v3/channels?part=snippet&mine=true&maxResults=1',
    {
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer ' + accessToken,
      },
    }
  );
  if (!response.ok) return null;
  const profile = await response.json();
  const snippet = profile.items && profile.items[0] && profile.items[0].snippet;
  return {
    displayName: snippet && snippet.title ? snippet.title : 'YouTube account',
    avatarUrl:
      snippet && snippet.thumbnails && snippet.thumbnails.default
        ? snippet.thumbnails.default.url || null
        : null,
  };
}

async function handleYouTubeAuthorize(r) {
  if (r.method !== 'POST') {
    r.headersOut.Allow = 'POST';
    return sendJson(r, 405, { error: 'Method not allowed' });
  }
  if (!providerSessionStore.isStrictSameOriginMutation(r)) {
    return sendJson(r, 403, { error: 'Cross-origin OAuth start is not allowed' });
  }
  const config = getConfig(r);
  if (!config.youtubeClientId || !config.youtubeClientSecret) {
    return sendJson(r, 503, { error: 'YouTube is not configured' });
  }
  const verifier = randomValue(64);
  const challenge = base64Url(crypto.createHash('sha256').update(verifier).digest());
  const state = providerSessionStore.secureRandomHex(32);
  let context = musicSessionStore.getRequestSession(r);
  if (!context) context = musicSessionStore.createRequestSession(r);
  writeMusicSession(context, {
    youtubePending: {
      verifier: verifier,
      state: state,
      expiresAt: Date.now() + OAUTH_PENDING_TTL_MS,
    },
  });
  musicSessionStore.setSessionCookie(r, context.cookieId);
  const query =
    'access_type=offline&client_id=' +
    encodeURIComponent(config.youtubeClientId) +
    '&code_challenge=' +
    encodeURIComponent(challenge) +
    '&code_challenge_method=S256&include_granted_scopes=true&prompt=consent&redirect_uri=' +
    encodeURIComponent(config.youtubeRedirectUri) +
    '&response_type=code&scope=' +
    encodeURIComponent('https://www.googleapis.com/auth/youtube.force-ssl') +
    '&state=' +
    encodeURIComponent(state);
  const authorizeUri = GOOGLE_ACCOUNTS_URL + '/o/oauth2/v2/auth?' + query;
  return sendJson(r, 200, {
    authorizationUrl: getYouTubeAuthorizeLocation(r, config, authorizeUri),
  });
}

async function handleYouTubeCallback(r) {
  const config = getConfig(r);
  const context = musicSessionStore.getRequestSession(r);
  const pending = context && context.session ? context.session.youtubePending : null;
  if (
    !pending ||
    pending.expiresAt < Date.now() ||
    !r.args ||
    r.args.state !== pending.state ||
    typeof r.args.code !== 'string'
  ) {
    return sendRedirect(r, youtubeReturnPath(config, 'failed'));
  }
  try {
    const token = await exchangeYouTubeToken(
      'client_id=' +
        encodeURIComponent(config.youtubeClientId) +
        '&client_secret=' +
        encodeURIComponent(config.youtubeClientSecret) +
        '&code=' +
        encodeURIComponent(r.args.code) +
        '&code_verifier=' +
        encodeURIComponent(pending.verifier) +
        '&grant_type=authorization_code&redirect_uri=' +
        encodeURIComponent(config.youtubeRedirectUri),
      ''
    );
    const profile = await loadYouTubeProfile(token.accessToken);
    const latest = musicSessionStore.readSession(context.cookieId) || context.session;
    musicSessionStore.rotateRequestSession(r, context.cookieId, {
      version: 1,
      createdAt: latest.createdAt,
      updatedAt: Date.now(),
      auth: latest.auth || null,
      pending: latest.pending || null,
      soundcloudAuth: latest.soundcloudAuth || null,
      soundcloudPending: latest.soundcloudPending || null,
      youtubeAuth: {
        accessToken: token.accessToken,
        refreshToken: token.refreshToken,
        expiresAt: Date.now() + token.expiresIn * 1000,
        profile: profile,
        scope: token.scope,
      },
      youtubePending: null,
    });
    sendRedirect(r, youtubeReturnPath(config, 'connected'));
  } catch (_error) {
    if (context) writeMusicSession(context, { youtubePending: null });
    sendRedirect(r, youtubeReturnPath(config, 'failed'));
  }
}

async function handleYouTubeStatus(r) {
  const config = getConfig(r);
  if (!config.youtubeClientId || !config.youtubeClientSecret) {
    return sendJson(r, 200, {
      state: 'unavailable',
      reason: 'YouTube is not configured for this Navet installation',
      canConnect: false,
    });
  }
  const context = musicSessionStore.getRequestSession(r);
  if (!context || !isSession(context.session.youtubeAuth)) {
    return sendJson(r, 200, { state: 'disconnected' });
  }
  try {
    const session = await refreshYouTubeSession(r, context);
    if (!session) return sendJson(r, 200, { state: 'disconnected' });
    musicSessionStore.setSessionCookie(r, context.cookieId);
    return sendJson(r, 200, {
      state: 'connected',
      displayName: session.profile && session.profile.displayName,
    });
  } catch (_error) {
    return sendJson(r, 200, {
      state: 'unavailable',
      reason: 'YouTube could not refresh this browser session. Retry or reconnect.',
    });
  }
}

async function handleYouTubeApi(r) {
  const context = musicSessionStore.getRequestSession(r);
  if (!context || !isSession(context.session.youtubeAuth)) {
    return sendJson(r, 401, { error: 'Connect YouTube first' });
  }
  const session = await refreshYouTubeSession(r, context);
  if (!session) return sendJson(r, 401, { error: 'Connect YouTube first' });
  musicSessionStore.setSessionCookie(r, context.cookieId);
  const path = r.uri.slice('/__navet_music__/youtube/api'.length);
  const allowed = isAllowedYouTubeOperation(r.method, path);
  if (!allowed) return sendJson(r, 404, { error: 'Unsupported YouTube operation' });
  if (
    r.method !== 'GET' &&
    r.method !== 'HEAD' &&
    !providerSessionStore.isStrictSameOriginMutation(r)
  ) {
    return sendJson(r, 403, { error: 'Cross-origin library changes are not allowed' });
  }
  const query = r.variables.args ? '?' + r.variables.args : '';
  const options = {
    method: r.method,
    headers: {
      Accept: 'application/json',
      Authorization: 'Bearer ' + session.accessToken,
      'Content-Type': r.headersIn['Content-Type'] || 'application/json',
    },
  };
  if (r.method !== 'GET' && r.method !== 'HEAD' && r.requestText) {
    options.body = r.requestText;
  }
  const response = await ngx.fetch(YOUTUBE_API_URL + path + query, options);
  const text = await response.text();
  r.headersOut['Cache-Control'] = 'no-store';
  r.headersOut['Content-Type'] = response.headers.get('Content-Type') || 'application/json';
  r.return(response.status, text);
}

async function handle(r) {
  const path = r.uri;
  if (path === '/__navet_music__/config') {
    if (r.method === 'GET') return sendJson(r, 200, getMusicConfigStatus(r));
    if (r.method === 'PUT') {
      if (!providerSessionStore.isStrictSameOriginMutation(r)) {
        return sendJson(r, 403, { error: 'Cross-origin music configuration is not allowed' });
      }
      if (!r.requestText || r.requestText.length > MAX_SESSION_BYTES) {
        return sendJson(r, 400, { error: 'Invalid music configuration' });
      }
      let patch;
      try {
        patch = JSON.parse(r.requestText);
      } catch (_error) {
        return sendJson(r, 400, { error: 'Invalid music configuration' });
      }
      if (!isMusicConfigPatch(patch)) {
        return sendJson(r, 400, { error: 'Invalid music configuration' });
      }
      updateMusicConfig(patch);
      clearAppleMusicDeveloperTokenCache();
      return sendJson(r, 200, getMusicConfigStatus(r));
    }
    r.headersOut.Allow = 'GET, PUT';
    return sendJson(r, 405, { error: 'Method not allowed' });
  }
  if (path === '/__navet_music__/spotify/authorize') return await handleAuthorize(r);
  if (path === CALLBACK_PATH || path.endsWith(CALLBACK_PATH)) return await handleCallback(r);
  if (path === '/__navet_music__/spotify/status') return await handleStatus(r);
  if (path === '/__navet_music__/spotify/sdk-token') return await handleSpotifySdkToken(r);
  if (path === '/__navet_music__/spotify/session' && r.method === 'DELETE') {
    if (!providerSessionStore.isStrictSameOriginMutation(r)) {
      return sendJson(r, 403, { error: 'Cross-origin disconnect is not allowed' });
    }
    const context = musicSessionStore.getRequestSession(r);
    if (context) {
      const next = writeMusicSession(context, { auth: null, pending: null });
      if (
        next.soundcloudAuth ||
        next.soundcloudPending ||
        next.youtubeAuth ||
        next.youtubePending
      ) {
        musicSessionStore.setSessionCookie(r, context.cookieId);
      } else {
        musicSessionStore.deleteSession(context.cookieId);
        musicSessionStore.clearSessionCookie(r);
      }
    } else {
      musicSessionStore.clearSessionCookie(r);
    }
    return sendJson(r, 200, { ok: true });
  }
  if (path.indexOf('/__navet_music__/spotify/api/v1/') === 0) {
    try {
      return await handleApi(r);
    } catch (_error) {
      return sendJson(r, 502, { error: 'Spotify request failed' });
    }
  }
  if (path === '/__navet_music__/soundcloud/authorize') {
    return await handleSoundCloudAuthorize(r);
  }
  if (path === SOUNDCLOUD_CALLBACK_PATH || path.endsWith(SOUNDCLOUD_CALLBACK_PATH)) {
    return await handleSoundCloudCallback(r);
  }
  if (path === '/__navet_music__/soundcloud/status') {
    return await handleSoundCloudStatus(r);
  }
  if (path === '/__navet_music__/soundcloud/session' && r.method === 'DELETE') {
    if (!providerSessionStore.isStrictSameOriginMutation(r)) {
      return sendJson(r, 403, { error: 'Cross-origin disconnect is not allowed' });
    }
    const context = musicSessionStore.getRequestSession(r);
    if (context) {
      const next = writeMusicSession(context, {
        soundcloudAuth: null,
        soundcloudPending: null,
      });
      if (next.auth || next.pending || next.youtubeAuth || next.youtubePending) {
        musicSessionStore.setSessionCookie(r, context.cookieId);
      } else {
        musicSessionStore.deleteSession(context.cookieId);
        musicSessionStore.clearSessionCookie(r);
      }
    } else {
      musicSessionStore.clearSessionCookie(r);
    }
    return sendJson(r, 200, { ok: true });
  }
  if (path.indexOf('/__navet_music__/soundcloud/api/') === 0) {
    try {
      return await handleSoundCloudApi(r);
    } catch (_error) {
      return sendJson(r, 502, { error: 'SoundCloud request failed' });
    }
  }
  if (path === '/__navet_music__/youtube/authorize') {
    return await handleYouTubeAuthorize(r);
  }
  if (path === YOUTUBE_CALLBACK_PATH || path.endsWith(YOUTUBE_CALLBACK_PATH)) {
    return await handleYouTubeCallback(r);
  }
  if (path === '/__navet_music__/youtube/status') {
    return await handleYouTubeStatus(r);
  }
  if (path === '/__navet_music__/youtube/session' && r.method === 'DELETE') {
    if (!providerSessionStore.isStrictSameOriginMutation(r)) {
      return sendJson(r, 403, { error: 'Cross-origin disconnect is not allowed' });
    }
    const context = musicSessionStore.getRequestSession(r);
    if (context) {
      const next = writeMusicSession(context, {
        youtubeAuth: null,
        youtubePending: null,
      });
      if (next.auth || next.pending || next.soundcloudAuth || next.soundcloudPending) {
        musicSessionStore.setSessionCookie(r, context.cookieId);
      } else {
        musicSessionStore.deleteSession(context.cookieId);
        musicSessionStore.clearSessionCookie(r);
      }
    } else {
      musicSessionStore.clearSessionCookie(r);
    }
    return sendJson(r, 200, { ok: true });
  }
  if (path.indexOf('/__navet_music__/youtube/api/youtube/v3/') === 0) {
    try {
      return await handleYouTubeApi(r);
    } catch (_error) {
      return sendJson(r, 502, { error: 'YouTube request failed' });
    }
  }
  if (path === '/__navet_music__/apple/status') {
    try {
      await resolveAppleMusicDeveloperToken();
      return sendJson(r, 200, { state: 'disconnected' });
    } catch (_error) {
      return sendJson(r, 200, {
        state: 'unavailable',
        reason: 'Apple Music authorization is not available for this Navet installation',
        canConnect: false,
      });
    }
  }
  if (path === '/__navet_music__/apple/developer-token') {
    try {
      const developerToken = await resolveAppleMusicDeveloperToken();
      return sendJson(r, 200, { developerToken: developerToken });
    } catch (error) {
      return sendJson(r, 503, {
        error: error && error.message ? error.message : 'Apple Music authorization is unavailable',
      });
    }
  }
  sendJson(r, 404, { error: 'Unknown music endpoint' });
}

export default {
  clearMusicConfig,
  getMusicConfigStatus,
  getSpotifyAuthorizeLocation,
  engineRequestAllowed,
  handle,
  isMusicConfig,
  isMusicConfigPatch,
  readMusicConfig,
  resetMusicConfigFsForTests,
  resetAppleMusicDeveloperTokenCacheForTests,
  resolveAppleMusicDeveloperToken,
  setMusicConfigFsForTests,
  updateMusicConfig,
};
