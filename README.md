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

A development build is needed (MapLibre is native code), Expo Go is not enough. `@rnmapbox/maps` and MapLibre do not build together in one app.

## Installation

Access to the repository is required (it is private). Install from a tag:

```
npm install github:YuksiTech/yuksi-geo#<tag> @maplibre/maplibre-react-native expo-crypto expo-file-system expo-network expo-sqlite
```

or, while both repositories sit side by side on one machine, with `"@yuksi/geo": "file:../yuksi-geo"`.

The package ships compiled code (`lib/`, with type files and source maps), so an app needs no `watchFolders` and no extra Gradle flag. The compiled folder is built when the package is packed or installed from git (`npm run build:package`); with a `file:` link, run `npm run build:package` once in this repository and again after changing the SDK.

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
| `geo.regions` | `list`, `installed`, `status`, `download`, `downloadBytes`, `pause`, `resume`, `remove`, `checkUpdates`, `connection`, `detect`, `suggest`, `subscribe` |
| `geo.search` | `resolve`, `autocomplete`, `reverse`, `nearby`, `hoods`, `coverage` |
| `geo.route` | `route`, `matrix`, `directions`, `installed` |
| `geo.plan` | `plan` |
| `geo.learn` | `confirm`, `export`, `import`, `clear`, `stats` |

`autoDownload` is `'ask' | 'wifi' | 'always' | 'never'` (default `'always'`: once the user has shared their location, the province they are in is downloaded by itself; on mobile data a province over `cellularAskMb`, default 50, is asked about first). `publicKeys` is a list so a key can be rotated without breaking installed apps.

Ready-made pieces for the common screens: `RegionDownloadSheet`, `MapLegend`, `GeoAttribution`, `RoutePlanLayer`, `PlanStopList`, and the hooks `useRegions`, `useRegionStatus`, `useAutoRegion`, `useDailyUpdateCheck`, `useAttribution`, `usePlan`.

## Map and theme

`useMapStyle({ theme, language, hide, look })` returns a MapLibre style built from the installed packs: the Protomaps base map, per-province service layers and the overlay of businesses. The style changes by itself when a province is installed or removed.

**Many provinces.** Every installed province adds about 70 layers to the style (12 provinces: 922 layers and 1.8 MB of style, 81 provinces: 5821 layers and 12 MB). Pass the part of the map that is on screen and only the provinces near it go into the style:

```tsx
const [view, setView] = useState({ center: [29.03, 40.99], zoom: 12 });
const style = useMapStyle({ theme, language: lang, view, maxRegions: 6 });
<Map mapStyle={style} onRegionDidChange={(e) => setView({ center: [e.nativeEvent.center[0], e.nativeEvent.center[1]], zoom: e.nativeEvent.zoom })} />
```

The provinces under the view are always in the style, and neighbours within 30 km are added up to `maxRegions` (default 6). The set changes only when the view leaves it, never while the map is zoomed out below zoom 9 (the base map covers the whole country there), and never twice for one move, so the map does not reload while the user pans inside a province. Without `view` every installed province is in the style, as before. Round the centre and zoom you pass (for example to 0.01 degrees and half a zoom step) so the app does not re-render on every frame.

The place classification (badge glyph, tier and group) is baked into the business tiles as the properties `k`, `t` and `grp`; tiles built before that still work, the style works the values out itself.

Places are drawn as **round category badges with the name beside them**: a coloured circle, a white glyph cut out of it and a thin white ring, in the colour of its group (food orange, shops amber, health and pharmacies red, parks green, culture magenta, transport blue, and so on). A chain store gets the badge of its category, so every supermarket shows the same basket; chain logos and letters are an option (see `brands.mode`). The base map's own sprite icons are left out so nothing is drawn twice.

The map thins out like a printed map: the further out, the fewer places. Places are ranked in four tiers by kind and by how sure the data is about them.

| Zoom | What shows |
|---|---|
| from 15 | Hospitals, airports, metro, train and ferry stops; the surest places of the next tiers |
| from 16 | Pharmacies, places of worship, universities; then supermarkets, banks, parks, hotels, schools and similar |
| from 17 | Cafes, restaurants and shops, the surest ones first |
| from 18.5 | Almost everything with a name |

