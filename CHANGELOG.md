# Changelog

## Unreleased

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

- Map badges in the system map style: one round category badge per place (52 glyphs from Maki and Temaki, CC0), name next to the badge, Apple-like tiers by zoom; chains show their category badge by default (`brands.mode: 'category'`).
- Light base map recoloured (cream earth, white roads, light green parks, blue water); every base colour can be changed with `map.base` in the theme.
- 17 icon groups (added nature, culture, transit, education) and a legend with the same badges.
- Camera tilt: `DEFAULT_PITCH` (20), `MAX_PITCH` (60), `tilted(view)`.
- User location: `GeoUserLocation` (blue dot, heading cone), `LocateButton`, `useLocateMe` (go to my location, follow, follow with heading).
- Automatic download of the province the user is in: `useLocationRegion({ granted })`; `autoDownload` now defaults to `'always'`.
- Device testing: the example app runs tests from a `geoornek://run?ids=...` link and sends the report to the pack server (`npm run device-run`).

## 0.3.0

- First release: offline map packs per province, door-level address search, reverse search, local learning, routing with turn restrictions, stop planning, signed manifest, example app.
