#!/usr/bin/env bash
# Push a built game to itch.io with butler.
#
#   butler login                 once, to authenticate
#   cp .env.example .env         then fill in ITCH_TARGET
#   npm run deploy:itch
#
# No key is stored here: butler keeps its own credentials.
set -euo pipefail

cd "$(dirname "$0")/.."

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

: "${ITCH_TARGET:?Set ITCH_TARGET in .env, as user/game — see .env.example}"
: "${ITCH_CHANNEL:=html5}"

if ! command -v butler >/dev/null 2>&1; then
  echo "butler is not on PATH. https://itch.io/docs/butler/installing.html" >&2
  exit 1
fi

if [ ! -d dist ]; then
  echo "No dist/. Run: npm run build" >&2
  exit 1
fi

VERSION="$(node -p "require('./package.json').version")"

echo "pushing dist -> ${ITCH_TARGET}:${ITCH_CHANNEL}  (v${VERSION})"
butler push dist "${ITCH_TARGET}:${ITCH_CHANNEL}" --userversion "${VERSION}"
echo
echo "status:  butler status ${ITCH_TARGET}:${ITCH_CHANNEL}"
