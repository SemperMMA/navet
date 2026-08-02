import assert from 'node:assert/strict'
import test from 'node:test'
import {
  controlSonos,
  discoverSonosPlayers,
  enqueueSonosSpotifyUri,
  getSonosPlaybackState,
  groupSonosPlayers,
  isSafeSonosLocation,
  parseSonosGroups,
  parseSonosDescription,
  playSonosStream,
  playSonosSpotifyUri,
  ungroupSonosPlayer,
} from './sonos.mjs'

test('parses Sonos group topology', () => {
  const groups = parseSonosGroups(
    '<ZoneGroupState>&lt;ZoneGroups&gt;&lt;ZoneGroup Coordinator="RINCON_A" ID="RINCON_A:1"&gt;&lt;ZoneGroupMember UUID="RINCON_A" /&gt;&lt;ZoneGroupMember UUID="RINCON_B" /&gt;&lt;/ZoneGroup&gt;&lt;/ZoneGroups&gt;</ZoneGroupState>'
  )
  assert.deepEqual(groups, [
    { id: 'RINCON_A:1', coordinatorId: 'RINCON_A', memberIds: ['RINCON_A', 'RINCON_B'] },
  ])
})

test('parses a Sonos device description and AVTransport endpoint', () => {
  const player = parseSonosDescription(
    'http://192.168.1.20:1400/xml/device_description.xml',
    `<?xml version="1.0"?><root><device><roomName>Bathroom</roomName><friendlyName>Bathroom</friendlyName><modelName>Sonos One</modelName><UDN>uuid:RINCON_123</UDN><serviceList><service><serviceType>urn:schemas-upnp-org:service:AVTransport:1</serviceType><controlURL>/MediaRenderer/AVTransport/Control</controlURL></service><service><serviceType>urn:schemas-upnp-org:service:RenderingControl:1</serviceType><controlURL>/MediaRenderer/RenderingControl/Control</controlURL></service></serviceList></device></root>`
  )
  assert.deepEqual(player, {
    id: 'RINCON_123',
    name: 'Bathroom',
    protocol: 'sonos',
    available: true,
    model: 'Sonos One',
    address: '192.168.1.20',
    location: 'http://192.168.1.20:1400/xml/device_description.xml',
    controlUrl: 'http://192.168.1.20:1400/MediaRenderer/AVTransport/Control',
    renderingControlUrl: 'http://192.168.1.20:1400/MediaRenderer/RenderingControl/Control',
  })
})

test('rejects public discovery locations and cross-origin control endpoints', () => {
  assert.equal(isSafeSonosLocation('http://192.168.1.20:1400/xml/device_description.xml'), true)
  assert.equal(isSafeSonosLocation('http://speaker.local:1400/xml/device_description.xml'), true)
  assert.equal(isSafeSonosLocation('https://192.168.1.20:1400/xml/device_description.xml'), false)
  assert.equal(isSafeSonosLocation('http://example.com:1400/xml/device_description.xml'), false)
  assert.equal(isSafeSonosLocation('http://speaker:1400/xml/device_description.xml'), false)
  assert.equal(isSafeSonosLocation('http://localhost:1400/xml/device_description.xml'), false)
  assert.equal(
    parseSonosDescription(
      'http://192.168.1.20:1400/xml/device_description.xml',
      `<root><device><roomName>Bathroom</roomName><UDN>uuid:RINCON_123</UDN><serviceList><service><serviceType>urn:schemas-upnp-org:service:AVTransport:1</serviceType><controlURL>http://example.com/av</controlURL></service><service><serviceType>urn:schemas-upnp-org:service:RenderingControl:1</serviceType><controlURL>/render</controlURL></service></serviceList></device></root>`
    ),
    null
  )
})

