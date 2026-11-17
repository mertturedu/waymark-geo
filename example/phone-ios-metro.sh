#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

DEVICE="${1:?usage: phone-ios-metro.sh <device-udid>}"
PORT="${PORT:-8090}"
METRO_PORT="${METRO_PORT:-8084}"
IFACE=$(route -n get default | awk '/interface:/{print $2}')
FIRST=$(ipconfig getifaddr "$IFACE")
OTHERS=$(ifconfig | awk '/inet /{print $2}' | grep -vE '^(127\.|169\.254\.)' || true)
URLS=$(printf '%s\n%s\n' "$FIRST" "$OTHERS" | awk -v port="$PORT" 'NF && !seen[$0]++ {printf "%shttp://%s:%s", sep, $0, port; sep=","}')
export EXPO_PUBLIC_PACK_SERVER_URLS="$URLS"
KEY_FILE="../dist/packs/dev-public-key.pem"
[ -f "$KEY_FILE" ] || { echo "dist/packs/dev-public-key.pem yok, once npm run data:build calistirilmali" >&2; exit 1; }
export EXPO_PUBLIC_GEO_PUBLIC_KEY="$(grep -v '^-----' "$KEY_FILE" | tr -d '\n')"
export REACT_NATIVE_PACKAGER_HOSTNAME="$FIRST"
echo "pack server addresses baked in: ${EXPO_PUBLIC_PACK_SERVER_URLS}"
echo "metro: http://${FIRST}:${METRO_PORT}"
CI=1 npx expo prebuild --platform ios --no-install
npx expo run:ios --configuration Debug --device "$DEVICE" --port "$METRO_PORT"