Places with no name are not drawn, and neither are office-type businesses (real estate, advertising, manufacturing, legal and similar). The glyph is chosen from the category of the place (`src/native/map/poi-glyphs.ts`, 52 glyphs from Maki and Temaki, see `docs/icons.md`). Icons are small distance fields tinted at draw time, so one picture works in every colour, in light and dark.

`MapLegend` explains the groups and can switch each of them on and off.

The map looks best leaned back a little, about 20 degrees, like a printed map held at an angle. `DEFAULT_PITCH` (20) and `tilted(view)` give the app that value for the camera; the user can still flatten or tilt it with two fingers (up to `MAX_PITCH`, 60). Names and badges stay upright when the map is tilted.

```tsx
import { DEFAULT_PITCH, tilted } from '@yuksi/geo/native';

<Camera initialViewState={tilted({ center: [29.03, 40.99], zoom: 15 })} />
camera.current?.easeTo({ center, pitch: DEFAULT_PITCH, duration: 400 });
```

`safeView(view)` keeps the bearing between 0 and 360 and the pitch between 0 and `MAX_PITCH` (iOS ignores a negative bearing). `jumpTilted(camera, view, read)` jumps safely with a tilted camera: on a far jump it flattens first, then tilts, and jumps once more if the zoom landed off (on iOS the zoom after a tilted jump depends on the previous pitch).

Neighbourhood names are drawn by their own component, so the map style loads once even though the names arrive a moment later:

```tsx
<Map mapStyle={style}>
  <GeoHoodLabels theme="light" language="tr" />
</Map>
```

### Buildings, dark map and road shields

Buildings are drawn flat below zoom 16 and as 3D blocks from zoom 16 (`map.buildings3d`, on by default). The block height is the `height` of the building when the tiles carry it and 6 m otherwise; in the Istanbul sample tile only about 4 % of the buildings have a height, so most blocks are low. The dark theme has its own base colours (`DARK_BASE`); `map.base` can change any of them. Road references (`D 100`, `O-1`, `E 80`, `34-12`) are drawn as shields.

### Place cards, nearby places, directions

`geo.search.nearby({ point, group: 'pharmacy', limit: 5 })` lists the closest places of a group with their distance. `usePlaceAt(project)` returns a `card` for the badge under a tap (`pick(features, { x, y })`); show it with `<PlaceCard card={card} onRoute={...} onCopy={...} onClose={...} />`. `geo.route.directions(from, to, { language })` gives the route and its steps; the text is written for reading (no voice). Turns are found from the shape of the route: the street name of a step is the street found 15 m after the turn in the address pack, and the exit number of a roundabout is estimated from the entry and exit headings, so it can be wrong on unusual roundabouts. Put `<ScaleBar zoom latitude />` and `<CompassButton bearing onPress />` on the map; `useMapStyle({ theme: 'auto' })` follows the system appearance.

### Fonts and labels

The map writes in Noto Sans by default. Pass `font: 'inter'` to `useMapStyle` (and `GeoHoodLabels`) to use Inter; the base pack must carry the Inter glyph files for that. Build them once with `npm i fontnik` in a scratch folder, download Inter (OFL) and run `npm run fonts -- --ttf <Inter ttf folder> --out pipeline/data/fonts-inter --noto <base>/fonts-compact --fontnik <scratch folder>`. Set `GEO_FONT=inter` when building the packs to put them in the base pack (about 19 MB more). Each Inter face also carries the Noto glyphs it lacks (Arabic, Devanagari...), because MapLibre reads one glyph file per font and cannot join two.

Neighbourhood names are written in capitals with `upperTr` and street names are letter spaced. Business names that would need more than two lines use a short form (`ns` in the business tiles, made by `abbreviateName`) in Turkish.

### User location

Three parts show the user on the map and move the camera to them, like the location button of a system map:

