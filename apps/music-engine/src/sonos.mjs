import dgram from 'node:dgram'

const SSDP_ADDRESS = '239.255.255.250'
const SSDP_PORT = 1900
const SONOS_SEARCH_TARGET = 'urn:schemas-upnp-org:device:ZonePlayer:1'

function xmlValue(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'))
  return match?.[1]?.replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>')
}

function resolveControlUrl(location, xml, serviceName) {
  const services = xml.match(/<service>[\s\S]*?<\/service>/gi) ?? []
  const service = services.find((entry) =>
    entry.includes(`urn:schemas-upnp-org:service:${serviceName}:1`)
  )
  const controlUrl = service ? xmlValue(service, 'controlURL') : undefined
  return controlUrl ? new URL(controlUrl, location).toString() : undefined
}

export function parseSonosDescription(location, xml) {
  const id = xmlValue(xml, 'UDN')?.replace(/^uuid:/, '')
  const name = xmlValue(xml, 'roomName') ?? xmlValue(xml, 'friendlyName')
  const controlUrl = resolveControlUrl(location, xml, 'AVTransport')
  const renderingControlUrl = resolveControlUrl(location, xml, 'RenderingControl')
  const zoneGroupTopologyUrl = resolveControlUrl(location, xml, 'ZoneGroupTopology')
  if (!id || !name || !controlUrl || !renderingControlUrl) return null
  return {
    id,
    name,
    protocol: 'sonos',
    available: true,
    model: xmlValue(xml, 'modelName'),
    address: new URL(location).hostname,
    location,
    controlUrl,
    renderingControlUrl,
    ...(zoneGroupTopologyUrl ? { zoneGroupTopologyUrl } : {}),
  }
}

export async function discoverSonosPlayers({
  timeoutMs = 1600,
  fetchImpl = fetch,
  configuredHosts = [],
  useMulticast = true,
} = {}) {
  const locations = new Set(
    configuredHosts.map((host) => `http://${host}:1400/xml/device_description.xml`)
  )
  const socket = useMulticast ? dgram.createSocket({ type: 'udp4', reuseAddr: true }) : null
  const request = [
    'M-SEARCH * HTTP/1.1',
    `HOST: ${SSDP_ADDRESS}:${SSDP_PORT}`,
    'MAN: "ssdp:discover"',
    'MX: 1',
    `ST: ${SONOS_SEARCH_TARGET}`,
    '',
    '',
  ].join('\r\n')

  if (socket) await new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, timeoutMs)
    socket.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    socket.on('message', (message) => {
      const location = message.toString().match(/^location:\s*(.+)$/im)?.[1]?.trim()
      if (location) locations.add(location)
    })
    socket.bind(0, () => {
      socket.send(request, SSDP_PORT, SSDP_ADDRESS)
    })
  }).finally(() => socket.close())

  const descriptions = await Promise.allSettled(
    [...locations].map(async (location) => {
      const response = await fetchImpl(location, { signal: AbortSignal.timeout(2500) })
      if (!response.ok) return null
      return parseSonosDescription(location, await response.text())
    })
  )
  return descriptions.flatMap((result) =>
    result.status === 'fulfilled' && result.value ? [result.value] : []
  )
}

function soapEnvelope(action, body = '') {
  return `<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:${action} xmlns:u="urn:schemas-upnp-org:service:AVTransport:1"><InstanceID>0</InstanceID>${body}</u:${action}></s:Body></s:Envelope>`
}

async function sonosAction(player, action, body) {
  const response = await fetch(player.controlUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset="utf-8"',
      SOAPACTION: `"urn:schemas-upnp-org:service:AVTransport:1#${action}"`,
    },
    body: soapEnvelope(action, body),
    signal: AbortSignal.timeout(5000),
  })
  if (!response.ok) {
    const fault = await response.text()
    const errorCode = fault.match(/<errorCode>([^<]+)<\/errorCode>/i)?.[1]
    const errorDescription = fault.match(/<errorDescription>([^<]+)<\/errorDescription>/i)?.[1]
    const detail = [errorCode, errorDescription].filter(Boolean).join(' ')
    throw new Error(`Sonos ${action} failed (${response.status})${detail ? `: ${detail}` : ''}`)
  }
  return await response.text()
}

function decodeXml(value) {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')
}

export function parseSonosGroups(xml) {
  const state = decodeXml(xmlValue(xml, 'ZoneGroupState') ?? xml)
  const groups = []
  for (const match of state.matchAll(/<ZoneGroup\b([^>]*)>([\s\S]*?)<\/ZoneGroup>/gi)) {
    const attributes = match[1]
    const coordinatorId = attributes.match(/\bCoordinator="([^"]+)"/i)?.[1]
    const id = attributes.match(/\bID="([^"]+)"/i)?.[1]
    const memberIds = [...match[2].matchAll(/<(?:ZoneGroupMember|Satellite)\b[^>]*\bUUID="([^"]+)"/gi)]
      .map((member) => member[1])
    if (id && coordinatorId && memberIds.length) groups.push({ id, coordinatorId, memberIds })
  }
  return groups
}

