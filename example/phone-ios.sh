#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

DEVICE="${1:?usage: phone-ios.sh <device-udid>}"
PORT="${PORT:-8090}"
IFACE=$(route -n get default | awk '/interface:/{print $2}')
FIRST=$(ipconfig getifaddr "$IFACE")
OTHERS=$(ifconfig | awk '/inet /{print $2}' | grep -vE '^(127\.|169\.254\.)' || true)
URLS=$(printf '%s\n%s\n' "$FIRST" "$OTHERS" | awk -v port="$PORT" 'NF && !seen[$0]++ {printf "%shttp://%s:%s", sep, $0, port; sep=","}')
export EXPO_PUBLIC_PACK_SERVER_URLS="$URLS"
KEY_FILE="../dist/packs/dev-public-key.pem"
[ -f "$KEY_FILE" ] || { echo "dist/packs/dev-public-key.pem yok, once npm run data:build calistirilmali" >&2; exit 1; }
export EXPO_PUBLIC_GEO_PUBLIC_KEY="$(grep -v '^-----' "$KEY_FILE" | tr -d '\n')"
BUILD_FILE="src/device-test/build-id.ts"
trap "printf \"export const BUILD_ID = 'dev';\\n\" > $BUILD_FILE" EXIT
printf "export const BUILD_ID = '%s';\n" "$(date +%Y%m%d%H%M%S)" > "$BUILD_FILE"
echo "pack server addresses baked in: ${EXPO_PUBLIC_PACK_SERVER_URLS}"
CI=1 npx expo prebuild --platform ios --no-install
CI=1 npx expo run:ios --configuration Release --device "$DEVICE" --no-bundler
