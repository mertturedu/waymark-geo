#!/bin/sh
cd "$(dirname "$0")/.." || exit 1
mkdir -p dist/municipal
while true; do
  npx tsx scripts/municipal-lists.ts >> dist/municipal/lists-run.log 2>&1
  npx tsx scripts/hints-build.ts >> dist/municipal/hints-run.log 2>&1
  sleep 1800
done
