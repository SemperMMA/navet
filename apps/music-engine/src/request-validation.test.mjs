import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MusicEngineInputError,
  parseControlRequest,
  parseGroupRequest,
  parsePlayRequest,
} from './request-validation.mjs'

const validItem = {
  id: 'track-id',
  sourceId: 'spotify',
  type: 'track',
  title: 'Northbound',
  artists: ['Lumen'],
  uri: 'spotify:track:3sWDTwh4Hl5eHxwLijzAK6',
  durationMs: 180_000,
  artworkUrl: 'https://i.scdn.co/image/example',
}

test('normalizes a valid Spotify play request', () => {
  assert.deepEqual(
    parsePlayRequest({ targetId: 'RINCON_123', item: validItem, queueMode: 'replace' }),
    { targetId: 'RINCON_123', item: validItem, queueMode: 'replace' }
  )
})

test('rejects malformed and mismatched Spotify play requests', () => {
  assert.throws(
    () => parsePlayRequest({ targetId: 'RINCON_123', item: validItem, queueMode: 'later' }),
    MusicEngineInputError
  )
  assert.throws(
    () =>
      parsePlayRequest({
        targetId: 'RINCON_123',
        item: { ...validItem, uri: 'spotify:album:3sWDTwh4Hl5eHxwLijzAK6' },
        queueMode: 'replace',
      }),
    /does not match/
  )
  assert.throws(
    () =>
      parsePlayRequest({
        targetId: 'RINCON_123',
        item: { ...validItem, artworkUrl: 'javascript:alert(1)' },
        queueMode: 'replace',
      }),
    /Artwork URL/
  )
})

test('validates transport command values', () => {
  assert.deepEqual(parseControlRequest({ targetId: 'RINCON_123', command: { type: 'play' } }), {
    targetId: 'RINCON_123',
    command: { type: 'play' },
  })
  assert.throws(
    () => parseControlRequest({ targetId: 'RINCON_123', command: { type: 'set_volume', volume: 2 } }),
    /Volume/
  )
  assert.throws(
    () => parseControlRequest({ targetId: 'RINCON_123', command: { type: 'shell', value: 'id' } }),
    /not supported/
  )
})

test('bounds and deduplicates group members', () => {
  assert.deepEqual(
    parseGroupRequest({ coordinatorId: 'RINCON_A', memberIds: ['RINCON_A', 'RINCON_B', 'RINCON_B'] }),
    { coordinatorId: 'RINCON_A', memberIds: ['RINCON_A', 'RINCON_B'] }
  )
  assert.throws(
    () => parseGroupRequest({ coordinatorId: 'RINCON_A', memberIds: Array(65).fill('RINCON_B') }),
    /Group members/
  )
})
