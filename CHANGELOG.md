# Changelog

## Unreleased

- **Own visual design:** a new palette (cool grey-blue ground, sage parks, slate water, amber motorways; its own dark side), group colours that are no longer system colours, rounded-square category badges with the name below, new location mark (`locate-*` images), rounded-square `LocateButton` and `CompassButton` in the brand colour, new `PlaceCard`, `ScaleBar` and `HereStrip`, flat extrusion shading for 3D buildings and a flat default camera (`DEFAULT_PITCH` is 0). Comparison gates no longer measure against another map; `KF6.2` checks label contrast. Layer ids and the public API are unchanged.

## 0.7.2 (2026-11-08)

- Patch updates: when a province is updated, a file that changed is downloaded as a patch against the installed file instead of in full. The manifest lists the patches of a file in the optional `patches` field (`from` is the sha256 of the old file); the build keeps the last 3 releases (`GEO_PATCHES`, `0` turns it off) and writes only patches that apply back to the exact new file and are smaller than 85% of the full download. On the real releases an update from the previous week downloads 1900 → 220 MB over 81 provinces. Older SDKs ignore the field.
- The patch file (`.zpatch`, `docs/patch-format.md`) holds 8 MiB slices, each compressed against a range of the old file. The phone applies it in JavaScript (`applyPatchFile`) with one reused work buffer and a pause every few milliseconds, then checks the sha256 of the result. The result and a patch over 8 MiB are checked by their block hashes (`blocks`, native `expo-crypto`) like a full download, not by a whole-file hash in JavaScript, which blocked the JS thread for 1.3 s per 2 MB on an iPhone 11. If a patch cannot be fetched or applied, only that file is downloaded in full; a lost connection or a cancel is not retried as a full download. The old file stays readable until the update is committed.
- `RegionStatus.updateBytes` is the real download size of an update and `RegionStatus.lastUpdate` (`UpdateReport`: `patched`, `fellBack`, `bytes`) tells how the last update went. `PackConfig.patches: false` turns patching off. The update line of the region list shows `updateBytes`.
- Downloading or deleting many small files (the font files of the base pack, 777 requests) hands the thread back to the engine every 12 ms. On an iPhone 11 a base pack update used to hold the JS thread for 4.8 s and 2.3 s in a row (about 9 ms of file system calls per file, no gap in between); now the longest gap is 86 ms and the update takes as long as before.
- The zstd decoder can start with a prefix (`decompressInPlaceSteps`, `decompressPrefix`); long copies are faster and `rzfh` no longer compares a typed array with `==`.

## 0.7.1 (2026-11-07)

- `useMapStyle({ traffic: true })` shows from far away: below zoom 8 the slow roads are drawn as a soft translucent glow (`traffic-glow@` layers from zoom 6, highways and main roads first), the sharp line starts at zoom 8 and is thicker. In the rush hour a main road is orange and a highway red. `traffic` also takes a time in milliseconds to pin the hour.
- `npm run build:package` runs `npx` through the shell on Windows, so a plain `npm install` of the git package works there.

## 0.7.0 (2026-11-07)

- Routes across provinces: when the start and the end lie in different provinces, `geo.route.route` joins the route packs of the installed provinces between them (`pickChain`, `borderSamples`, `crossingsOf`, `solveChain` in `src/core/route/chain.ts`). Crossings are found in the 10 km band both packs cover and the quickest combination is chosen; the result lists the provinces in `regions`. A province on the way that is not installed still ends in `outside_region`.
- Typical traffic (`src/core/traffic/model.ts`): a built-in weekday, Saturday and Sunday profile of the congestion in Turkish time, scaled by road class and by how busy the province is. It works offline and knows nothing about live events.
  - `geo.route.route(from, to, { at })` returns `durationS` with the delay of that hour and `traffic: { index, freeFlowS, delayS, detour }`. In the rush hour it also tries eight detours through calmer roads and takes one that is at least 5% quicker. Routes across provinces get the delay of each province. Without `at` nothing changes.
  - `useMapStyle({ traffic: true })` draws the slow roads yellow, orange and red (`traffic@` layers under the labels, `TRAFFIC_COLOURS`), refreshed every 15 minutes. `useNavigation` asks for traffic-aware routes.
  - `congestion`, `bandOf`, `slowdownOf`, `mapSlowdown`, `regionBusyness`, `trafficBucket`, `localTime`.