export async function getSonosGroups(players) {
  const topologyUrl = players.find((player) => player.zoneGroupTopologyUrl)?.zoneGroupTopologyUrl
  if (!topologyUrl) return []
  const action = 'GetZoneGroupState'
  const response = await fetch(topologyUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset="utf-8"',
      SOAPACTION: `"urn:schemas-upnp-org:service:ZoneGroupTopology:1#${action}"`,
    },
    body: `<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><u:${action} xmlns:u="urn:schemas-upnp-org:service:ZoneGroupTopology:1"></u:${action}></s:Body></s:Envelope>`,
    signal: AbortSignal.timeout(5000),
  })
  if (!response.ok) throw new Error(`Sonos topology failed (${response.status})`)
  return parseSonosGroups(await response.text())
}

export async function groupSonosPlayers(coordinator, members) {
  if (coordinator.groupCoordinatorId && coordinator.groupCoordinatorId !== coordinator.id) {
    await ungroupSonosPlayer(coordinator)
  }
  for (const member of members) {
    if (member.id === coordinator.id) continue
    await sonosAction(
      member,
      'SetAVTransportURI',
      `<CurrentURI>${xmlEscape(`x-rincon:${coordinator.id}`)}</CurrentURI><CurrentURIMetaData></CurrentURIMetaData>`
    )
  }
}

export async function ungroupSonosPlayer(player) {
  await sonosAction(player, 'BecomeCoordinatorOfStandaloneGroup')
}

