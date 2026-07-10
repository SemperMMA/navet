# Music

Navet's Music section is a provider-neutral control hub for streaming catalogs and household
playback targets. It does not download, transcode, or rebroadcast protected audio.

## Supported Sources

| Source | Search and library | Playback |
|---|---|---|
| Spotify | catalog search, saved tracks, queue | Spotify Connect devices and Navet media players that explicitly advertise Spotify playback |
| Apple Music | catalog search, recently played, queue | this Navet browser through MusicKit |

Spotify requires an eligible account for playback APIs. Apple Music requires subscriber
authorization for full playback; otherwise MusicKit may expose preview-only behavior.

## Configuration

Open **Music** and follow the action shown for each service. Spotify application configuration is
stored server-side in `/data/navet-music-config.json`. Apple Music does not accept user-entered
tokens.

- Spotify asks for the app Client ID and shows the exact callback URL to register.
- Register `https://navet.app/redirect/oauth` in the Spotify app. This hosted relay remembers the
  local Navet callback only in the current browser tab, sends the browser to Spotify, and returns
  the authorization response to the self-hosted instance. The Navet instance itself can remain on
  plain HTTP.
- A custom direct callback remains available for advanced deployments. Spotify requires HTTPS for
  every non-loopback callback. Plain HTTP is supported only with the explicit `127.0.0.1` or
  `[::1]` loopback address; `localhost` and LAN IP addresses are rejected.
- Apple Music uses **Authenticate** to open MusicKit's Apple Account consent flow. MusicKit manages
  the subscriber's Music User Token in the current browser, matching Apple's supported web-app
  authorization model.
- Navet's hosted token service supplies the application-level developer token. Its Apple private
  key remains in the `navet.app` deployment and is never shipped to self-hosted instances or
  browsers.
- Mount `/data` persistently so music configuration and the Spotify refresh session survive
  restarts.

Environment variables remain available for managed or immutable deployments and act as fallbacks
when no value has been stored through the UI:

```text
NAVET_SPOTIFY_CLIENT_ID=
NAVET_SPOTIFY_REDIRECT_URI=
NAVET_APPLE_MUSIC_DEVELOPER_TOKEN=
NAVET_APPLE_MUSIC_DEVELOPER_TOKEN_URL=
```

- Register the exact Spotify callback shown in the in-app guide. The default is the hosted Navet
  relay at `https://navet.app/redirect/oauth`.
- `NAVET_SPOTIFY_REDIRECT_URI` is an optional advanced override for a direct callback. It must use
  HTTPS unless it uses Spotify's explicit loopback exception.
- `NAVET_APPLE_MUSIC_DEVELOPER_TOKEN` is an optional deployment-owned override for development or
  isolated installations. It is not part of end-user setup.
- `NAVET_APPLE_MUSIC_DEVELOPER_TOKEN_URL` optionally replaces Navet's hosted developer-token
  endpoint.

The Home Assistant add-on exposes `spotify_client_id` and `spotify_redirect_uri` as optional
deployment-managed defaults. Values saved in Navet take precedence. Spotify's hosted relay and
Apple Music's MusicKit authorization both work through Ingress without HTTPS on the add-on itself.

## Boundaries

- Music accounts are not smart-home integration providers and do not change the active Home
  Assistant, Homey, or openHAB session.
- A queue belongs to one music source. Switching between Spotify and Apple Music replaces the
  active listening session after confirmation.
- Apple Music does not hand protected streams to arbitrary smart-home speakers. External targets
  remain hidden unless a future adapter can prove compatible playback.
- YouTube Music is not included. A future integration must use Google's compliant embedded-player
  surface rather than extracting audio URLs.
- Custom-panel authentication is not supported in the first release; use standalone or the Home
  Assistant add-on/Ingress surface.
