import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  controlSonos,
  discoverSonosPlayers,
  enqueueSonosSpotifyUri,
  getSonosGroups,
  groupSonosPlayers,
  playSonosSpotifyUri,
  playSonosStream,
  ungroupSonosPlayer,
} from './sonos.mjs'
import {
  defaultSpotifyPaths,
  ensureSpotifyAudioCredentials,
  getSpotifyAudioSessionStatus,
  SpotifyStreamSession,
} from './spotify-stream.mjs'

const port = Number.parseInt(process.env.NAVET_MUSIC_ENGINE_PORT ?? '5211', 10)
const host = process.env.NAVET_MUSIC_ENGINE_HOST ?? '0.0.0.0'
const dataPath = process.env.NAVET_DATA_PATH ?? '/data'
const streamBaseUrl = (
  process.env.NAVET_MUSIC_STREAM_BASE_URL ??
  'http://navet.local/__navet_music_engine__/stream'
).replace(/\/$/, '')
const spotifyPaths = defaultSpotifyPaths(dataPath)
const configuredSonosHosts = (process.env.NAVET_SONOS_HOSTS ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)
const librespotPath = process.env.NAVET_LIBRESPOT_PATH ?? 'librespot'
const ffmpegPath = process.env.NAVET_FFMPEG_PATH ?? 'ffmpeg'

function binaryAvailable(command, versionArgument = '--version') {
  const result = spawnSync(command, [versionArgument], { stdio: 'ignore' })
  return !result.error && result.status === 0
}

const audioRuntimeStatus = !binaryAvailable(librespotPath)
  ? { available: false, reason: 'Librespot is not installed in this Navet runtime' }
  : !binaryAvailable(ffmpegPath, '-version')
    ? { available: false, reason: 'FFmpeg is not installed in this Navet runtime' }
    : { available: true }

