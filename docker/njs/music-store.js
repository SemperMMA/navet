import crypto from 'crypto';
import fs from 'fs';

const SESSION_PATH = '/data/navet-music-spotify-session.json';
const PENDING_PATH = '/data/navet-music-spotify-pending.json';
const MUSIC_CONFIG_PATH = '/data/navet-music-config.json';
const SPOTIFY_ACCOUNTS_URL = 'https://accounts.spotify.com';
const SPOTIFY_API_URL = 'https://api.spotify.com';
const CALLBACK_PATH = '/__navet_music__/spotify/callback';
const NAVET_SPOTIFY_OAUTH_RELAY_URI = 'https://navet.app/redirect/oauth';
const NAVET_APPLE_MUSIC_DEVELOPER_TOKEN_URL =
  'https://navet.app/api/music/apple/developer-token';
const MAX_BYTES = 32 * 1024;
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
  cachedAppleMusicDeveloperToken = '';
  cachedAppleMusicDeveloperTokenExpiresAt = 0;
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

function readJson(path) {
  try {
    if (fs.statSync(path).size > MAX_BYTES) return null;
    return JSON.parse(fs.readFileSync(path, 'utf8'));
  } catch (_error) {
    return null;
  }
}

function writeJson(path, value) {
  fs.writeFileSync(path, JSON.stringify(value), 'utf8');
}

function removeFile(path) {
  try {
    fs.unlinkSync(path);
  } catch (error) {
    if (!error || error.code !== 'ENOENT') throw error;
  }
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
  const protocol = (r.headersIn['X-Forwarded-Proto'] || 'http').split(',')[0].trim();
  return protocol + '://' + (r.headersIn.Host || 'localhost');
}

