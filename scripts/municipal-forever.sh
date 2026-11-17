#!/bin/sh
cd "$(dirname "$0")/.." || exit 1
mkdir -p dist/municipal
pgrep -x ollama >/dev/null || (nohup ollama serve >> dist/municipal/ollama.log 2>&1 &)
sleep 3
until caffeinate -i npx tsx scripts/municipal-run.ts "$@" >> dist/municipal/run.log 2>&1; do
  echo "$(date -u +%FT%TZ) yeniden başlatılıyor" >> dist/municipal/run.log
  sleep 30
done
echo "$(date -u +%FT%TZ) bitti" >> dist/municipal/run.log