let players = []
let lastDiscoveryAt = 0
let activeSession = null
let playback = {
  sourceId: 'spotify',
  targetId: null,
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
    if (size > 64 * 1024) throw new Error('Request body is too large')
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
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

function stopActiveSession() {
  activeSession?.stream.stop()
  activeSession = null
}

async function beginPlayback(request) {
  if (!request?.targetId || request.item?.sourceId !== 'spotify' || !request.item?.uri) {
    throw new Error('A Spotify item and Sonos target are required')
  }
  await refreshPlayers()
  const player = findPlayer(request.targetId)
  const spotifyStatus = getSpotifyAudioSessionStatus(spotifyPaths.sessionPath)
  if (!spotifyStatus.available) throw new Error(spotifyStatus.reason)
  if (request.queueMode === 'add' && queue.currentIndex !== null) {
    if (playbackMode === 'sonos_spotify') {
      await enqueueSonosSpotifyUri(player, request.item.uri, request.item.title)
    }
    queue = { ...queue, items: [...queue.items, request.item], revision: String(Date.now()) }
    return { sourceId: 'spotify', targetId: player.id, queue, playback }
  }
  if (request.queueMode === 'next' && queue.currentIndex !== null) {
    const insertAt = queue.currentIndex + 1
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
    stopActiveSession()
    await playSonosSpotifyUri(player, request.item.uri, request.item.title)
    playbackMode = 'sonos_spotify'
    playback = {
      sourceId: 'spotify',
      targetId: player.id,
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
    if (!audioRuntimeStatus.available) {
      const sonosMessage =
        sonosSpotifyError instanceof Error ? sonosSpotifyError.message : 'Sonos rejected Spotify'
      throw new Error(`${sonosMessage}. ${audioRuntimeStatus.reason}`)
    }
    await ensureSpotifyAudioCredentials({
      ...spotifyPaths,
      librespotPath,
    })
  }
  return await playQueueIndex(player, 0)
}

async function playQueueIndex(player, index, startPositionMs = 0) {
  const item = queue.items[index]
  if (!item?.uri) throw new Error('The requested queue item is unavailable')
  stopActiveSession()
  playbackMode = 'navet_stream'
  const id = randomUUID()
  const stream = new SpotifyStreamSession({
    uri: item.uri,
    ...spotifyPaths,
    librespotPath,
    ffmpegPath,
    startPositionMs,
    onEnded: () => {
      if (activeSession?.id !== id) return
      const nextIndex = index + 1
      if (nextIndex < queue.items.length) {
        void playQueueIndex(player, nextIndex).catch((error) =>
          process.stderr.write(`Unable to advance Navet music queue: ${error.message}\n`)
        )
      } else {
        playback = { ...playback, state: 'idle', updatedAt: new Date().toISOString() }
      }
    },
  })
  activeSession = { id, stream, item, targetId: player.id }
  const streamUrl = `${streamBaseUrl}/${id}.mp3`
  await playSonosStream(player, streamUrl)
  queue = { ...queue, currentIndex: index, revision: String(Date.now()) }
  playback = {
    sourceId: 'spotify',
    targetId: player.id,
    state: 'buffering',
    currentItem: item,
    durationMs: item.durationMs,
    volume: playback.volume,
    shuffle: playback.shuffle,
    repeat: playback.repeat,
    positionMs: startPositionMs,
    updatedAt: new Date().toISOString(),
  }
  accumulatedPositionMs = startPositionMs
  playbackStartedAt = 0
  return { sourceId: 'spotify', targetId: player.id, queue, playback }
}

async function handleStream(req, res, sessionId) {
  if (!activeSession || activeSession.id !== sessionId) {
    res.writeHead(404)
    res.end()
    return
  }
  res.writeHead(200, {
    'Content-Type': 'audio/mpeg',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'Transfer-Encoding': 'chunked',
    'icy-name': activeSession.item.title ?? 'Navet',
  })
  playback = { ...playback, state: 'playing', updatedAt: new Date().toISOString() }
  playbackStartedAt = Date.now()
  const output = activeSession.stream.start()
  output.pipe(res)
  req.on('close', () => {
    if (!res.writableEnded) activeSession?.stream.stop()
  })
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
    const route = url.pathname.replace(/^\/__navet_music_engine__/, '') || '/'
    if (req.method === 'GET' && route === '/status') {
      const spotifyStatus = getSpotifyAudioSessionStatus(spotifyPaths.sessionPath)
      json(res, 200, {
        state: 'ready',
        version: '0.1.0',
        lanStreamBaseUrl: streamBaseUrl,
        spotifyAudioAvailable: spotifyStatus.available,
        localTranscodingAvailable: audioRuntimeStatus.available,
        reason: spotifyStatus.reason,
        protocols: ['sonos'],
      })
      return
    }
    if (req.method === 'GET' && route === '/targets') {
      json(res, 200, (await refreshPlayers(url.searchParams.has('refresh'))).map(publicPlayer))
      return
    }
    if (req.method === 'POST' && route === '/play') {
      json(res, 200, await beginPlayback(await readJson(req)))
      return
    }
    if (req.method === 'POST' && route === '/group') {
      const body = await readJson(req)
      await refreshPlayers(true)
      const coordinator = findPlayer(body.coordinatorId)
      const memberIds = Array.isArray(body.memberIds) ? body.memberIds : []
      const members = memberIds.map(findPlayer)
      await groupSonosPlayers(coordinator, members)
      json(res, 200, (await refreshPlayers(true)).map(publicPlayer))
      return
    }
    if (req.method === 'POST' && route === '/ungroup') {
      const body = await readJson(req)
      await refreshPlayers(true)
      await ungroupSonosPlayer(findPlayer(body.targetId))
      json(res, 200, (await refreshPlayers(true)).map(publicPlayer))
      return
    }
    if (req.method === 'POST' && route === '/control') {
      const body = await readJson(req)
      await refreshPlayers()
      const player = findPlayer(body.targetId)
      if (body.command?.type === 'next' || body.command?.type === 'previous') {
        const delta = body.command.type === 'next' ? 1 : -1
        const nextIndex = (queue.currentIndex ?? 0) + delta
        if (playbackMode === 'sonos_spotify') {
          await controlSonos(player, body.command)
          if (queue.items[nextIndex]) {
            queue = { ...queue, currentIndex: nextIndex, revision: String(Date.now()) }
            playback = { ...playback, currentItem: queue.items[nextIndex] }
            accumulatedPositionMs = 0
            playbackStartedAt = Date.now()
          }
        } else if (queue.items[nextIndex]) {
          await playQueueIndex(player, nextIndex)
        }
      } else if (body.command?.type === 'seek') {
        const index = queue.currentIndex
        if (index === null) throw new Error('Nothing is playing')
        if (playbackMode === 'sonos_spotify') {
          await controlSonos(player, body.command)
          accumulatedPositionMs = body.command.positionMs
          playbackStartedAt = Date.now()
        } else {
          await playQueueIndex(player, index, body.command.positionMs)
        }
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
      json(res, 200, currentPlayback())
      return
    }
    if (req.method === 'GET' && route === '/queue') {
      json(res, 200, queue)
      return
    }
    const streamMatch = route.match(/^\/stream\/([0-9a-f-]+)\.mp3$/i)
    if (req.method === 'GET' && streamMatch) {
      await handleStream(req, res, streamMatch[1])
      return
    }
    json(res, 404, { error: 'Music engine route not found' })
  } catch (error) {
    json(res, 502, { error: error instanceof Error ? error.message : 'Music engine failed' })
  }
})

server.listen(port, host, () => {
  process.stdout.write(`Navet music engine listening on ${host}:${port}\n`)
})

const shutdown = () => {
  stopActiveSession()
  server.close(() => process.exit(0))
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
