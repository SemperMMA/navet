#!/bin/sh
set -eu

export NAVET_DATA_PATH="${NAVET_DATA_PATH:-/data}"
export NAVET_MUSIC_ENGINE_HOST="${NAVET_MUSIC_ENGINE_HOST:-127.0.0.1}"
export NAVET_MUSIC_ENGINE_PORT="${NAVET_MUSIC_ENGINE_PORT:-5211}"
export NAVET_SONOS_HOSTS="${NAVET_SONOS_HOSTS:-}"

su-exec nginx node /opt/navet/music-engine/server.mjs >>/var/log/navet-music-engine.log 2>&1 &
