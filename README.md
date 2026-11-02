# @yuksi/geo

Offline maps, door-level address search, routing and stop planning for React Native and Expo apps.

Everything runs on the phone. The app downloads signed data packs once (or ships them inside the app), checks them, and from then on needs no network: the map draws from local tiles, an address sentence is turned into a point, a route is calculated on a local road graph, and a list of stops is put in a good order.

- **Map**: vector tiles (PMTiles) drawn with MapLibre, light and dark, six label languages, business and brand icons that thin out as you zoom out, and a theme you can change from the app.
- **Address search**: a Turkish address sentence in, ranked places out, with a door number where the map has one. Typo tolerant, works with Turkish, English, German, Russian, Greek and Arabic words.
- **Routing**: drivable road network per province with one-way streets, turn bans, access rules and car ferries; a query takes a fraction of a millisecond.
- **Stop planning**: best order for up to 100 stops with pinned stops, visited stops and "A before B" rules.
- **Learning**: points confirmed by users and couriers are kept on the device and answer the same door next time.
- **Regions**: per province install, update and removal, resumable downloads, automatic suggestion from the GPS position.
- **Packs are signed**: the app only accepts a manifest signed with the key it was built with, and checks every file by SHA-256.

The package is private. See [Access and licence](#access-and-licence).

## Contents

1. [Requirements](#requirements)
2. [Installation](#installation)
3. [Quick start](#quick-start)
4. [Map and theme](#map-and-theme)
5. [Address search](#address-search)
6. [Routing](#routing)
7. [Stop planning](#stop-planning)
8. [Learning](#learning)
9. [Regions and data packs](#regions-and-data-packs)
10. [Hosting the packs](#hosting-the-packs)
11. [Building the packs](#building-the-packs)
12. [Text core](#text-core)
13. [Repository layout](#repository-layout)
14. [Development](#development)
15. [Example app](#example-app)
16. [Data sources and credits](#data-sources-and-credits)
17. [Access and licence](#access-and-licence)

## Requirements

| | |
|---|---|
| Expo | 57 or newer |
| React Native | 0.86 or newer |
| React | 19 or newer |
| Map | `@maplibre/maplibre-react-native` 11.5 or newer |
| Expo modules | `expo-crypto`, `expo-file-system`, `expo-network`, `expo-sqlite` |

The package ships TypeScript sources; Metro compiles them with the app. A development build is needed (MapLibre is native code), Expo Go is not enough. `@rnmapbox/maps` and MapLibre do not build together in one app.

## Installation

Access to the repository is required (it is private). Install from a tag:

```
npm install github:YuksiTech/yuksi-geo#<tag> @maplibre/maplibre-react-native expo-crypto expo-file-system expo-network expo-sqlite
```

or, while both repositories sit side by side on one machine, with `"@yuksi/geo": "file:../yuksi-geo"`.

Add the config plugin so MapLibre is registered in the native project (listing `@maplibre/maplibre-react-native` in `plugins` directly does the same):

```json
{ "expo": { "plugins": ["@yuksi/geo"] } }
```

Entry points:

| Import | Contains |
|---|---|
| `@yuksi/geo` and `@yuksi/geo/core` | Pure TypeScript core: text, address search, routing, planning, learning, pack manager. Runs in Node and in Hermes. |
| `@yuksi/geo/native` | Expo and React Native layer: providers, hooks, map style, UI components. |

## Quick start

```tsx
import { GeoProvider, useGeo, useMapStyle, GeoMapImages } from '@yuksi/geo/native';
import { Map } from '@maplibre/maplibre-react-native';

const config = {
  manifestUrl: 'https://geo.example.com/packs/manifest-v1.json',
  publicKeys: [process.env.EXPO_PUBLIC_GEO_PUBLIC_KEY!],
  language: 'tr',
  autoDownload: 'wifi',
  learning: { enabled: true },
};

export default function Root() {
  return (
    <GeoProvider config={config}>
      <MapScreen />
    </GeoProvider>
  );
}

function MapScreen() {
  const geo = useGeo();
  const style = useMapStyle({ theme: 'light', language: 'tr' });

  return (
    <Map mapStyle={style}>
      <GeoMapImages />
    </Map>
  );
}
```

`GeoProvider` opens the stores, reads the installed packs and exposes the `geo` object. Everything else is a method on it:

| Area | Calls |
|---|---|
| `geo.regions` | `list`, `installed`, `status`, `download`, `pause`, `resume`, `remove`, `checkUpdates`, `detect`, `suggest`, `subscribe` |
| `geo.search` | `resolve`, `autocomplete`, `reverse`, `hoods`, `coverage` |
| `geo.route` | `route`, `matrix`, `installed` |
| `geo.plan` | `plan` |
| `geo.learn` | `confirm`, `export`, `import`, `clear`, `stats` |

`autoDownload` is `'ask' | 'wifi' | 'always' | 'never'`. `publicKeys` is a list so a key can be rotated without breaking installed apps.

Ready-made pieces for the common screens: `RegionDownloadSheet`, `MapLegend`, `GeoAttribution`, `RoutePlanLayer`, `PlanStopList`, and the hooks `useRegions`, `useRegionStatus`, `useAutoRegion`, `useDailyUpdateCheck`, `useAttribution`, `usePlan`.

## Map and theme

`useMapStyle({ theme, language, hide, look })` returns a MapLibre style built from the installed packs: the Protomaps base map, per-province service layers, and an overlay of businesses with icons and brand badges. The style changes by itself when a province is installed or removed.

Icons follow a ladder so a crowded street stays readable:

| Zoom | What the map shows |
|---|---|
| below 16 | Small tinted category icons; quiet groups (food, shops) are hidden |
| 16 to 17.5 | Chains as round badges in the brand colour with a short letter or name |
| 17.5 and above | Small chain logos |

Icons are single-colour shapes tinted at draw time, so one icon works in every colour and in light and dark.

The app can change colours, emphasis and brand display with a theme. The theme is data, not images: **an app can never supply its own icon pictures**, it can only recolour, resize, hide or re-rank the built-in ones.

```tsx
import { createGeoTheme } from '@yuksi/geo/native';

const theme = createGeoTheme({
  colors: { accent: '#E8590C', radius: 14 },
  dark: { colors: { accent: '#FF7A2F' } },
  map: {
    icons: { style: 'muted', scale: 1.1, groups: { fuel: { emphasis: 'strong' }, food: { visible: false } } },
    brands: { mode: 'ladder', ladder: { badgeFrom: 16, logoFrom: 17.5 }, shape: 'circle', chains: { migros: { fill: '#F27A1A', text: 'M' } } },
  },
});

<GeoProvider config={config} theme={theme}>...</GeoProvider>
```

| Setting | Values |
|---|---|
| `icons.style` | `color`, `muted` (greyed), `mono` (accent colour only) |
| `icons.scale` | 0.5 to 2 |
| `icons.groups.<group>` | `color`, `emphasis` (`strong`, `normal`, `quiet`), `visible` |
| `brands.mode` | `ladder`, `badge`, `category`, `logo`, `hidden` |
| `brands.chains.<id>` | `fill`, `ink`, `text`, `visible` for one of the 65 known chains |
| `colors` | `accent`, `bg`, `fg`, `mute`, `line`, `danger`, `success`, `radius`, `font` |

Icon groups: health, pharmacy, safety, money, fuel, worship, lodging, market, public, food, shop, cargo, landmark.

A wrong value never crashes the app. It falls back to the default and a warning is written to the development console. Badge letters that would be unreadable on their background are switched to black or white automatically. `hide` accepts tokens such as `brands`, `landmarks`, `places`, `services`, `group:food`, `chain:migros`.

## Address search

`createSearch({ store, borders })` in `src/core/address` answers four questions over the SQLite address packs: `resolve` (a sentence or a structured query to ranked places), `autocomplete` (suggestions while typing), `reverse` (a point to the nearest door, street or area) and place names through the same `resolve`. Every result says how sure it is: `precision` (`address`, `interpolated`, `street`, `neighbourhood`, `district`, `province`, `poi`) and `approximate`. Only a real door from the map gets `precision: 'address'` and `approximate: false`; a number the map does not have is placed between its neighbours and marked as a guess.

```ts
const result = await geo.search.resolve('Kadıköy Moda Mah. Bahariye Cd. No 14');
const near = await geo.search.autocomplete('bahar', { near: [29.03, 40.99] });
const place = await geo.search.reverse([29.0097, 41.0422]);
```

- `resolve` can add a `suggestion` ("did you mean") when the typed street does not exist but a near spelling does.
- Labels follow `options.language` (province, district and neighbourhood names, English before Turkish as fallback). `place.local` keeps the Turkish components that learned points are keyed by.
- Businesses come from a second pack, the directory (Overture Maps). Its doors are marked `precision: 'interpolated'`, `approximate: true`, `source: 'overture'` and are dropped when the address pack has the same door.
- Provinces whose address points sit on building centres can install an optional `buildings` part that moves a guess to the nearest free building.

```
npm run try -- resolve "kadikoy moda mah bahariye cd no 14" --json
npm run try -- search "bahar" --near 29.03,40.99
npm run try -- reverse "32.8540,39.9208"
```

## Routing

Each province can carry an optional `route` part: the drivable road network of the province plus 10 km around it, with one-way streets, access rules, turn bans and car ferries, and a precomputed hierarchy (contraction hierarchies) so a query takes a fraction of a millisecond. The binary format is in `docs/route-format.md`.

```ts
const leg = await geo.route.route([29.0097, 41.0422], [29.0275, 40.987], { vehicle: 'car' });
const table = await geo.route.matrix(points);
```

`route` returns distance, time and the drawn line; `matrix` fills a table of times and distances for the planner. A stop is moved to the nearest road within 500 m (never to a motorway when another road is within 200 m). Failures are explicit: `no_road` (no road near the stop), `outside_region`, `disconnected` (an island the road network cannot reach), `START_OUTSIDE_REGION` (the start is outside every installed pack), `PACK_DAMAGED`. Times come from a speed table in `src/core/route/speeds.ts`; there is no traffic and no left-turn penalty.

```
npm run try -- route "Moda Mah. Bahariye Cd. 14 Kadıköy" "29.0097,41.0422" --city İstanbul
```

## Stop planning

`geo.plan.plan(request)` orders up to 100 stops.

```ts
const result = await geo.plan.plan({
  stops: [
    { id: 'a', point: [29.01, 41.04], label: 'Depo' },
    { id: 'b', point: [29.03, 40.99] },
    { id: 'c', point: [29.06, 40.97] },
  ],
  start: { stopId: 'a' },
  end: { kind: 'free' },
  pins: [{ stopId: 'c', position: 2 }],
  visited: [],
  precedence: [{ before: 'b', after: 'c' }],
  mode: 'optimize',
});

if (result.ok) console.log(result.order, result.totalDistanceM, result.totalDurationS);
```

- `end`: `{ kind: 'free' }`, `{ kind: 'return' }` or `{ kind: 'stop', stopId }`.
- `mode: 'keep'` leaves the order as given and only calculates the legs.
- `pins` fix a stop at a position, `visited` removes finished stops, `precedence` is "this one before that one".
- The result lists `legs` with geometry, `unreachable` stops with the reason, and `warnings` (`far_snap`, `end_unreachable`, `rule_dropped`, `order_breaks_rule`).
- Failures: `INVALID_REQUEST`, `TOO_MANY_STOPS`, `CONSTRAINT_CONFLICT`, `START_OUTSIDE_REGION`, `PACK_DAMAGED`, `ROUTE_FAILED`.

`usePlan`, `PlanStopList` and `RoutePlanLayer` are the React pieces for a plan screen.

## Learning

`createLearning({ store })` in `src/core/learn` keeps the points that users and couriers confirm. Pass `learning.layer` to `createSearch({ ..., layers: [learning.layer] })` and a confirmed door is answered from the learned point next time. A pin or two close deliveries make it an exact address; a single delivery stays an estimate. A confirmation more than 50 m from the others is treated as an outlier and kept apart. The store is a small interface (`LearnStore`); `memoryStore`, `fileStore` (Node) and an `expo-sqlite` store for the phone ship with the package.

```ts
await geo.learn.confirm({ place, houseNumber: '40', point: [29.02, 40.98], source: 'pin' });
geo.learn.export();                       // one JSON line per door
```

```
npm run corrections -- import a.jsonl b.jsonl [--approve]
npm run sim                               # error before and after learning, five provinces
```

Records hold the folded address key, the official label, coordinates, counts, sources and dates; nothing else.

## Regions and data packs

A **region** is a province (by licence plate, `01` to `81`). Each region is made of **parts**; the app installs only what it needs:

| Part | What it holds | Installed by default |
|---|---|---|
| `tiles` | Vector map of the province (PMTiles) | yes |
| `address` | Door-level address search (SQLite) | yes |
| `places` | Business and brand layer of the map (PMTiles) | yes |
| `directory` | Businesses with street and door number (SQLite) | yes |
| `buildings` | Building centres, only for provinces where address points sit on them | optional |
| `route` | Road graph for routing | no, `geo.regions.download(id, { parts: ['route'] })` |

A small **base pack** holds the overview map, fonts and sprites. Approximate sizes: Istanbul about 212 MB without routing (24 MB more with it); all 81 provinces about 2.4 GB, of which routing is 361 MB.

```ts
await geo.regions.download('34', { onProgress: (done, total) => {} });
geo.regions.list();                         // what the server offers
geo.regions.installed();                    // what is on the phone
await geo.regions.checkUpdates();           // new versions, once a day is enough
await geo.regions.remove('34', ['route']);  // remove one part
```

Downloads are resumable and can be paused. With `autoDownload: 'wifi'` they wait for Wi-Fi unless the user allows mobile data. `useAutoRegion(location)` suggests the province the user is in and stays quiet near a border.

A pack that fails its SHA-256 or whose manifest signature is wrong is rejected and the previous version stays in use. Files are replaced only after the new one is complete.

### Packs inside the app

The packs can also ship inside the app instead of being downloaded. Pass a `net` that answers from the app bundle (`GeoNativeConfig.net`) and point `manifestUrl` at it. The Kargoio courier app does this with the Istanbul and Bursa packs, so the first launch already works without a network. `app.plugin.js` is not involved; the app's own build copies the files into its assets.

## Hosting the packs

The server is a plain static file host. It runs no code and holds no secret.

What the folder looks like (this is the whole upload):

```
manifest-v1.json          list of every file with its size and SHA-256
manifest-v1.json.sig      Ed25519 signature of the manifest
base-<yyyymmdd>/          overview map, fonts, sprites
01/ ... 81/               one folder per province
  address-<hash>.sqlite
  tiles-<hash>.pmtiles
  places-<hash>.pmtiles
  directory-<hash>.sqlite
  buildings-<hash>.sqlite     only some provinces
  route-<hash>.bin            built with the routing part
```

Requirements for the server:

1. **HTTPS.**
2. **HTTP range requests** (`Accept-Ranges: bytes`, status 206). Resumable download and the map tiles depend on it.
3. Correct `Content-Length`, and no on-the-fly compression for `.pmtiles`, `.sqlite` and `.bin`.
4. Caching: file names contain a content hash, so everything except the manifest can be cached for a year (`Cache-Control: public, max-age=31536000, immutable`). The manifest and its `.sig` should be cached for a few minutes at most (`max-age=300`), otherwise updates are not seen.
5. About 2.5 GB of storage for all 81 provinces (about 5 GB while two versions overlap). Traffic is the first install per phone; later updates download only the files whose hash changed.

Any of these works: an object store with a CDN in front (S3, Cloudflare R2, Google Cloud Storage), or nginx on a small VPS:

```nginx
location /packs/ {
    root /srv/geo;
    add_header Accept-Ranges bytes;
    gzip off;
    location ~ manifest-v1\.json(\.sig)?$ { add_header Cache-Control "public, max-age=300"; }
    location ~ \.(sqlite|pmtiles|bin|pbf|png)$ { add_header Cache-Control "public, max-age=31536000, immutable"; }
}
```

Publishing a new version: upload the new hash-named files first, upload `manifest-v1.json` and `manifest-v1.json.sig` last. Phones switch only when the new manifest is complete and its signature is valid.

To try it on a phone without a server: `npm run serve:packs -- dist/packs` serves a folder on port 8090 (with range support) on your local network.

### Signing

The manifest is signed with an Ed25519 key. The **private key stays outside this repository** and outside the server. The matching **public key** (`dev-public-key.pem` next to the manifest during development) goes into the app at build time (`publicKeys`). An app never accepts a manifest signed by an unknown key, so a hacked server cannot push data to the phones. Keep two public keys in the list while rotating.

## Building the packs

The packs are built from a dated OpenStreetMap extract (Geofabrik), a Protomaps daily build and Overture Maps places. The same input gives the same bytes.

```
cd pipeline && ./setup.sh                          # Python environment and tools, once
npm run data:sources -- --pbf <turkey.osm.pbf>     # pin the sources
npm run data:build -- --regions=12il               # or all, or plates like 34,06
npm run data:blocks -- dist/packs                  # add block hashes (faster SHA on the phone)
npm run serve:packs -- dist/packs                  # check on a phone
```

- `data:build` builds borders, addresses, street segments, places, building points, SQLite address packs, embedded province borders, map tile extracts, checks them and writes the signed manifest into `dist/packs`. Work files land in `dist/work/<yymmdd>`.
- The tile extract is tied to the 7-day window of the Protomaps builds; pin the build date and fetch before the window closes.
- `data:release` builds a numbered release into `dist/releases` with checks and a regression report; `data:publish` copies a release into a data repository or folder (dry run unless `--confirm`).
- `pipeline/` holds the Python extractors (`extract_admin.py`, `extract_address_records.py`, `extract_roads.py`, `overture_places.py`), the builders and their tests (`pipeline/.venv/bin/pytest pipeline/tests`).

All of `dist/`, the Python environment and the downloaded tools are ignored by git. **The packs are not in this repository.**

## Text core

`src/core/text` turns an address sentence into parts. It is plain TypeScript and gives the same result in Node and in Hermes.

```ts
import { parseAddress } from '@yuksi/geo/core';

parseAddress('Kadıköy, Moda Mah., Bahariye Cd. 14');
```

It reads Turkish, English, German, Russian, Greek and Arabic words, writes Cyrillic and Greek names in Latin letters, and finds province and district from an embedded list of 81 provinces and 973 districts. The folder avoids `normalize`, `toLocale*`, `toLowerCase`, `toUpperCase`, `Intl` and `\p{}` on purpose (a lint rule enforces it) because Hermes answers them differently from Node; the letter tables are written out.

```
npm run try -- parse "balikesir karesi pasaalani mah 1. sk no 12 d 3"
```

## Repository layout

```
src/core/        pure TypeScript: text, region, packs, address, learn, route, plan, i18n, report
src/native/      Expo and React Native layer: platform adapters, map style and theme, React components
app.plugin.js    Expo config plugin (registers MapLibre)
pipeline/        data pipeline: Python extractors, TypeScript builders, validation
scripts/         command line tools: try, data:*, measure-*, serve-packs, device-report
gates/           the measured acceptance gates for each phase
fixtures/        golden files for text, addresses and transliteration
test/            unit, property and integration tests
example/         Expo example app and the on-device test screen
docs/            file format notes
```

`src/core` has no `class` and no platform imports: everything it needs (file system, SQLite, network, hashing, clock, connectivity) comes in through ports, so the same code runs in Node tests and on the phone.

## Development

```
npm install
npm run verify        # type check (SDK and example), lint, tests with coverage
npm test              # tests only
npm run gates -- --phase 6   # measured acceptance gates of a phase
npm run mutation      # mutation testing (long: hours, many CPU cores and memory)
```

- Node 24 and npm 11.
- The gates check numbers, not opinions: speed, accuracy against reference sets, pack sizes, determinism. A threshold changes only by a written decision.
- Measure scripts: `npx tsx scripts/measure-address.ts --check ...`, `measure-route.ts`, `measure-packs.ts`, `measure-text.ts`, `measure-learning.ts`, `measure-directory.ts`.
- Comparisons with commercial services live outside this repository and never store their answers.

## Example app

`example/` is an Expo app that exercises the SDK on a real device: download a province, search addresses, draw the map, route, plan, learn. It has a step by step test screen that produces a report you can copy.

```
npm run serve:packs -- dist/packs   # in the SDK folder: the phone downloads from here
cd example && npm install
./phone-ios.sh <device-udid>        # Release build on an iPhone
```

The example needs a development build (it uses native modules); use Xcode or Gradle locally.

## Data sources and credits

- Map data © OpenStreetMap contributors, ODbL.
- Base map tiles: Protomaps builds of OpenStreetMap.
- Places: Overture Maps Foundation (CDLA-Permissive-2.0, Apache-2.0, CC0). Phone numbers, e-mail and web addresses are dropped at build time.
- Fonts and sprites ship in the base pack.

Apps that show the map decide where the credit line goes. `t(lang, 'attribution.text')` returns the text in six languages and `GeoAttribution` is an optional small overlay.

## Access and licence

This repository and the packs built from it are private to Yuksi. The package is marked `UNLICENSED`: no one may use, copy or distribute it without written permission, see `LICENSE`. Access to the repository is given per person, and the data packs are only accepted by apps that carry the matching public key, so a copy of the code alone cannot read or replace Yuksi data.
