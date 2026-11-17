#!/bin/sh
cd "$(dirname "$0")/.." || exit 1
mkdir -p dist/municipal
until caffeinate -i npx tsx scripts/opendata-run.ts "$@" >> dist/municipal/opendata-run.log 2>&1; do
  echo "$(date -u +%FT%TZ) yeniden başlatılıyor" >> dist/municipal/opendata-run.log
  sleep 60
done
echo "$(date -u +%FT%TZ) bitti" >> dist/municipal/opendata-run.log
