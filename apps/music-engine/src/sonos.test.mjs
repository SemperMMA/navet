import assert from 'node:assert/strict'
import test from 'node:test'
import {
  controlSonos,
  discoverSonosPlayers,
  groupSonosPlayers,
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
    await playSonosStream(player, 'http://navet.local/stream/id.mp3')
    await controlSonos(player, { type: 'set_volume', volume: 0.42 })
    await controlSonos(player, { type: 'set_play_mode', shuffle: true, repeat: 'all' })
  } finally {
    globalThis.fetch = originalFetch
  }
  assert.equal(calls.length, 4)
  assert.match(calls[0].init.body, /<CurrentURI>http:\/\/navet\.local\/stream\/id\.mp3<\/CurrentURI>/)
  assert.match(calls[1].init.headers.SOAPACTION, /#Play/)
  assert.match(calls[2].init.body, /<DesiredVolume>42<\/DesiredVolume>/)
  assert.match(calls[3].init.body, /<NewPlayMode>SHUFFLE<\/NewPlayMode>/)
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
