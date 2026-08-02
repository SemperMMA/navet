const TARGET_ID_PATTERN = /^[^\u0000-\u001f\u007f]{1,256}$/
const SPOTIFY_URI_PATTERN = /^spotify:(album|episode|playlist|track):([a-zA-Z0-9]{1,128})$/
const MUSIC_ITEM_TYPES = new Set(['album', 'episode', 'playlist', 'track'])
const QUEUE_MODES = new Set(['add', 'next', 'replace'])
const SIMPLE_COMMANDS = new Set(['next', 'pause', 'play', 'previous'])
const REPEAT_MODES = new Set(['all', 'off', 'one'])

export class MusicEngineInputError extends Error {
  constructor(message, statusCode = 400) {
    super(message)
    this.name = 'MusicEngineInputError'
    this.statusCode = statusCode
  }
}

function inputError(message) {
  throw new MusicEngineInputError(message)
}

function record(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) inputError(`${label} is required`)
  return value
}

function boundedString(value, label, maxLength) {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
    inputError(`${label} is invalid`)
  }
  return value
}

export function parseTargetId(value, label = 'Target ID') {
  if (typeof value !== 'string' || !TARGET_ID_PATTERN.test(value)) inputError(`${label} is invalid`)
  return value
}

function optionalUrl(value) {
  if (value === undefined || value === null) return value
  if (typeof value !== 'string' || value.length > 4096) inputError('Artwork URL is invalid')
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') inputError('Artwork URL is invalid')
  } catch {
    inputError('Artwork URL is invalid')
  }
  return value
}

function parseSpotifyItem(value) {
  const item = record(value, 'Spotify item')
  const id = boundedString(item.id, 'Spotify item ID', 256)
  const title = boundedString(item.title, 'Spotify item title', 1024)
  if (item.sourceId !== 'spotify') inputError('Only Spotify items can be sent to Sonos')
  if (!MUSIC_ITEM_TYPES.has(item.type)) inputError('Spotify item type is invalid')
  const uri = boundedString(item.uri, 'Spotify item URI', 256)
  const uriMatch = uri.match(SPOTIFY_URI_PATTERN)
  if (!uriMatch || uriMatch[1] !== item.type) inputError('Spotify item URI does not match its type')
  if (!Array.isArray(item.artists) || item.artists.length > 32) inputError('Spotify artists are invalid')
  const artists = item.artists.map((artist) => boundedString(artist, 'Spotify artist', 512))
  const durationMs = item.durationMs
  if (
    durationMs !== undefined &&
    (!Number.isFinite(durationMs) || durationMs < 0 || durationMs > 7 * 24 * 60 * 60 * 1000)
  ) {
    inputError('Spotify item duration is invalid')
  }
  return {
    id,
    sourceId: 'spotify',
    type: item.type,
    title,
    artists,
    uri,
    ...(durationMs === undefined ? {} : { durationMs }),
    ...(item.artworkUrl === undefined ? {} : { artworkUrl: optionalUrl(item.artworkUrl) }),
  }
}

export function parsePlayRequest(value) {
  const request = record(value, 'Play request')
  if (!QUEUE_MODES.has(request.queueMode)) inputError('Queue mode is invalid')
  return {
    targetId: parseTargetId(request.targetId),
    item: parseSpotifyItem(request.item),
    queueMode: request.queueMode,
  }
}

export function parseGroupRequest(value) {
  const request = record(value, 'Group request')
  if (!Array.isArray(request.memberIds) || request.memberIds.length > 64) {
    inputError('Group members are invalid')
  }
  return {
    coordinatorId: parseTargetId(request.coordinatorId, 'Coordinator ID'),
    memberIds: [...new Set(request.memberIds.map((id) => parseTargetId(id, 'Member ID')))],
  }
}

export function parseUngroupRequest(value) {
  const request = record(value, 'Ungroup request')
  return { targetId: parseTargetId(request.targetId) }
}

export function parseControlRequest(value) {
  const request = record(value, 'Control request')
  const command = record(request.command, 'Transport command')
  if (SIMPLE_COMMANDS.has(command.type)) {
    return { targetId: parseTargetId(request.targetId), command: { type: command.type } }
  }
  if (command.type === 'seek') {
    if (
      !Number.isFinite(command.positionMs) ||
      command.positionMs < 0 ||
      command.positionMs > 7 * 24 * 60 * 60 * 1000
    ) {
      inputError('Seek position is invalid')
    }
    return {
      targetId: parseTargetId(request.targetId),
      command: { type: 'seek', positionMs: command.positionMs },
    }
  }
  if (command.type === 'set_volume') {
    if (!Number.isFinite(command.volume) || command.volume < 0 || command.volume > 1) {
      inputError('Volume is invalid')
    }
    return {
      targetId: parseTargetId(request.targetId),
      command: { type: 'set_volume', volume: command.volume },
    }
  }
  if (command.type === 'set_shuffle') {
    if (typeof command.enabled !== 'boolean') inputError('Shuffle state is invalid')
    return {
      targetId: parseTargetId(request.targetId),
      command: { type: 'set_shuffle', enabled: command.enabled },
    }
  }
  if (command.type === 'set_repeat') {
    if (!REPEAT_MODES.has(command.mode)) inputError('Repeat mode is invalid')
    return {
      targetId: parseTargetId(request.targetId),
      command: { type: 'set_repeat', mode: command.mode },
    }
  }
  inputError('Transport command is not supported')
}
