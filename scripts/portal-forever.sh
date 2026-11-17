#!/bin/sh
cd "$(dirname "$0")/.." || exit 1
mkdir -p dist/municipal
while true; do
  npx tsx scripts/portal-find.ts >> dist/municipal/portal-run.log 2>&1
  npx tsx scripts/license-read.ts >> dist/municipal/portal-run.log 2>&1
  sleep 3600
done