test('queues a Spotify URI through the Sonos-linked Spotify service', async () => {
  const calls = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init })
    const action = init.headers.SOAPACTION
    return new Response(
      action.includes('#AddURIToQueue')
        ? '<FirstTrackNumberEnqueued>7</FirstTrackNumberEnqueued>'
        : '',
      { status: 200 }
    )
  }
  try {
    await playSonosSpotifyUri(
      { id: 'RINCON_123', controlUrl: 'http://sonos.test/av' },
      'spotify:track:3sWDTwh4Hl5eHxwLijzAK6',
      'Angel Of Death'
    )
  } finally {
    globalThis.fetch = originalFetch
  }
  assert.equal(calls.length, 5)
  assert.match(calls[0].init.headers.SOAPACTION, /#RemoveAllTracksFromQueue/)
  assert.match(calls[1].init.headers.SOAPACTION, /#AddURIToQueue/)
  assert.match(calls[1].init.body, /spotify%3atrack%3a3sWDTwh4Hl5eHxwLijzAK6/)
  assert.match(calls[1].init.body, /x-sonos-spotify:/)
  assert.match(calls[1].init.body, /sid=9&amp;flags=8224&amp;sn=7/)
  assert.match(calls[1].init.body, /SA_RINCON2311_X_#Svc2311-0-Token/)
  assert.match(calls[2].init.body, /x-rincon-queue:RINCON_123#0/)
  assert.match(calls[3].init.body, /<Target>7<\/Target>/)
  assert.match(calls[4].init.headers.SOAPACTION, /#Play/)
})

test('distinguishes play-next from add-to-end in the Sonos queue request', async () => {
  const calls = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (_url, init) => {
    calls.push(init)
    return new Response('<FirstTrackNumberEnqueued>2</FirstTrackNumberEnqueued>', { status: 200 })
  }
  try {
    const player = { id: 'RINCON_123', controlUrl: 'http://sonos.test/av' }
    await enqueueSonosSpotifyUri(player, 'spotify:track:next', 'Next', { position: 'next' })
    await enqueueSonosSpotifyUri(player, 'spotify:track:later', 'Later', { position: 'later' })
  } finally {
    globalThis.fetch = originalFetch
  }
  assert.equal(calls.length, 2)
  assert.match(calls[0].body, /<EnqueueAsNext>1<\/EnqueueAsNext>/)
  assert.match(calls[1].body, /<EnqueueAsNext>0<\/EnqueueAsNext>/)
})

test('probes configured Sonos hosts when multicast discovery is unavailable', async () => {
  const requested = []
  const players = await discoverSonosPlayers({
    timeoutMs: 1,
    configuredHosts: ['192.168.1.20'],
    useMulticast: false,
    fetchImpl: async (url) => {
      requested.push(url)
      return new Response(
        `<root><device><roomName>Bathroom</roomName><modelName>Sonos One</modelName><UDN>uuid:RINCON_123</UDN><serviceList><service><serviceType>urn:schemas-upnp-org:service:AVTransport:1</serviceType><controlURL>/av</controlURL></service><service><serviceType>urn:schemas-upnp-org:service:RenderingControl:1</serviceType><controlURL>/render</controlURL></service></serviceList></device></root>`
      )
    },
  })
  assert.deepEqual(requested, ['http://192.168.1.20:1400/xml/device_description.xml'])
  assert.equal(players[0].name, 'Bathroom')
})

test('hands a Navet stream to Sonos and starts AVTransport playback', async () => {
  const calls = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init })
    return new Response('', { status: 200 })
  }
  try {
    const player = { controlUrl: 'http://sonos.test/av', renderingControlUrl: 'http://sonos.test/render' }
    await playSonosStream(
      player,
      'http://navet.local/stream/id.mp3?first=1&second=<unsafe>',
      '<meta title="Navet">music & more</meta>'
    )
    await controlSonos(player, { type: 'set_volume', volume: 0.42 })
    await controlSonos(player, { type: 'set_play_mode', shuffle: true, repeat: 'all' })
  } finally {
    globalThis.fetch = originalFetch
  }
  assert.equal(calls.length, 4)
  assert.match(
    calls[0].init.body,
    /<CurrentURI>http:\/\/navet\.local\/stream\/id\.mp3\?first=1&amp;second=&lt;unsafe&gt;<\/CurrentURI>/
  )
  assert.match(
    calls[0].init.body,
    /<CurrentURIMetaData>&lt;meta title=&quot;Navet&quot;&gt;music &amp; more&lt;\/meta&gt;<\/CurrentURIMetaData>/
  )
  assert.match(calls[1].init.headers.SOAPACTION, /#Play/)
  assert.match(calls[2].init.body, /<DesiredVolume>42<\/DesiredVolume>/)
  assert.match(calls[3].init.body, /<NewPlayMode>SHUFFLE<\/NewPlayMode>/)
})

test('reconciles Sonos transport and position state', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (_url, init) =>
    new Response(
      init.headers.SOAPACTION.includes('#GetTransportInfo')
        ? '<CurrentTransportState>PAUSED_PLAYBACK</CurrentTransportState>'
        : '<Track>2</Track><TrackDuration>00:03:10</TrackDuration><RelTime>00:01:05</RelTime>',
      { status: 200 }
    )
  try {
    const state = await getSonosPlaybackState({ controlUrl: 'http://sonos.test/av' })
    assert.deepEqual(state, {
      state: 'paused',
      positionMs: 65_000,
      durationMs: 190_000,
      trackNumber: 2,
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('groups and ungroups Sonos speakers through AVTransport', async () => {
  const calls = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init })
    return new Response('', { status: 200 })
  }
  try {
    const coordinator = { id: 'RINCON_A', controlUrl: 'http://a.test/av' }
    const member = { id: 'RINCON_B', controlUrl: 'http://b.test/av' }
    await groupSonosPlayers(coordinator, [coordinator, member])
    await ungroupSonosPlayer(member)
  } finally {
    globalThis.fetch = originalFetch
  }
  assert.equal(calls.length, 2)
  assert.match(calls[0].init.body, /<CurrentURI>x-rincon:RINCON_A<\/CurrentURI>/)
  assert.match(calls[1].init.headers.SOAPACTION, /#BecomeCoordinatorOfStandaloneGroup/)
})