- Route packs are read in slices of 8 ms (`readRoutePackAsync`) and the steps of a route across provinces pause in between, so touches are handled while a pack opens. Hermes: longest step 252 ms (Denizli pack) → 12 ms.
- The small files of the base pack (fonts) download eight at a time instead of one by one: 777 requests no longer take minutes.
- `useMapStyle` builds the style again only when the installed provinces or the base pack change, not on every download progress tick.
- Provinces that are not installed: `MissingRegionsLayer` draws their border with a hatched fill and fades it out when the download ends; `regionOutlines`, `Borders.provincePolygons`, `isMissing`, `missingAt`, `missingPlates`, `regionBytes`.
- Driving: `trackRoute`, `dueCue`, `cueText`, `headingTo` and `useNavigation` (progress along the route, next turn, spoken cues, off route detection and a bird's eye fallback).

## 0.6.0 (2026-11-04)

- The Expo config plugin is `app.plugin.cjs`. As `app.plugin.js` in a package of ES modules Expo could not load it, so `"plugins": ["@yuksi/geo"]` failed with `INVALID_PLUGIN_TYPE`.
- A half downloaded zstd file is kept when the app restarts, so the download goes on from where it stopped instead of starting again from zero. Removing a province also deletes its zstd leftovers.
- Optional MapLibre Tile packs: `GEO_TILE_FORMAT=mlt` converts the map and business tiles after pruning (`pipeline/build/tile-encode.ts`; feature ids are dropped and FastPFOR and FSST are off, because the MapLibre Native decoders cannot read those encodings). The style reads `*.mlt.pmtiles` as MLT and the manifest then asks for SDK 0.6.0. 81 provinces 1366.8 → 1227.9 MB on top of pruning. `npm run mlt:check` decodes every tile with the MapLibre Native decoder. Off by default.
- Route pack version 2 stores an arc and its exact reverse once (`docs/route-format.md`): 81 provinces 354.4 → 299.5 MB on the phone, the same routes. The SDK reads versions 1 and 2; the build writes version 2 (`GEO_ROUTE_FORMAT=1` keeps the old one) and sets `minSdk` to 0.6.0.
- Opening a zstd pack is about three times faster on the phone (Hermes: 4.1-6.2 → 13.5-16.4 MB/s) and never holds the JS thread for long (longest step 541 → 70 ms). The fzstd decoder is now part of the SDK (`src/core/packs/fzstd.ts`) and keeps its window in a double buffer instead of moving 8 MB for every block; the `fzstd` dependency is gone.
- Smaller map packs: the build drops tile features no style variant draws and properties no layer reads (`pipeline/build/tile-prune.ts`), and empties glyph ranges no label uses. Istanbul tiles 68.9 → 58.9 MB, Bursa 36.1 → 28.6 MB, business tiles about 43% smaller; headless renders of 980 views match the unpruned packs. `GEO_PRUNE=0` turns it off.

## 0.5.0 (2026-11-03)

- **Packaging:** the package ships compiled code in `lib/` (`@yuksi/geo`, `@yuksi/geo/core`, `@yuksi/geo/native`) with type files and source maps instead of TypeScript sources; `npm run build:package` builds it (`prepare` and `prepack` do it for git installs and packs). Apps linked with `file:` build it once. `react`, `react-native`, `expo` and MapLibre stay peer dependencies.
- `docs/licences.md`: what the package and the packs are made of and what each licence asks.
- `npm run sdk-check` now installs the packed package into a blank app (`--expo 58.0.22` moves the app to another Expo version first).
- `geo.search.nearby({ point, group, limit, radiusM })`: places of one group (health, pharmacy, safety, money, fuel, worship, lodging, market, public) around a point, nearest first, from the address pack; `useNearby`.
- `geo.route.directions(from, to, { language })`: the route with step by step text ("In 200 m, turn right onto Moda Caddesi"), roundabout exit numbers, merged bends and street names from the address pack, in six languages (`buildManeuvers`, `directionsOf`). Silent: no voice.
- `PlaceCard` and `usePlaceAt`: the badge nearest to a tap within 24 px (the more important group wins a tie), its name, group and address, with "Directions here" and "Copy address".
- `CompassButton` (only while the map is turned), `ScaleBar` (6 languages, rounded lengths), `HereStrip` and `useHereLabel` ("Near Caferağa Mah., Moda Caddesi 12").
- Theme `auto` for `useMapStyle`: follows the system appearance and builds the style once.
- `RegionDownloadSheet`: last update date and "waiting for mobile data approval" (`consentFor`).
- Device tests `sdk.place-card`, `sdk.compass`, `sdk.nearby`, `sdk.maneuvers`, `sdk.scale-bar`.

- Place names: the Turkish name of Overture comes first, then a same-group OSM name within 50 m (`place_names.py`, `osm_names.py`); an English pattern ("Railway X", "X Station") is replaced when the OSM place is found; a name that is only a category word ("Eğitim", "Park", "Eczane") is blank and the place keeps only its badge.
- A place whose name ends in cami, camii, mescit, eczane or hastane gets that glyph when its category says nothing definite (`glyphFromName`).
- `scripts/glyph-audit.ts`: random sample per province, name, category and glyph table, with suspects listed first.
- `scripts/verify-packs.ts`: checks the manifest signature and the size and sha256 of every file.
- Chain position audit also counts an OSM address point within 30 m as independent evidence (`adres`).

- 3D buildings: a `fill-extrusion` layer from zoom 16 (height from `height`, else 6 m; rises in over 0.6 zoom, opacity 0.85); `map.buildings3d: false` turns it off.
- Dark base map (`DARK_BASE`): ground, water, parks, buildings, roads and label colours; names and group inks keep 4.5:1 against the ground.
- Cemeteries and sports grounds have their own tones (`map.base.cemetery`, `map.base.sports`), no new layers.
- Road shields from the `ref` property (the tiles carry no `shield_text`): `D 100`, `O-1`, `E 80` and `34-12` become state, motorway, European and provincial shields (`shieldOf`, `geo-shield-*` images, `npm run icons:shields`).
- Transit: `pipeline/extract/extract_transit.py` reads live subway, light rail, tram, train and ferry routes and named stations from OSM; the style draws them (`regions[].transitPath`) from zoom 11 (lines) and 13 (stations). The transit pack part is not built or shipped yet.
- Device tests `sdk.map-3d`, `sdk.map-dark`, `sdk.map-transit`.

- Street names: letter spacing 0.1 em, wider symbol spacing and padding, small streets start at zoom 14.5.
- Neighbourhood names are written in Turkish capitals by `upperTr` (`i` becomes `İ`, `ı` becomes `I`) with grey 0.12 em spaced letters; MapLibre's own `text-transform` does not know the Turkish rule.
- Long place names: wrapped at 7 em; a name that would pass two lines gets a short form (`abbreviateName`, `ns` in the business tiles) that Turkish maps prefer.
- Font option `font: 'inter' | 'noto'` for `useMapStyle`, `map.style` and `GeoHoodLabels`. Inter glyph files are built with `npm run fonts` (merged with the Noto glyphs, because a glyph file cannot join two fonts); the base pack build copies them in only with `GEO_FONT=inter` (they add about 19 MB, and the base pack limit is 30 MB).
- Device tests `sdk.map-languages`, `sdk.map-label-lines`, `sdk.shot-tour`.

- `useMapStyle({ view, maxRegions })`: only the provinces near the view are in the style (`regionsForView`), so the style no longer grows with every installed province.
- Address packs: at most four open provinces (least recently used first) and idle provinces are let go; `hoods()` reads neighbourhood names without keeping databases open (`PackStore.release`, `PackStore.peek`).
- Business tiles carry the badge glyph, tier and group (`k`, `t`, `grp`); the style uses them when present (`placeProps`), `scripts/make-alt-packs.ts` builds a second pack root for comparisons.

- Mobile data consent: with `autoDownload: 'always'` a province over `cellularAskMb` (default 50 MB) is asked about before it downloads on mobile data (`decision.action === 'consent'`, `RegionConsentSheet`, `accept`, `waitForWifi`); `download(id, { wifiOnly })`, `downloadBytes`, `connection`, `onConnection`; `GeoNativeConfig.connectivity`.
- A download that was cut when the app went to the background is tried again when the app returns to the front and at every ten-minute location read, even when the position did not move.
- Location timestamps are read in seconds (iOS) and milliseconds (Android); an older position is used as a fallback up to half an hour when nothing fresher arrives.

- `GeoHoodLabels` draws neighbourhood names; the style no longer waits for them, so the map loads its style once.
- Camera helpers `safeView`, `normalBearing`, `clampPitch`, `jumpTilted`.
- `useLocateMe`: `openSettings()`, asks again after a refusal, stops when the permission is taken back, ignores cached positions older than two minutes.
- Cargo and post branches (Yurtiçi, Aras, MNG, PTT...) show from zoom 16 like pharmacies; chain places carry a confidence of 90, which the stricter tier hid at street level.
- Example app: scene life cycle for iOS 27; device tests can repeat (`--repeat`).

## 0.4.0

- Map badges: one category badge per place (52 glyphs, CC0), tiers by zoom; chains show their category badge by default (`brands.mode: 'category'`).
- Light base map recoloured (cream earth, white roads, light green parks, blue water); every base colour can be changed with `map.base` in the theme.
- 17 icon groups (added nature, culture, transit, education) and a legend with the same badges.
- Camera tilt: `DEFAULT_PITCH` (20), `MAX_PITCH` (60), `tilted(view)`.
- User location: `GeoUserLocation` (blue dot, heading cone), `LocateButton`, `useLocateMe` (go to my location, follow, follow with heading).
- Automatic download of the province the user is in: `useLocationRegion({ granted })`; `autoDownload` now defaults to `'always'`.
- Device testing: the example app runs tests from a `geoornek://run?ids=...` link and sends the report to the pack server (`npm run device-run`).

## 0.3.0

- First release: offline map packs per province, door-level address search, reverse search, local learning, routing with turn restrictions, stop planning, signed manifest, example app.