- `GeoUserLocation` draws the blue location dot (with the accuracy ring and, in heading mode, the direction cone).
- `LocateButton` is a round button with an arrow: outline when idle, filled while following, upright arrow while the map turns with the compass.
- `useLocateMe` ties them to the map camera. A press asks for permission if needed, zooms in to street level (it never zooms out), and follows the user. Another press turns the map with the compass, and the next one goes back to plain follow. Dragging the map stops following.

```tsx
import { Camera, Map, type CameraRef } from '@maplibre/maplibre-react-native';
import { GeoUserLocation, LocateButton, useLocateMe } from '@yuksi/geo/native';

const camera = useRef<CameraRef>(null);
const locate = useLocateMe({ cameraRef: camera, getZoom: () => zoom.current, onDenied: () => toast('Location permission was not granted') });

<Map ...>
  <Camera ref={camera} {...locate.camera} />
  <GeoUserLocation {...locate.puck} />
</Map>
<LocateButton mode={locate.mode} permission={locate.permission} busy={locate.busy} onPress={() => void locate.press()} lang={lang} />
```

| Option | Meaning |
|---|---|
| `cameraRef` | The map camera (required) |
| `zoom` | Street-level zoom used when the map is farther out (default 16) |
| `getZoom` | Returns the current zoom so a closer map is not zoomed out |
| `headingMode` | `false` removes the compass step from the cycle |
| `granted` | Tell the hook the permission is already granted (for example from `expo-location`), so the dot shows before the first press. Without it the dot appears after the first press |
| `onDenied`, `onUnavailable` | Called when permission is refused or no fix arrives within 5 seconds |

A press after a refusal asks the system again (it answers at once without a dialog when the permission is still off), so turning location on in Settings works without restarting the app. `locate.openSettings()` opens the app's page in Settings. If the app takes the permission back (`granted` turns `false`), following stops and the dot hides. A cached position older than two minutes is not used.

The dot is drawn by the native map, so the app needs the usual location permission text (`NSLocationWhenInUseUsageDescription` on iOS, `ACCESS_FINE_LOCATION` on Android). The location is never sent anywhere. The button's labels come from the SDK messages in six languages.

The app can change colours, size and visibility with a theme, including the colours of the base map. The theme is data, not images: **an app can never supply its own icon pictures**, it can only recolour, resize, hide or re-rank the built-in ones.

```tsx
import { createGeoTheme } from '@yuksi/geo/native';

const theme = createGeoTheme({
  colors: { accent: '#E8590C', radius: 14 },
  dark: { colors: { accent: '#FF7A2F' } },
  map: {
    icons: { style: 'muted', scale: 1.1, groups: { fuel: { emphasis: 'strong' }, food: { visible: false } } },
    brands: { mode: 'category' },
  },
});

<GeoProvider config={config} theme={theme}>...</GeoProvider>
```

| Setting | Values |
|---|---|
| `icons.style` | `color`, `muted` (greyed), `mono` (accent colour only) |
| `icons.scale` | 0.5 to 2 |
| `icons.groups.<group>` | `color`, `emphasis` (`strong` bigger, `normal`, `quiet` smaller), `visible` |
| `brands.mode` | `category` (default, chains get their category badge), `badge`, `ladder`, `logo` (chain badges and logos from the older design), `hidden` |
| `brands.chains.<id>` | `fill`, `ink`, `text`, `visible` for one of the 65 known chains (used by the chain modes) |
| `colors` | `accent`, `bg`, `fg`, `mute`, `line`, `danger`, `success`, `radius`, `font` |
| `base` | Colours of the map itself by name (`earth`, `water`, `buildings`, `park_a`, `major`, `roads_label_major`, ... the colour names of the Protomaps flavor). Light is warm cream with white roads and light green parks; dark keeps the stock dark map |

Groups: health, pharmacy, safety, money, fuel, worship, lodging, education, market, food, shop, culture, nature, transit, public, cargo, landmark.

A wrong value never crashes the app. It falls back to the default and a warning is written to the development console. `hide` accepts tokens such as `group:food`, `chain:migros`, `brands`, `landmarks`, `places`, `services`.

