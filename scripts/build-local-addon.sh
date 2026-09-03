#!/bin/zsh
# The 408 fork: assemble a runtime-only local HA add-on from prebuilt artifacts.
# Unlike upstream's addon Dockerfile (full monorepo build inside Docker), this
# packages the already-built apps/standalone/dist so the Supervisor build on the
# HAOS VM is seconds, not minutes. Run `pnpm build` first.
#
# Usage: scripts/build-local-addon.sh [--push]
#   --push  rsync the assembled add-on to root@192.168.30.67:/addons/navet408/

set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
SRC_ADDON="$REPO/platform/home-assistant/addons/navet"
OUT="$REPO/dist-addon/navet408"
DIST="$REPO/apps/standalone/dist"
HA_HOST="root@192.168.30.67"

[[ -f "$DIST/index.html" ]] || { echo "apps/standalone/dist missing — run 'pnpm build' first" >&2; exit 1; }

rm -rf "$OUT"
mkdir -p "$OUT/njs" "$OUT/snippets" "$OUT/html"

# Wrap upstream run.sh: mirror the njs stores in /data to the add-on config dir
# (/addon_configs/local_navet408/store on the host) so dashboard/chore state is
# readable from the SSH add-on and lands in the jmb-ha style file backups.
cp "$SRC_ADDON/run.sh" "$OUT/run-upstream.sh"
cat > "$OUT/run.sh" <<'EOF_RUN'
#!/usr/bin/with-contenv bashio
if [[ -d /config ]] && mkdir -p /config/store 2>/dev/null; then
  # Restore: fresh /data (reinstall) but a mirrored store exists -> seed from it
  if [[ -z "$(ls -A /data 2>/dev/null)" && -n "$(ls -A /config/store 2>/dev/null)" ]]; then
    cp -a /config/store/. /data/
    echo "navet408: restored /data from /config/store"
  fi
  (
    while true; do
      cp -u /data/navet-* /config/store/ 2>/dev/null || true
      sleep 300
    done
  ) &
fi
exec /run-upstream.sh
EOF_RUN
cp -R "$SRC_ADDON/rootfs" "$OUT/rootfs"
# Surface nginx/njs errors in the Supervisor add-on log instead of a file inside the container
sed -i '' -e 's#^error_log /var/log/nginx/error.log notice;#error_log /dev/stderr notice;#' "$OUT/rootfs/etc/nginx/nginx.conf"
cp "$SRC_ADDON/icon.png" "$SRC_ADDON/logo.png" "$OUT/" 2>/dev/null || true
cp "$REPO"/docker/njs/*.js "$OUT/njs/"
cp "$REPO"/docker/snippets/*.conf "$OUT/snippets/"
cp -R "$DIST/." "$OUT/html/"

VERSION="$(node -p "require('$REPO/package.json').version")"
GIT_SHA="$(git -C "$REPO" rev-parse --short HEAD)"

# config.yaml: upstream options/schema, local build (no image:), 408 identity
cat > "$OUT/config.yaml" <<EOF
name: Navet 408
version: "${VERSION}-408.${GIT_SHA}"
slug: navet408
description: The 408's Navet fork (SemperMMA/navet) — smart home dashboard
url: https://github.com/SemperMMA/navet
arch:
  - amd64
startup: application
init: false
ingress: true
ingress_port: 8099
homeassistant_api: true
panel_icon: mdi:hub
panel_title: Navet
map:
  - addon_config:rw
options:
  dashboard_config_url: ""
  homey_client_id: ""
  homey_client_secret: ""
  homey_redirect_uri: ""
  allow_insecure_provider_tls: false
schema:
  dashboard_config_url: str?
  homey_client_id: str?
  homey_client_secret: password?
  homey_redirect_uri: str?
  allow_insecure_provider_tls: bool
  hass_url: str?
  token: password?
EOF

cat > "$OUT/build.yaml" <<EOF
build_from:
  amd64: ghcr.io/home-assistant/amd64-base:3.20
EOF

# Runtime-only Dockerfile: mirrors the final stage of upstream's addon Dockerfile
cat > "$OUT/Dockerfile" <<'EOF'
ARG BUILD_FROM=ghcr.io/home-assistant/amd64-base:3.20
FROM ${BUILD_FROM}
ARG BUILD_VERSION
ARG BUILD_ARCH

RUN apk add --no-cache bash nginx nginx-mod-http-js

COPY run.sh /run.sh
COPY run-upstream.sh /run-upstream.sh
COPY rootfs/ /
COPY njs/ /etc/nginx/njs/
COPY snippets/ /etc/nginx/snippets/
COPY html/ /usr/share/nginx/html/

RUN mkdir -p /data \
  && chown -R nginx:nginx /data \
  && chmod a+x /run.sh /run-upstream.sh

LABEL \
  io.hass.version="${BUILD_VERSION}" \
  io.hass.type="addon" \
  io.hass.arch="${BUILD_ARCH}"

EXPOSE 8099
CMD ["/run.sh"]
EOF

echo "assembled $OUT (version ${VERSION}-408.${GIT_SHA})"

if [[ "${1:-}" == "--push" ]]; then
  rsync -a --delete "$OUT/" "$HA_HOST:/addons/navet408/"
  echo "pushed to $HA_HOST:/addons/navet408/"
fi
