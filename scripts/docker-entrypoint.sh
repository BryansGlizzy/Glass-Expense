#!/bin/sh
# Container entrypoint: publish the mobile OTA bundle for this image, then start the server.
# The web bundle (dist/) is baked into the image, so on every start we zip it into $DATA_DIR/updates (the volume) when it
# differs from what is already published. Same step as scripts/update.sh does on a bare-metal server; restarts of an
# unchanged image publish nothing and never bump the version.
#   OTA_AUTO_PUBLISH=0   disable (e.g. you do not ship the Android app from this server)
#   OTA_NOTES="..."      release notes shown in the app's update dialog
set -e

if [ "${OTA_AUTO_PUBLISH:-1}" != "0" ]; then
  OTA_SKIP_BUILD=1 OTA_ONLY_IF_CHANGED=1 node scripts/build-ota.js "" "${OTA_NOTES:-}" \
    || echo "WARNING: OTA bundle was not published (server starts anyway)" >&2
fi

exec "$@"
