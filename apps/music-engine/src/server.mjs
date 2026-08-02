import { createServer } from 'node:http'
import {
  MusicEngineInputError,
  parseControlRequest,
  parseGroupRequest,
  parsePlayRequest,
  parseUngroupRequest,
} from './request-validation.mjs'
import {
  controlSonos,
  discoverSonosPlayers,
  enqueueSonosSpotifyUri,
  getSonosGroups,
  getSonosPlaybackState,
  groupSonosPlayers,
  playSonosSpotifyUri,
  ungroupSonosPlayer,
} from './sonos.mjs'

const port = Number.parseInt(process.env.NAVET_MUSIC_ENGINE_PORT ?? '5211', 10)
const host = process.env.NAVET_MUSIC_ENGINE_HOST ?? '127.0.0.1'
const configuredSonosHosts = (process.env.NAVET_SONOS_HOSTS ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)
let players = []
let lastDiscoveryAt = 0
let playback = {
  sourceId: 'spotify',
  targetId: null,
  targetAdapterId: 'navet-music-engine',
  state: 'idle',
  currentItem: null,
  positionMs: 0,
  volume: 0.5,
  shuffle: false,
  repeat: 'off',
  updatedAt: new Date().toISOString(),
}
let queue = { sourceId: 'spotify', items: [], currentIndex: null, revision: '0' }
let playbackStartedAt = 0
let accumulatedPositionMs = 0
let playbackMode = null

function currentPlayback() {
  const positionMs =
    playback.state === 'playing'
      ? accumulatedPositionMs + Math.max(0, Date.now() - playbackStartedAt)
      : accumulatedPositionMs
  return { ...playback, positionMs }
}

async function reconcilePlayback() {
  if (!playback.targetId || playbackMode !== 'sonos_spotify') return currentPlayback()
  await refreshPlayers()
  const player = players.find((candidate) => candidate.id === playback.targetId)
  if (!player) {
    playback = { ...playback, state: 'unavailable', updatedAt: new Date().toISOString() }
    return currentPlayback()
  }
  try {
    const actual = await getSonosPlaybackState(player)
    const queueIndex =
      actual.trackNumber && queue.items[actual.trackNumber - 1]
        ? actual.trackNumber - 1
        : queue.currentIndex
    if (queueIndex !== queue.currentIndex) {
      queue = { ...queue, currentIndex: queueIndex, revision: String(Date.now()) }
    }
    accumulatedPositionMs = actual.positionMs
    playbackStartedAt = actual.state === 'playing' ? Date.now() : 0
    playback = {
      ...playback,
      state: actual.state,
      currentItem: queueIndex === null ? playback.currentItem : (queue.items[queueIndex] ?? playback.currentItem),
      positionMs: actual.positionMs,
      durationMs: actual.durationMs ?? playback.durationMs,
      updatedAt: new Date().toISOString(),
    }
  } catch {
    playback = { ...playback, state: 'unavailable', updatedAt: new Date().toISOString() }
    playbackStartedAt = 0
  }
  return currentPlayback()
}

function json(res, status, value) {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  })
  res.end(body)
}

async function readJson(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > 64 * 1024) throw new MusicEngineInputError('Request body is too large', 413)
    chunks.push(chunk)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new MusicEngineInputError('Request body must be valid JSON')
  }
}

async function refreshPlayers(force = false) {
  if (!force && Date.now() - lastDiscoveryAt < 15_000) return players
  players = await discoverSonosPlayers({ configuredHosts: configuredSonosHosts })
  const groups = await getSonosGroups(players).catch(() => [])
  players = players.map((player) => {
    const group = groups.find((candidate) => candidate.memberIds.includes(player.id))
    return group
      ? {
          ...player,
          groupId: group.id,
          groupCoordinatorId: group.coordinatorId,
          groupMemberIds: group.memberIds,
        }
      : player
  })
  lastDiscoveryAt = Date.now()
  return players
}

function publicPlayer(player) {
  const {
    controlUrl: _controlUrl,
    renderingControlUrl: _renderingControlUrl,
    zoneGroupTopologyUrl: _zoneGroupTopologyUrl,
    location: _location,
    ...target
  } = player
  return target
}

function findPlayer(id) {
  const player = players.find((candidate) => candidate.id === id)
  if (!player) throw new Error('The selected Sonos speaker is no longer available')
  return player
}

