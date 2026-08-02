# Music

Navet's Music section is a provider-neutral control hub for streaming catalogs and household
playback targets. People authorize their own streaming account in Navet; provider credentials stay
separate from smart-home provider sessions and separate between browsers.

## Supported Sources

| Source | Search and library | Playback |
|---|---|---|
| Spotify | search; liked songs; private playlists; saved albums; recently played; top artists; album, playlist, and artist details; save/remove; queue | this Navet browser through Spotify's Web Playback SDK, Spotify Connect devices, and compatible Sonos households |
| Apple Music | catalog and library search; library songs, albums, playlists, and artists; recently played; personalized recommendations; album, playlist, and artist details; save catalog songs, albums, and playlists; queue | this Navet browser through MusicKit, including volume, shuffle, and repeat |
| SoundCloud | track, playlist, and artist search; liked tracks and playlists; followed artists; personal playlists; recently played; playlist and artist details; like/unlike; follow/unfollow; queue | this Navet browser through the official SoundCloud widget |
| YouTube Music | music-video and playlist search; liked videos; account playlists; playlist details; like/unlike; queue | this Navet browser through the official YouTube IFrame player |

Spotify browser playback requires Spotify Premium and a browser supported by Spotify's Web
Playback SDK. Spotify playback control otherwise requires the account and target capabilities
exposed by Spotify. Apple
Music requires subscriber authorization for full playback; otherwise MusicKit may expose
preview-only behavior. YouTube Music uses Google's public YouTube account/catalog surfaces because
Google does not publish a separate YouTube Music API. Navet does not extract, proxy, or transcode
protected provider audio.

Queue actions follow each provider and output's real capabilities. Spotify exposes **Play next**
because its Web API inserts at the next position. Apple Music, the SoundCloud and YouTube browser
players, compatible smart-home media players, and Navet's Sonos engine can separately expose
**Play next** and **Add to end of queue**. Navet sends the same explicit position to the playback
target so its displayed queue stays in the same order as the speaker queue.

## Configuration

Music account connections are always provider-authorized: select **Connect** or **Authenticate** and
the listener signs in with Spotify, Apple, SoundCloud, or Google. Navet never asks for a listener's
provider password, access token, or refresh token.

Each self-hosted Navet installation also needs a provider application identity. Open **Music ->
Manage services**, choose a service under **Set up services**, and enter that installation-level
configuration once. The setup form is separate from the account connection action:

- Spotify needs only the application's public Client ID because its OAuth flow uses PKCE.
- SoundCloud and YouTube need the application's Client ID and client secret. The secret is submitted
  to the same Navet origin, stored server-side, and never returned to the browser.
- Apple Music needs a signed MusicKit developer token. Navet never accepts or stores the Apple
  private key in this UI. Generate the signed token outside Navet, or use Navet's hosted token
  service when it is available for the deployment.

Standalone and add-on deployments persist UI-entered application configuration in
`/data/navet-music-config.json` with owner-only permissions. Configuration status responses contain
only booleans, source labels, redirect URIs, and a four-character Client ID hint; secrets and signed
tokens are write-only. After setup, every household listener still uses the provider's OAuth or
MusicKit consent screen to create an isolated browser session.

- Register `https://navet.app/redirect/oauth` in the Spotify app. This hosted relay remembers the
  local Navet callback only in the current browser tab, sends the browser to Spotify, and returns
  the authorization response to the self-hosted instance. The Navet instance itself can remain on
  plain HTTP.
- A custom direct callback remains available for advanced deployments. Spotify requires HTTPS for
  every non-loopback callback. Plain HTTP is supported only with the explicit `127.0.0.1` or
  `[::1]` loopback address; `localhost` and LAN IP addresses are rejected.
- SoundCloud and YouTube use the same hosted callback relay. Register
  `https://navet.app/redirect/oauth` in each provider application. SoundCloud requires OAuth 2.1
  with PKCE; Google uses offline authorization so Navet can refresh the browser's session.
- Apple Music uses **Authenticate** to open MusicKit's Apple Account consent flow. MusicKit manages
  the subscriber's Music User Token in the current browser, matching Apple's supported web-app
  authorization model.
- In a managed deployment, Navet's hosted token service can supply the application-level developer
  token. Its Apple private key remains in the hosted deployment and is never shipped to self-hosted
  instances or browsers.
