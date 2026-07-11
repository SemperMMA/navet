import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { getSpotifyAudioSessionStatus } from './spotify-stream.mjs'

test('requires a persisted Spotify session with the streaming scope', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'navet-spotify-'))
  const sessionPath = path.join(directory, 'session.json')
  assert.deepEqual(getSpotifyAudioSessionStatus(sessionPath), {
    available: false,
    reason: 'Connect Spotify in Navet first',
  })
  writeFileSync(sessionPath, JSON.stringify({ accessToken: 'token', scope: 'user-read-private' }))
  assert.equal(getSpotifyAudioSessionStatus(sessionPath).available, false)
  writeFileSync(
    sessionPath,
    JSON.stringify({ accessToken: 'token', scope: 'user-read-private streaming' })
  )
  assert.deepEqual(getSpotifyAudioSessionStatus(sessionPath), { available: true })
})