function getConfig(r) {
  const stored = readMusicConfig();
  const ingressPath = normalizeIngressPath(r.headersIn['X-Ingress-Path']);
  const redirectUri =
    stored.spotifyRedirectUri ||
    process.env.NAVET_SPOTIFY_REDIRECT_URI ||
    NAVET_SPOTIFY_OAUTH_RELAY_URI;
  const clientId = stored.spotifyClientId || process.env.NAVET_SPOTIFY_CLIENT_ID || '';
  return {
    clientId: clientId,
    redirectUri: redirectUri,
    ingressPath: ingressPath,
    spotifySource: stored.spotifyClientId ? 'stored' : clientId ? 'environment' : 'none',
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

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isMusicConfig(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const allowed = ['spotifyClientId', 'spotifyRedirectUri'];
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
  return true;
}

function isMusicConfigPatch(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const allowed = ['spotifyClientId', 'spotifyRedirectUri'];
  const keys = Object.keys(value);
  const redirectUri = value.spotifyRedirectUri;
  const redirectUriIsSecure =
    typeof redirectUri !== 'string' || isSecureSpotifyRedirectUri(redirectUri);
  return (
    keys.length > 0 &&
    keys.every((key) => allowed.indexOf(key) !== -1) &&
    keys.every((key) => value[key] === null || isNonEmptyString(value[key])) &&
    redirectUriIsSecure
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
    if (!isMusicConfig(migrated)) return {};
    if (parsed.appleMusicDeveloperToken !== undefined) {
      musicConfigFs.writeFileSync(MUSIC_CONFIG_PATH, JSON.stringify(migrated), 'utf8');
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
  musicConfigFs.writeFileSync(MUSIC_CONFIG_PATH, JSON.stringify(next), 'utf8');
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
  };
}

async function resolveAppleMusicDeveloperToken() {
  const environmentToken = process.env.NAVET_APPLE_MUSIC_DEVELOPER_TOKEN || '';
  if (environmentToken) return environmentToken;
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

async function refreshSession(r, session) {
  if (session.expiresAt > Date.now() + 30000) return session;
  const config = getConfig(r);
  if (!config.clientId) throw new Error('Spotify is not configured');
  const token = await exchangeToken(
    'grant_type=refresh_token&refresh_token=' +
      encodeURIComponent(session.refreshToken) +
      '&client_id=' +
      encodeURIComponent(config.clientId)
  );
  const next = {
    accessToken: token.access_token,
    refreshToken: token.refresh_token || session.refreshToken,
    expiresAt: Date.now() + Number(token.expires_in || 3600) * 1000,
    profile: session.profile || null,
    scope: token.scope || session.scope || '',
  };
  writeJson(SESSION_PATH, next);
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
  if (r.method !== 'GET') return sendJson(r, 405, { error: 'Method not allowed' });
  const config = getConfig(r);
  if (!config.clientId) return sendJson(r, 503, { error: 'Spotify is not configured' });
  const verifier = randomValue(64);
  const challenge = base64Url(crypto.createHash('sha256').update(verifier).digest());
  const state = randomValue(32);
  writeJson(PENDING_PATH, { verifier: verifier, state: state, createdAt: Date.now() });
  const query =
    'response_type=code&client_id=' +
    encodeURIComponent(config.clientId) +
    '&redirect_uri=' +
    encodeURIComponent(config.redirectUri) +
    '&scope=' +
    encodeURIComponent(
      'user-read-private user-library-read user-read-playback-state user-modify-playback-state user-read-currently-playing user-read-recently-played user-top-read streaming'
    ) +
    '&state=' +
    encodeURIComponent(state) +
    '&code_challenge_method=S256&code_challenge=' +
    encodeURIComponent(challenge);
  const spotifyAuthorizeUri = SPOTIFY_ACCOUNTS_URL + '/authorize?' + query;
  sendRedirect(r, getSpotifyAuthorizeLocation(r, config, spotifyAuthorizeUri));
}

async function handleCallback(r) {
  const config = getConfig(r);
  const pending = readJson(PENDING_PATH);
  removeFile(PENDING_PATH);
  if (
    !pending ||
    Date.now() - pending.createdAt > 10 * 60 * 1000 ||
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
    const profile = await loadProfile(token.access_token);
    writeJson(SESSION_PATH, {
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      expiresAt: Date.now() + Number(token.expires_in || 3600) * 1000,
      profile: profile,
      scope: token.scope || '',
    });
    sendRedirect(r, returnPath(config, 'connected'));
  } catch (_error) {
    sendRedirect(r, returnPath(config, 'failed'));
  }
}

async function handleStatus(r) {
  const config = getConfig(r);
  if (!config.clientId) {
    return sendJson(r, 200, { state: 'unavailable', reason: 'Spotify is not configured' });
  }
  const stored = readJson(SESSION_PATH);
  if (!isSession(stored)) return sendJson(r, 200, { state: 'disconnected' });
  try {
    const session = await refreshSession(r, stored);
    sendJson(r, 200, {
      state: 'connected',
      displayName: session.profile && session.profile.displayName,
      subscription: session.profile && session.profile.product,
    });
  } catch (_error) {
    sendJson(r, 200, { state: 'unavailable', reason: 'Spotify authorization expired' });
  }
}

async function handleApi(r) {
  const stored = readJson(SESSION_PATH);
  if (!isSession(stored)) return sendJson(r, 401, { error: 'Connect Spotify first' });
  const session = await refreshSession(r, stored);
  const path = r.uri.slice('/__navet_music__/spotify/api'.length);
  if (!path.startsWith('/v1/') || path.indexOf('..') !== -1) {
    return sendJson(r, 400, { error: 'Invalid Spotify API path' });
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

async function handle(r) {
  const path = r.uri;
  if (path === '/__navet_music__/config') {
    if (r.method === 'GET') return sendJson(r, 200, getMusicConfigStatus(r));
    if (r.method === 'PUT') {
      try {
        const body = r.requestText || '';
        if (!body || body.length > MAX_BYTES) {
          return sendJson(r, body.length > MAX_BYTES ? 413 : 400, {
            error: body.length > MAX_BYTES ? 'Music configuration is too large' : 'Missing body',
          });
        }
        const parsed = JSON.parse(body);
        if (!isMusicConfigPatch(parsed)) {
          return sendJson(r, 400, { error: 'Unsupported music configuration' });
        }
        updateMusicConfig(parsed);
        if ('spotifyClientId' in parsed || 'spotifyRedirectUri' in parsed) {
          removeFile(SESSION_PATH);
          removeFile(PENDING_PATH);
        }
        return sendJson(r, 200, getMusicConfigStatus(r));
      } catch (_error) {
        return sendJson(r, 400, { error: 'Unable to save music configuration' });
      }
    }
    if (r.method === 'DELETE') {
      clearMusicConfig();
      removeFile(SESSION_PATH);
      removeFile(PENDING_PATH);
      return sendJson(r, 200, getMusicConfigStatus(r));
    }
    r.headersOut.Allow = 'GET, PUT, DELETE';
    return sendJson(r, 405, { error: 'Method not allowed' });
  }
  if (path === '/__navet_music__/spotify/authorize') return await handleAuthorize(r);
  if (path === CALLBACK_PATH || path.endsWith(CALLBACK_PATH)) return await handleCallback(r);
  if (path === '/__navet_music__/spotify/status') return await handleStatus(r);
  if (path === '/__navet_music__/spotify/session' && r.method === 'DELETE') {
    removeFile(SESSION_PATH);
    return sendJson(r, 200, { ok: true });
  }
  if (path.indexOf('/__navet_music__/spotify/api/v1/') === 0) {
    try {
      return await handleApi(r);
    } catch (_error) {
      return sendJson(r, 502, { error: 'Spotify request failed' });
    }
  }
  if (path === '/__navet_music__/apple/status') {
    try {
      await resolveAppleMusicDeveloperToken();
      return sendJson(r, 200, { state: 'disconnected' });
    } catch (error) {
      return sendJson(r, 200, {
        state: 'unavailable',
        reason: error && error.message ? error.message : 'Apple Music authorization is unavailable',
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