- Mount `/data` persistently so browser-scoped music sessions survive restarts. Refresh tokens are
  stored server-side with owner-only file permissions; the browser normally receives only an
  opaque, HttpOnly session cookie. Spotify's official browser player additionally receives a
  short-lived access token in memory when it asks Navet for one. That token is never persisted by
  the UI, and the refresh token remains server-side.

The Navet UI is the normal self-hosted setup path. Deployment environment variables and Home
Assistant add-on options remain available for managed or immutable installations; a stored UI value
takes precedence over the matching environment value:

```text
NAVET_SPOTIFY_CLIENT_ID=
NAVET_SPOTIFY_REDIRECT_URI=https://navet.app/redirect/oauth
NAVET_APPLE_MUSIC_DEVELOPER_TOKEN=
NAVET_APPLE_MUSIC_DEVELOPER_TOKEN_URL=
NAVET_SOUNDCLOUD_CLIENT_ID=
NAVET_SOUNDCLOUD_CLIENT_SECRET=
NAVET_SOUNDCLOUD_REDIRECT_URI=https://navet.app/redirect/oauth
NAVET_YOUTUBE_CLIENT_ID=
NAVET_YOUTUBE_CLIENT_SECRET=
NAVET_YOUTUBE_REDIRECT_URI=https://navet.app/redirect/oauth
NAVET_SONOS_HOSTS=
```

- `NAVET_SPOTIFY_CLIENT_ID` is the installation's public Spotify application identifier. Spotify
  uses PKCE, so Navet does not require or store a Spotify client secret.
- `NAVET_APPLE_MUSIC_DEVELOPER_TOKEN` is a signed application developer token, not an Apple Music
  subscriber token. It can also be entered in Navet's protected setup UI.
- `NAVET_APPLE_MUSIC_DEVELOPER_TOKEN_URL` optionally replaces Navet's hosted developer-token
  endpoint.
- `NAVET_SOUNDCLOUD_CLIENT_ID` and `NAVET_SOUNDCLOUD_CLIENT_SECRET` are the installation's
  SoundCloud application credentials. SoundCloud currently treats API clients as confidential and
  requires both values for user authorization.
- `NAVET_YOUTUBE_CLIENT_ID` and `NAVET_YOUTUBE_CLIENT_SECRET` are OAuth web-application
  credentials from a Google Cloud project with YouTube Data API v3 enabled.
- `NAVET_SONOS_HOSTS` accepts comma-separated Sonos IP addresses when Docker bridge networking
  blocks SSDP multicast, for example `192.168.1.31,192.168.1.32`.

## Spotify and Sonos

The native engine is part of Navet and does not call Home Assistant or Music Assistant:

1. Navet discovers Sonos players directly using SSDP/UPnP.
2. Navet sends the official Spotify item URI to a compatible Sonos household and keeps grouping,
   queue, and transport state in the music engine.
3. If Spotify is not linked to that Sonos household, Navet explains the requirement and the user
   can choose one of the Spotify Connect targets returned by Spotify instead.

Navet never shares the browser's Spotify access token with the speaker. Run `pnpm dev` to start
the dashboard and music engine together during local development.

The Home Assistant add-on also exposes deployment-managed client, secret, and redirect fields for
Spotify, SoundCloud, and YouTube. UI-entered server-side configuration takes precedence when
present. The hosted relay and Apple Music's MusicKit authorization both work through Ingress
without HTTPS on the add-on itself.

## Boundaries

- Music accounts are not smart-home integration providers and do not change the active Home
  Assistant, Homey, or openHAB session.
- Spotify can play on this Navet display through Spotify's official Web Playback SDK for eligible
  Premium accounts. Browsers without the required encrypted-media support continue to expose
  Spotify Connect and compatible household speakers.
- A queue belongs to one music source. Switching providers replaces the active listening session
  after confirmation.
- Apple Music does not hand protected streams to arbitrary smart-home speakers. External targets
  remain hidden unless a future adapter can prove compatible playback.
- YouTube Music history, mixes, and proprietary recommendations are not exposed by a public Google
  API. Navet exposes music search, liked videos, and ordinary YouTube playlists through YouTube
  Data API v3 and uses the official embedded player.
- SoundCloud playback remains inside its official widget. It cannot be grouped onto arbitrary
  smart-home speakers unless SoundCloud exposes a compatible target or stream contract for that
  device.
- Custom-panel authentication is not supported in the first release; use standalone or the Home
  Assistant add-on/Ingress surface.
