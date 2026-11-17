# Address server

Runs the phone's search core on a server. It reads the same packs (`manifest-v2.json` and the `address`, `buildings`, `buildings2`, `directory`, `learned` files in it) with the same code, so the answer is the same as on the phone. Map tiles are not this server's job.

## Running

```
GEO_PACKS_DIR=dist/packs-0.8-adres GEO_API_KEYS=cargo:a-long-secret-value npm run serve:geo
```

| Environment variable | Meaning |
|---|---|
| `GEO_PACKS_DIR` | Release directory (`manifest-v2.json` or `manifest-v1.json` and the pack files). Packs are read as `.sqlite`; if missing, the `.zst` copy is decompressed once and its digest is checked. |
| `GEO_API_KEYS` | `name:secret[:requests/s]`, several separated by commas. Required. Only `name` appears in the log. |
| `PORT`, `HOST` | Default `8096`, `127.0.0.1` (`0.0.0.0` in Docker). |
| `GEO_MAX_OPEN` | Number of provinces open at the same time (default 12). The memory limit is tuned here. |
| `GEO_IDLE_MS` | Time after which an unused province is closed (default 300 s). |
| `GEO_FLAGS` | Remote feature flags `name=percent,name2=percent` (e.g. `address_v2=25`); `GEO_FLAGS_ALLOW` and `GEO_FLAGS_DENY` `name:user1\|user2;…`. The process is restarted for a change. Details: `docs/address-v2-integration.md`. |
| `GEO_WORKERS` | Number of workers (default 1). If greater than 1 the main process forks workers and restarts a worker that exits. Every worker keeps its own cache of open provinces, so the memory and request limits are **per worker** (`GEO_MAX_OPEN` is per worker, the per-key request limit is counted separately in every worker). |

Single-file bundle: `npm run build:server` → `dist/geo-server.mjs` (Node 24, `node:sqlite`). Docker: `Dockerfile`, the packs are mounted as `/data`.

## Endpoints

All JSON. The key comes in the `x-api-key` or `Authorization: Bearer` header. `/health` and `/version` need no key.

| Endpoint | Input | Answer |
|---|---|---|
| `POST /v1/geocode` | `q` (≤ 500 characters), `city`, `district`, `nearLng`+`nearLat`, `limit` (≤ 20), `language`, `geometry: true` (adds line and boundary to street, neighbourhood and district results) | `ResolveResult` (same as the core) |
| `POST /v1/validate` | same | `Validation` |
| `POST /v1/autocomplete` | same, `deep: false` | `{ places }` |
| `GET /v1/reverse` | `lng`, `lat`, `heading`, `accuracyM`, `language` | `{ place }` |
| `POST /v1/geometry` | `place` (`id`, `region`, `precision`, `components`, `coordinate`) | `{ shape: { geometry, bbox } }` (street line, neighbourhood or district boundary) |
| `GET /v1/admin` | empty: 81 provinces; `province=34`: districts; `district=<id>`: neighbourhoods; `hood=<id>`: streets; `street=<id>`: doors (≤ 500) and number ranges; `limit` | `{ level, items, doors?, ranges? }`; ids are stable |
| `GET /v1/range` | `street` | `{ ranges }` (anchor `min`/`max` per street, segment and side, estimated ends, anchor count, quality) |
| `GET /v1/lookup/{id}` | stable id (`sid`) or old `Place.id` | `{ place }`, `404` if missing |
| `POST /v1/geocode/batch` | `queries` (≤ 100), `city`, `district`, `language` | `{ results }` (in order, each the same as a `/v1/geocode` answer) |
| `POST /v1/validate/csv` | `csv` (≤ 200,000 characters, header row `adres` is skipped, ≤ 100 rows) | `{ rows: [{ row, address, validation }] }` |
| `GET /v1/flags` | `user` (stable, hashed id) | `{ flags: { <name>: boolean } }`; the percentage and allow/deny lists come from the server configuration (`GEO_FLAGS`, `GEO_FLAGS_ALLOW`, `GEO_FLAGS_DENY`) |
| `POST /v1/events` | `events: [{ name, count }]` (≤ 50) | `{ accepted }`; counters only, no address or location is accepted; `geo_client_events_total` in `/metrics` |
| `GET /metrics` | (key required) | Prometheus text: `geo_requests_total{path,status}`, `geo_request_duration_ms` (buckets of 5, 10, 25, 50, 100, 250, 500, 1000 ms), `geo_open_parts`, `geo_regions`, `geo_uptime_seconds`; counted separately per worker |
| `GET /v1/places` | `lng`, `lat`, `group`, `radiusM` (≤ 5000), `limit`, `language` | `{ hits }` |
| `GET /health` | | `{ ok, regions, uptimeS }` |
| `GET /version` | | `{ sdk, data, format, learned }` (`learned`: the date of the newest learning file) |