## Address search

Address packs are opened when a question needs them. At most four provinces stay open (the one used longest ago is let go first) and a province that was not used for two minutes is let go when another one is opened (`createSearch({ maxOpen, idleMs, clock })`); the next question reopens it. Neighbourhood names for the map (`hoods()`) are read with a short-lived connection and kept, so 81 installed provinces do not keep 81 databases open.

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

`createLearning({ store })` in `src/core/learn` keeps the points that users and couriers confirm. Pass `learning.layer` to `createSearch({ ..., layers: [learning.layer] })` and a confirmed door is answered from the learned point next time. A pin or two close deliveries make it an exact address; a single delivery stays an estimate. A confirmation more than 50 m from the others is treated as an outlier and kept apart. The store is a small interface (`LearnStore`); `memoryStore` and an `expo-sqlite` store for the phone ship with the package. `fileStore` in `src/node` is only for the Node scripts of this repository and is not in the package.

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

Downloads are resumable and can be paused. With `autoDownload: 'wifi'` they wait for Wi-Fi unless the user allows mobile data.

### Download by location

`useLocationRegion({ granted })` downloads the province the user is in, by itself. When the user has given location permission it reads the position (on start, when the app returns to the foreground, every ten minutes, and again after 30 seconds if no fix arrived). A position that moved less than 1.5 km does not start a new check, but a return to the foreground and every ten-minute read check again, so a download that was cut off is tried again. With `'ask'` it only suggests. `useAutoRegion(location)` is the lower-level hook for an app that already has the position.

```tsx
const { decision, accept, waitForWifi, dismiss } = useLocationRegion({ granted });
<RegionConsentSheet decision={decision} lang={lang} onAllow={() => void accept()} onWait={() => void waitForWifi()} />
```

**Mobile data.** With `autoDownload: 'always'` a province bigger than `cellularAskMb` (default 50) is not downloaded over mobile data without asking. `decision.action` becomes `'consent'` (with `decision.bytes`) and `RegionConsentSheet` asks in six languages ("The Istanbul map is 312 MB. Download it over mobile data?"). **Download** downloads now (`accept()`); **Wait for Wi-Fi** queues it (`waitForWifi()`) and it starts by itself when Wi-Fi comes, and the question is not asked again while it waits. An unknown connection counts as mobile data. `cellularAskMb: 0` always asks on mobile data, `Infinity` never asks. The first province also needs the base pack (about 20 MB), which is counted in the size.

```ts
geo.regions.downloadBytes('34');                            // what a download would fetch now
await geo.regions.download('34', { wifiOnly: true });       // wait for Wi-Fi, for this download only
await geo.regions.download('34', { allowCellular: true });  // mobile data is fine
await geo.regions.connection();                             // 'wifi' | 'cellular' | 'none'
```

### Background downloads

While the app is in front, the download runs in JavaScript (`fetch` stream, resumable, checked against the manifest). **When the app goes to the background the system may stop it**; the download is cut, the partly written file stays, and it continues from there when the app is in front again (`useLocationRegion` checks again on return). The package does not download while the app is suspended or closed.

An experiment on an iPhone 11 (iOS 26) with `expo-file-system`'s `DownloadTask` (`sessionType: 'background'`, the default on iOS) showed that the system **does** keep a download going while the app is in the background: a 66 MB file served at 2 MB/s went on at the same speed after the app was sent to Settings, and finished (and woke the app) in the background. On Android the same API ignores `sessionType`; a download there needs a foreground service, which `expo-file-system` does not offer. Using `DownloadTask` for pack downloads would give iOS background downloads but changes the resume and pause logic that is tested today, so it is not done yet.

A pack that fails its SHA-256 or whose manifest signature is wrong is rejected and the previous version stays in use. Files are replaced only after the new one is complete.

### Packs inside the app

