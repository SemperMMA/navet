const SPOTIFY_OAUTH_SCOPES = [
  'streaming',
  'user-read-private',
  'user-library-read',
  'user-library-modify',
  'playlist-read-private',
  'playlist-modify-public',
  'playlist-modify-private',
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'user-read-recently-played',
  'user-top-read',
];

function hasRequiredSpotifyScopes(scope) {
  if (typeof scope !== 'string') return false;
  const granted = scope.split(/\s+/).filter(Boolean);
  return SPOTIFY_OAUTH_SCOPES.every(function (required) {
    return granted.indexOf(required) !== -1;
  });
}

const SPOTIFY_READ_OPERATIONS = [
  '/v1/search',
  '/v1/me',
  '/v1/me/tracks',
  '/v1/me/playlists',
  '/v1/me/albums',
  '/v1/me/player/recently-played',
  '/v1/me/top/artists',
  '/v1/me/player',
  '/v1/me/player/queue',
  '/v1/me/player/devices',
];

const SPOTIFY_PLAYBACK_OPERATIONS = [
  'PUT /v1/me/player',
  'PUT /v1/me/player/play',
  'PUT /v1/me/player/pause',
  'PUT /v1/me/player/seek',
  'PUT /v1/me/player/volume',
  'PUT /v1/me/player/shuffle',
  'PUT /v1/me/player/repeat',
  'POST /v1/me/player/next',
  'POST /v1/me/player/previous',
  'POST /v1/me/player/queue',
];

const YOUTUBE_READ_OPERATIONS = [
  '/youtube/v3/channels',
  '/youtube/v3/playlistItems',
  '/youtube/v3/playlists',
  '/youtube/v3/search',
  '/youtube/v3/videos',
];

function isAllowedSpotifyOperation(method, path) {
  if (typeof method !== 'string' || typeof path !== 'string') return false;
  if (method === 'GET' && SPOTIFY_READ_OPERATIONS.indexOf(path) !== -1) return true;
  if (
    method === 'GET' &&
    (/^\/v1\/albums\/[A-Za-z0-9]+\/tracks$/.test(path) ||
      /^\/v1\/playlists\/[A-Za-z0-9]+\/items$/.test(path) ||
      /^\/v1\/artists\/[A-Za-z0-9]+\/albums$/.test(path))
  ) {
    return true;
  }
  if ((method === 'PUT' || method === 'DELETE') && path === '/v1/me/library') return true;
  if (method === 'POST' && /^\/v1\/playlists\/[A-Za-z0-9]+\/items$/.test(path)) return true;
  return SPOTIFY_PLAYBACK_OPERATIONS.indexOf(method + ' ' + path) !== -1;
}

function isAllowedSoundCloudOperation(method, path) {
  if (typeof method !== 'string' || typeof path !== 'string') return false;
  if (
    method === 'GET' &&
    (path === '/tracks' ||
      path === '/playlists' ||
      path === '/users' ||
      path === '/me/playlists' ||
      path === '/me/followings' ||
      path === '/me/recently-played/tracks' ||
      path === '/me/likes/tracks' ||
      path === '/me/likes/playlists' ||
      /^\/tracks\/soundcloud:tracks:[0-9]+$/.test(path) ||
      /^\/users\/soundcloud:users:[0-9]+\/tracks$/.test(path) ||
      /^\/playlists\/soundcloud:playlists:[0-9]+\/tracks$/.test(path))
  ) {
    return true;
  }
  if (
    (method === 'POST' || method === 'DELETE') &&
    /^\/likes\/(tracks|playlists)\/soundcloud:\1:[0-9]+$/.test(path)
  ) {
    return true;
  }
  return (
    (method === 'PUT' || method === 'DELETE') &&
    /^\/me\/followings\/soundcloud:users:[0-9]+$/.test(path)
  );
}

function isAllowedYouTubeOperation(method, path) {
  if (typeof method !== 'string' || typeof path !== 'string') return false;
  if (method === 'GET' && YOUTUBE_READ_OPERATIONS.indexOf(path) !== -1) return true;
  return (
    method === 'POST' &&
    (path === '/youtube/v3/videos/rate' || path === '/youtube/v3/playlistItems')
  );
}

export default {
  SPOTIFY_OAUTH_SCOPES,
  hasRequiredSpotifyScopes,
  isAllowedSoundCloudOperation,
  isAllowedSpotifyOperation,
  isAllowedYouTubeOperation,
};