`Place.sid` is the id to store permanently (`D<plate>-<n\|w\|r><osm>` door, `S<plate>-…` street, `H<plate>…` neighbourhood, `I<plate>-r<relation>` district). `Place.id` carries the build order and can shift between releases; both resolve with `/v1/lookup/{id}`.

Use `POST` for address text: the text goes in the body, not in the URL, so it does not end up in the logs of proxies in between. An error answer is `{ error: { code, message } }`; `400` invalid input, `401` key, `405`, `413` body over 8 KB, `429` (with `retry-after`) request limit or too many failed attempts, `500` internal error (no details are written).

**Give `city` or `nearLng`+`nearLat` for autocomplete.** Without a hint, if 81 provinces are installed, the search scans the first 12 provinces; this is slow and often in the wrong provinces.

## Security and logging

- Keys are kept in memory as a digest and compared in constant time. A token bucket per key (default 30 requests/s, a burst of 2 s); after 10 attempts per minute with a wrong key that address gets `429`.
- A log line has: time, method, path, status, duration, key name. Query text, query string, body, key value and client address are not written anywhere (`npm run gates -- --adres 16`, A16.4).
- Run it behind a TLS proxy (Render, nginx, etc.).

## Refreshing the learning file

The server checks the modification time of `manifest-v2.json` (or `-v1`) at most every 2 s. When a new `learned-<digest>.sqlite` and an updated manifest are put in the directory (file first, then manifest), the open files of the changed province are replaced with the new one; the old ones close after 30 s. No restart is needed; a corrupt manifest is ignored and the old one is kept. Measurement: a new point is in the answer in about 2 s (`scripts/measure-reload.ts`).

## Release and proxy

`docs/deploy/` has examples for Render (`render.yaml`, Docker, 10 GB disk), Caddy and nginx. The proxy terminates TLS and does not keep query string, body or headers in its log. `/health` is for load balancer checks. The body limit is 256 KB (for the bulk and CSV endpoints).

## Client

```ts
import { createGeoClient } from '@yuksi/geo/core';

const geo = createGeoClient({ baseUrl: 'https://geo.example.com', key: process.env.GEO_KEY! });
const found = await geo.resolve('Bağdat Caddesi 100 Kadıköy', { hints: { city: 'İstanbul' } });
```

`GeoClient`: `resolve`, `validate`, `autocomplete`, `reverse`, `nearby`, `lookup`, `admin`, `range`, `resolveMany`, `validateCsv`, `health`, `version`; the types are the same as `geo.search`. An error carries `status` and `code`. On the phone, with `createGeo({ ..., online: { baseUrl, key } })` the server is asked when the province is not installed (`region_missing`, empty suggestions, `null` reverse search); if the server cannot be reached the offline answer is returned. Without `online` the SDK connects nowhere.

## Data and memory

The server wants the packs as unpacked `.sqlite` (81 provinces are about 2.7 GB; `.zst` copies and patches are not needed). Memory depends on the number of open provinces, see the measurement in the internal phase 16 resources report. With a new release, change the directory and restart the server (`learned` is refreshed live, pack files have fixed names: a new file gets a new name by its digest).

Measurements: `npx tsx scripts/measure-server.ts --check parity|speed|resources|privacy`.