The packs can also ship inside the app instead of being downloaded. Pass a `net` that answers from the app bundle (`GeoNativeConfig.net`) and point `manifestUrl` at it. The Kargoio courier app does this with the Bursa pack, so the first launch already works without a network. Copy only the plain files and pass `zstd: false`; otherwise the SDK asks for the `.zst` copies the manifest lists. `app.plugin.cjs` is not involved; the app's own build copies the files into its assets.

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
- The tile, business and overview tiles keep only what the map style can draw (step `karo budama`): every theme, brand mode and label language of the SDK style is checked at the whole zoom each tile is drawn at, and properties no layer reads are dropped. Glyph ranges no label uses are emptied. `GEO_PRUNE=0` builds without it.
- `GEO_TILE_FORMAT=mlt` (step `karo kodlama`) turns the map and business tiles into MapLibre Tiles with the pinned `mlt` tool (`pipeline/tools.lock.json`, installed by `pipeline/setup.sh`). Archives are named `*.mlt.pmtiles`; the style marks them `encoding: 'mlt'` and the manifest asks for SDK 0.6.0. MapLibre Native reads them (Android 13.6.1, iOS 6.31.0 and newer); MapLibre GL JS before 6 does not, so web previews of such packs need GL JS 6. Feature ids are dropped first (the style never reads them) because the MapLibre Native decoders in Android 13.6.1 and iOS 6.31.0 cannot read the plain integer streams the encoder uses for large ids; FastPFOR and FSST are switched off for the same reason. `npm run mlt:check -- dist/packs` fetches that decoder's sources (pinned and hash-checked in `pipeline/mlt-native.lock.json`), builds it with FastPFOR off like the phone libraries and decodes every tile of every `*.mlt.pmtiles` in the manifest; run it whenever the `mlt` tool or the MapLibre Native version changes. Not the default: build it, run the check, look at it on a device, then switch. When the style starts to read something new, `test/map/prune-profile.test.ts` fails: rebuild the packs and run `npx tsx scripts/prune-profile.ts --write`.
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
app.plugin.cjs   Expo config plugin (registers MapLibre)
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

### Testing on a device

The example app can run tests without touching the screen. `npm run device-run` leaves a job on the pack server (`POST /run`) and starts the app on the simulator or the phone; the test screen picks the job up (`GET /run`, polled every 3 seconds), runs the listed tests and sends the report back (`POST /report`, local network only, at most 5 MB). The server writes it to the report folder as JSON and Markdown. A `geoornek://run?ids=...` link does the same when opened by hand.

```
npm run serve:packs -- dist/packs
npm run device-run -- --target sim --ids sdk.map-open,sdk.offline-search --app
npm run device-run -- --target sim --ids sdk.perf-map-open --location 41.0,29.03 --rss
npm run device-run -- --target phone --ids auto
```

| Flag | Meaning |
|---|---|
| `--target` | `sim` (booted simulator) or `phone` (`--udid` to pick one) |
| `--ids` | Test ids separated by commas, or `auto` for every automatic test |
| `--app` | Also open the app tab at start (location and download hooks run) |
| `--location lat,lon` | Simulator only: grant location and set the position first |
| `--rss` | Simulator only: print the highest memory use of the app during the run |
| `--fresh` | Simulator only: stop the app before opening the link |
| `--timeout s` | How long to wait for the report (default 900) |

The command exits with 1 when a test fails or no report arrives. The phone must be unlocked.

## Data sources and credits

- Map data © OpenStreetMap contributors, ODbL.
- Base map tiles: Protomaps builds of OpenStreetMap.
- Places: Overture Maps Foundation (CDLA-Permissive-2.0, Apache-2.0, CC0). Phone numbers, e-mail and web addresses are dropped at build time.
- Fonts and sprites ship in the base pack.

Apps that show the map decide where the credit line goes. `t(lang, 'attribution.text')` returns the text in six languages and `GeoAttribution` is an optional small overlay.

## Access and licence

This repository and the packs built from it are private to Yuksi. The package is marked `UNLICENSED`: no one may use, copy or distribute it without written permission, see `LICENSE`. Access to the repository is given per person, and the data packs are only accepted by apps that carry the matching public key, so a copy of the code alone cannot read or replace Yuksi data.
