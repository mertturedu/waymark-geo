#!/bin/sh
cd "$(dirname "$0")/.." || exit 1
mkdir -p dist/municipal
until caffeinate -i npx tsx scripts/municipal-pdf.ts "$@" >> dist/municipal/pdf-run.log 2>&1; do
  echo "$(date -u +%FT%TZ) yeniden başlatılıyor" >> dist/municipal/pdf-run.log
  sleep 60
done
echo "$(date -u +%FT%TZ) bitti" >> dist/municipal/pdf-run.log
