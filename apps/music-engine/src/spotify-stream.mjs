import { execFile, spawn } from 'node:child_process'
import { mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

function readSpotifySession(sessionPath) {
  try {
    const session = JSON.parse(readFileSync(sessionPath, 'utf8'))
    return typeof session.accessToken === 'string' ? session : null
  } catch {
    return null
  }
}

export function getSpotifyAudioSessionStatus(sessionPath) {
  const session = readSpotifySession(sessionPath)
  if (!session) return { available: false, reason: 'Connect Spotify in Navet first' }
  const scopes = typeof session.scope === 'string' ? session.scope.split(/\s+/) : []
  if (!scopes.includes('streaming')) {
    return {
      available: false,
      reason: 'Reconnect Spotify once to authorize native audio streaming',
    }
  }
  return { available: true }
}

export async function ensureSpotifyAudioCredentials({ sessionPath, cachePath, librespotPath }) {
  const status = getSpotifyAudioSessionStatus(sessionPath)
  if (!status.available) throw new Error(status.reason)
  const session = readSpotifySession(sessionPath)
  mkdirSync(cachePath, { recursive: true })
  try {
    await execFileAsync(librespotPath, ['--cache', cachePath, '--check-auth'])
  } catch {
    await execFileAsync(librespotPath, [
      '--cache',
      cachePath,
      '--check-auth',
      '--access-token',
      session.accessToken,
    ])
  }
}

export class SpotifyStreamSession {
  constructor({
    uri,
    cachePath,
    sessionPath,
    librespotPath = 'librespot',
    ffmpegPath = 'ffmpeg',
    startPositionMs = 0,
    onEnded,
  }) {
    this.uri = uri
    this.cachePath = cachePath
    this.sessionPath = sessionPath
    this.librespotPath = librespotPath
    this.ffmpegPath = ffmpegPath
    this.startPositionMs = startPositionMs
    this.output = new PassThrough()
    this.started = false
    this.processes = []
    this.onEnded = onEnded
    this.stopping = false
  }

  start() {
    if (this.started) return this.output
    this.started = true
    mkdirSync(this.cachePath, { recursive: true })
    const status = getSpotifyAudioSessionStatus(this.sessionPath)
    if (!status.available) {
      this.output.destroy(new Error(status.reason))
      return this.output
    }
    const args = [
      '--cache',
      this.cachePath,
      '--disable-audio-cache',
      '--passthrough',
      '--bitrate',
      '320',
      '--backend',
      'pipe',
      '--single-track',
      this.uri.replace(/^spotify:/, 'spotify://'),
      '--disable-discovery',
      '--dither',
      'none',
    ]
    if (this.startPositionMs > 0) {
      args.push('--start-position', String(Math.floor(this.startPositionMs / 1000)))
    }

    const librespot = spawn(this.librespotPath, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    const ffmpeg = spawn(
      this.ffmpegPath,
      ['-hide_banner', '-loglevel', 'warning', '-i', 'pipe:0', '-vn', '-codec:a', 'libmp3lame', '-b:a', '320k', '-f', 'mp3', 'pipe:1'],
      { stdio: ['pipe', 'pipe', 'pipe'] }
    )
    this.processes = [librespot, ffmpeg]
    librespot.stdout.pipe(ffmpeg.stdin)
    ffmpeg.stdout.pipe(this.output)

    const fail = (label) => (error) => this.output.destroy(new Error(`${label}: ${error.message}`))
    librespot.on('error', fail('Unable to start librespot'))
    ffmpeg.on('error', fail('Unable to start ffmpeg'))
    librespot.stderr.on('data', (chunk) => process.stderr.write(`[librespot] ${chunk}`))
    ffmpeg.stderr.on('data', (chunk) => process.stderr.write(`[ffmpeg] ${chunk}`))
    librespot.on('close', (code) => {
      if (code && !this.output.destroyed) this.output.destroy(new Error(`librespot exited (${code})`))
    })
    ffmpeg.on('close', (code) => {
      if (!this.stopping && code === 0) this.onEnded?.()
    })
    return this.output
  }

  stop() {
    this.stopping = true
    for (const process of this.processes) process.kill('SIGTERM')
    this.processes = []
    this.output.destroy()
  }
}

export function defaultSpotifyPaths(dataPath) {
  return {
    cachePath: path.join(dataPath, 'spotify-librespot'),
    sessionPath: path.join(dataPath, 'navet-music-spotify-session.json'),
  }
}