async function beginPlayback(request) {
  if (!request?.targetId || request.item?.sourceId !== 'spotify' || !request.item?.uri) {
    throw new Error('A Spotify item and Sonos target are required')
  }
  await refreshPlayers()
  const player = findPlayer(request.targetId)
  const canExtendCurrentQueue =
    queue.currentIndex !== null &&
    playbackMode === 'sonos_spotify' &&
    playback.targetId === player.id
  if ((request.queueMode === 'add' || request.queueMode === 'next') && canExtendCurrentQueue) {
    const position = request.queueMode === 'next' ? 'next' : 'later'
    await enqueueSonosSpotifyUri(player, request.item.uri, request.item.title, { position })
    const insertAt = position === 'next' ? queue.currentIndex + 1 : queue.items.length
    queue = {
      ...queue,
      items: [...queue.items.slice(0, insertAt), request.item, ...queue.items.slice(insertAt)],
      revision: String(Date.now()),
    }
    return { sourceId: 'spotify', targetId: player.id, queue, playback }
  }
  queue = {
    sourceId: 'spotify',
    items: [request.item],
    currentIndex: 0,
    revision: String(Date.now()),
  }
  try {
    await playSonosSpotifyUri(player, request.item.uri, request.item.title)
    playbackMode = 'sonos_spotify'
    playback = {
      sourceId: 'spotify',
      targetId: player.id,
      targetAdapterId: 'navet-music-engine',
      state: 'playing',
      currentItem: request.item,
      durationMs: request.item.durationMs,
      volume: playback.volume,
      shuffle: playback.shuffle,
      repeat: playback.repeat,
      positionMs: 0,
      updatedAt: new Date().toISOString(),
    }
    accumulatedPositionMs = 0
    playbackStartedAt = Date.now()
    return { sourceId: 'spotify', targetId: player.id, queue, playback }
  } catch (sonosSpotifyError) {
    const sonosMessage =
      sonosSpotifyError instanceof Error ? sonosSpotifyError.message : 'Sonos rejected Spotify'
    throw new Error(
      `${sonosMessage}. Link Spotify in the Sonos household or choose a Spotify Connect target.`
    )
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
    const route = url.pathname.replace(/^\/__navet_music_engine__/, '') || '/'
    if (req.method === 'GET' && route === '/status') {
      json(res, 200, {
        state: 'ready',
        version: '0.1.0',
        lanStreamBaseUrl: '',
        spotifyAudioAvailable: true,
        localTranscodingAvailable: false,
        protocols: ['sonos'],
      })
      return
    }
    if (req.method === 'GET' && route === '/targets') {
      json(res, 200, (await refreshPlayers(url.searchParams.has('refresh'))).map(publicPlayer))
      return
    }
    if (req.method === 'POST' && route === '/play') {
      json(res, 200, await beginPlayback(parsePlayRequest(await readJson(req))))
      return
    }
    if (req.method === 'POST' && route === '/group') {
      const body = parseGroupRequest(await readJson(req))
      await refreshPlayers(true)
      const coordinator = findPlayer(body.coordinatorId)
      const memberIds = Array.isArray(body.memberIds) ? body.memberIds : []
      const members = memberIds.map(findPlayer)
      await groupSonosPlayers(coordinator, members)
      json(res, 200, (await refreshPlayers(true)).map(publicPlayer))
      return
    }
    if (req.method === 'POST' && route === '/ungroup') {
      const body = parseUngroupRequest(await readJson(req))
      await refreshPlayers(true)
      await ungroupSonosPlayer(findPlayer(body.targetId))
      json(res, 200, (await refreshPlayers(true)).map(publicPlayer))
      return
    }
    if (req.method === 'POST' && route === '/control') {
      const body = parseControlRequest(await readJson(req))
      await refreshPlayers()
      const player = findPlayer(body.targetId)
      if (body.command?.type === 'next' || body.command?.type === 'previous') {
        const delta = body.command.type === 'next' ? 1 : -1
        const nextIndex = (queue.currentIndex ?? 0) + delta
        await controlSonos(player, body.command)
        if (queue.items[nextIndex]) {
          queue = { ...queue, currentIndex: nextIndex, revision: String(Date.now()) }
          playback = { ...playback, currentItem: queue.items[nextIndex] }
          accumulatedPositionMs = 0
          playbackStartedAt = Date.now()
        }
      } else if (body.command?.type === 'seek') {
        const index = queue.currentIndex
        if (index === null) throw new Error('Nothing is playing')
        await controlSonos(player, body.command)
        accumulatedPositionMs = body.command.positionMs
        playbackStartedAt = Date.now()
      } else if (body.command?.type === 'set_shuffle' || body.command?.type === 'set_repeat') {
        const shuffle =
          body.command.type === 'set_shuffle' ? Boolean(body.command.enabled) : Boolean(playback.shuffle)
        const repeat =
          body.command.type === 'set_repeat' ? body.command.mode : (playback.repeat ?? 'off')
        await controlSonos(player, { type: 'set_play_mode', shuffle, repeat })
        playback = { ...playback, shuffle, repeat }
      } else {
        if (body.command?.type === 'pause') {
          accumulatedPositionMs = currentPlayback().positionMs
          playbackStartedAt = 0
        }
        await controlSonos(player, body.command)
        if (body.command?.type === 'play') playbackStartedAt = Date.now()
        if (body.command?.type === 'set_volume') playback = { ...playback, volume: body.command.volume }
      }
      playback = {
        ...playback,
        state:
          body.command?.type === 'pause'
            ? 'paused'
            : body.command?.type === 'play'
              ? 'playing'
              : playback.state,
        updatedAt: new Date().toISOString(),
      }
      json(res, 200, playback)
      return
    }
    if (req.method === 'GET' && route === '/playback') {
      json(res, 200, await reconcilePlayback())
      return
    }
    if (req.method === 'GET' && route === '/queue') {
      json(res, 200, queue)
      return
    }
    json(res, 404, { error: 'Music engine route not found' })
  } catch (error) {
    json(res, error instanceof MusicEngineInputError ? error.statusCode : 502, {
      error: error instanceof Error ? error.message : 'Music engine failed',
    })
  }
})

server.listen(port, host, () => {
  process.stdout.write(`Navet music engine listening on ${host}:${port}\n`)
})

const shutdown = () => {
  server.close(() => process.exit(0))
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