function xmlEscape(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function spotifyQueueItem(uri, title, serviceNumber, serialNumber = 7) {
  const match = uri.match(/^spotify:(album|episode|playlist|show|track):([a-zA-Z0-9]+)$/)
  if (!match) throw new Error('This Spotify item cannot be sent to Sonos')
  const type = match[1]
  const encodedUri = uri.replaceAll(':', '%3a')
  const isContainer = type === 'album' || type === 'playlist' || type === 'show'
  const key = isContainer ? (type === 'album' ? '00040000' : '1006206c') : '00032020'
  const itemClass =
    type === 'album'
      ? 'object.container.album.musicAlbum'
      : isContainer
        ? 'object.container.playlistContainer'
        : 'object.item.audioItem.musicTrack'
  const prefix = isContainer
    ? type === 'album'
      ? 'x-rincon-cpcontainer:1004206c'
      : 'x-rincon-cpcontainer:1006206c'
    : ''
  const serviceQuery =
    serviceNumber === 2311
      ? `?sid=9&flags=${isContainer ? 8300 : 8224}&sn=${serialNumber}`
      : `?sid=12&flags=${isContainer ? 8300 : 32}`
  const sonosUri = isContainer
    ? `${prefix}${encodedUri}${serviceQuery}`
    : `x-sonos-spotify:${encodedUri}${serviceQuery}`
  const metadata = `<DIDL-Lite xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:upnp="urn:schemas-upnp-org:metadata-1-0/upnp/" xmlns:r="urn:schemas-rinconnetworks-com:metadata-1-0/" xmlns="urn:schemas-upnp-org:metadata-1-0/DIDL-Lite/"><item id="${key}${encodedUri}" parentID="-1" restricted="true"><dc:title>${xmlEscape(title)}</dc:title><upnp:class>${itemClass}</upnp:class><desc id="cdudn" nameSpace="urn:schemas-rinconnetworks-com:metadata-1-0/">SA_RINCON${serviceNumber}_X_#Svc${serviceNumber}-0-Token</desc></item></DIDL-Lite>`
  return { enqueueUri: sonosUri, metadata }
}

async function addSpotifyUriToSonosQueue(player, uri, title, serviceNumber, serialNumber) {
  const item = spotifyQueueItem(uri, title, serviceNumber, serialNumber)
  const response = await sonosAction(
    player,
    'AddURIToQueue',
    `<EnqueuedURI>${xmlEscape(item.enqueueUri)}</EnqueuedURI><EnqueuedURIMetaData>${xmlEscape(item.metadata)}</EnqueuedURIMetaData><DesiredFirstTrackNumberEnqueued>0</DesiredFirstTrackNumberEnqueued><EnqueueAsNext>1</EnqueueAsNext>`
  )
  const queueNumber = Number.parseInt(
    response.match(/<FirstTrackNumberEnqueued>(\d+)<\/FirstTrackNumberEnqueued>/i)?.[1] ?? '',
    10
  )
  if (!Number.isFinite(queueNumber)) throw new Error('Sonos did not return a queue position')
  return queueNumber
}

export async function enqueueSonosSpotifyUri(player, uri, title = '') {
  let failure
  for (const serviceNumber of [2311, 3079]) {
    try {
      return await addSpotifyUriToSonosQueue(player, uri, title, serviceNumber)
    } catch (error) {
      failure = error
    }
  }
  throw failure instanceof Error ? failure : new Error('Spotify is not linked in Sonos')
}

export async function clearSonosQueue(player) {
  await sonosAction(player, 'RemoveAllTracksFromQueue')
}

const spotifySerialByPlayer = new Map()

export async function playSonosSpotifyUri(player, uri, title = '') {
  let lastError
  // The account serial is assigned by the Sonos household and is not exposed by
  // its public UPnP services. Try the common serial first, then negotiate the
  // household's linked Spotify account without asking the user for Sonos secrets.
  const preferredSerial = spotifySerialByPlayer.get(player.id)
  const serialNumbers = [preferredSerial, 7, ...Array.from({ length: 15 }, (_, index) => index + 1)]
    .filter((value) => value !== undefined)
    .filter((value, index, values) => values.indexOf(value) === index)
  for (const serialNumber of serialNumbers) {
    try {
      await clearSonosQueue(player)
      const queueNumber = await addSpotifyUriToSonosQueue(player, uri, title, 2311, serialNumber)
      await sonosAction(
        player,
        'SetAVTransportURI',
        `<CurrentURI>${xmlEscape(`x-rincon-queue:${player.id}#0`)}</CurrentURI><CurrentURIMetaData></CurrentURIMetaData>`
      )
      await sonosAction(player, 'Seek', `<Unit>TRACK_NR</Unit><Target>${queueNumber}</Target>`)
      await sonosAction(player, 'Play', '<Speed>1</Speed>')
      spotifySerialByPlayer.set(player.id, serialNumber)
      return queueNumber
    } catch (error) {
      lastError = error
      if (!(error instanceof Error) || !error.message.endsWith(': 701')) throw error
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Spotify is not linked in this Sonos household')
}

async function renderingAction(player, action, body) {
  const response = await fetch(player.renderingControlUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset="utf-8"',
      SOAPACTION: `"urn:schemas-upnp-org:service:RenderingControl:1#${action}"`,
    },
    body: `<?xml version="1.0" encoding="utf-8"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:${action} xmlns:u="urn:schemas-upnp-org:service:RenderingControl:1"><InstanceID>0</InstanceID>${body}</u:${action}></s:Body></s:Envelope>`,
    signal: AbortSignal.timeout(5000),
  })
  if (!response.ok) throw new Error(`Sonos ${action} failed (${response.status})`)
}

export async function playSonosStream(player, streamUrl, metadata = '') {
  const escapedUrl = streamUrl.replaceAll('&', '&amp;')
  const escapedMetadata = metadata.replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  await sonosAction(
    player,
    'SetAVTransportURI',
    `<CurrentURI>${escapedUrl}</CurrentURI><CurrentURIMetaData>${escapedMetadata}</CurrentURIMetaData>`
  )
  await sonosAction(player, 'Play', '<Speed>1</Speed>')
}

export async function controlSonos(player, command) {
  if (command.type === 'play') return await sonosAction(player, 'Play', '<Speed>1</Speed>')
  if (command.type === 'pause') return await sonosAction(player, 'Pause')
  if (command.type === 'next') return await sonosAction(player, 'Next')
  if (command.type === 'previous') return await sonosAction(player, 'Previous')
  if (command.type === 'seek') {
    const seconds = Math.max(0, Math.floor(command.positionMs / 1000))
    const target = [Math.floor(seconds / 3600), Math.floor((seconds % 3600) / 60), seconds % 60]
      .map((value) => String(value).padStart(2, '0'))
      .join(':')
    return await sonosAction(player, 'Seek', `<Unit>REL_TIME</Unit><Target>${target}</Target>`)
  }
  if (command.type === 'set_volume') {
    const volume = Math.round(Math.max(0, Math.min(1, command.volume)) * 100)
    return await renderingAction(
      player,
      'SetVolume',
      `<Channel>Master</Channel><DesiredVolume>${volume}</DesiredVolume>`
    )
  }
  if (command.type === 'set_play_mode') {
    const playMode = command.shuffle
      ? command.repeat === 'all'
        ? 'SHUFFLE'
        : command.repeat === 'one'
          ? 'SHUFFLE_REPEAT_ONE'
          : 'SHUFFLE_NOREPEAT'
      : command.repeat === 'all'
        ? 'REPEAT_ALL'
        : command.repeat === 'one'
          ? 'REPEAT_ONE'
          : 'NORMAL'
    return await sonosAction(player, 'SetPlayMode', `<NewPlayMode>${playMode}</NewPlayMode>`)
  }
  throw new Error(`Sonos command ${command.type} is not supported by AVTransport`)
}
