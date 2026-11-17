# Pack formats and manifests

The parts that are downloaded to a phone for one province are separate files. Every part carries its own format version; the SDK opens only a version it knows.

## Parts

| Kind (`kind`) | File | Format (`meta.format`, `user_version`) | `application_id` | Manifest | Note |
|---|---|---|---|---|---|
| `address` | `<province>/address-<sha8>.sqlite(.zst)` | 2 | `0x59474f31` | v1, v2 | Streets, doors, neighbourhoods, district polygons, OSM places, the name index (`search_name`, `tri`). Derived street names (from business addresses, phase 4) are in the same table as street rows; there is no separate field. |
| `directory` | `<province>/directory-<sha8>.sqlite(.zst)` | 2 (same schema, extra tables `poi_info`, `info_text`, `tri_poi`) | `0x59474f31` | v1, v2 | The Overture business directory; queried together with the address pack. |
| `buildings` | `<province>/buildings-<sha8>.sqlite(.zst)` | 1 | `0x59474254` | v1, v2 | Old building points (only some provinces). Read by 0.7.x and later. |
| `buildings2` | `<province>/buildings2-<sha8>.sqlite(.zst)` | 2 | `0x59474232` | **v2 only** | Building layer: footprint, floor count, street chain, side, sequence, entrances, site. `minSdk` 0.8.0. |
| `route` | `<province>/route-<sha8>.bin(.zst)` | `docs/route-format.md` | | v1, v2 | |
| `tiles`, `places` | `.pmtiles` / `.mlt.pmtiles` | | | v1, v2 | |
| `learned` | `<province>/learned-<sha8>.sqlite(.zst)` | 1 | `0x59474c31` | **v2 only** | Central learning: delivered doors, building floor layout, entrance positions, new street name hints. No person and no time. `minSdk` 0.8.0. The device's own learning (`createLearning`, the local SQLite store) is separate and works together with this part. |

The SDK compares the `meta.format` value exactly (`2` for `address` and `directory`, `2` for `buildings2`); for any other value it does not open the part (`unsupported pack format`) and that province works only without that part. `user_version` and `application_id` exist to tell by hand (`sqlite3`) which kind and version a file is; the validator checks them.

### Street columns (`address` pack)

`street_name.sid`: the stable street id `S<plate>-<sha1(plate|key|type)[:10]>`. `street_part.src`: 0 OSM line, 1 line derived from door points (≥ 4 doors, mean direct deviation ≤ 15 m, length 30 m - 3 km, only streets that have no line at all). The derived line appears in the geometry of a street result and in number estimation, and is not used for building binding.

### Stable ids and the country base

The street id (`street_name.sid`) comes from an append-only registry file (`<work dir>/id-registry/<plate>.jsonl`: key `name~type`, id, the first 12 OSM way ids). If the key is in the registry the id stays the same; if not, and at least half of the way segments are shared with a registered street (the name has changed), the old id is kept, otherwise a new one is produced. The registry file is kept in the build environment; if it is lost the ids are produced again from the names (a second build of the same data gives the same result). The door id is produced at read time from the OSM id (`address.osm`) and the district id from the relation id; there is no column for them in the pack. `Place.sid` and `search.lookup(id)` use these; the old sequence-numbered `Place.id` resolves too.

The country base is not a separate pack kind: for a province that is not installed, the address pack with its door and business rows emptied (`scripts/build-country-base.ts`) resolves at street, neighbourhood and district level. The full address packs of 81 provinces are 114.8 MB, without doors 80.4 MB. `geo.regions.downloadCountry()` downloads the `address` part of every province that is not installed.

### Building numbers (`buildings2`)

The number of every building is computed at build time; there is no computation at run time. Anchors: OSM address points (preferred) and business directory addresses (only on a trace that has no OSM anchor, half weight). An anchor is placed on the building that contains the door or is within ≤ 25 m of it (directory ≤ 30 m) and whose candidates include the door's street. For every trace (street, segment, side) the parity is found from the majority of the anchors, and the direction and range from the order of the anchors; between anchors it is linear interpolation, outside them extension. A trace without anchors gets an estimate as the mirror of the opposite side that has anchors (opposite parity). An estimate farther than 40 numbers is not written. No estimate is exact (`approximate` stays).

### Neighbourhood and village units (`address` pack, `neighbourhood`)

`neighbourhood.source`: 0 OSM polygon, 1 from an address label, 2 from an OSM place node, 3 settlement point plus the official list (the polygon is derived from buildings), 4 in the official list and its position from the centre of the address evidence, 5 only in the official list (no position), 6 an OSM village that is not in the official list. Old packs contain only 0-2; the SDK does not branch on `source`. Optional columns: `sid` (stable id: `H<plate>R<relation>` for an OSM polygon, `H<plate><sha1(plate|district|name)[:8]>` for the others), `official` (bit 1 = the DASK list, bit 2 = the turkey-neighbourhoods list). Derived polygons are approximate (the convex hull of the building cluster plus 40 m).

### `buildings2` schema

| Table | Fields |
|---|---|
| `meta` | `format` = `2`, `province`, `osm` (source), `buildings` (row count), `min_area` (m²) |
| `building` | `id`, `gid` (Overture id), `lon`/`lat` (×1e6), `area` (m²), `ring` (vertices, numerically coded), `levels` and `lsrc` (1 `num_floors`, 2 OSM, 3 height, 4 region default), `height`, `name`, street binding: `chain` (`street_name.id` in the address pack), `comp` (the segment of the chain), `side` (+1 left, −1 right), `dist` (×10 m), `s` (m along the chain), `seq` (sequence), `chain2`/`chain3` (the two other nearest streets), optional `hood` (`neighbourhood.id` in the address pack), `road` and `road_dist` (×10 m; the nearest unnamed road for a building that cannot be bound to a named street, ≤ 150 m), number columns `num` (the number text known on the building), `nsrc` (1 OSM address point, 2 business directory), `pnum` (estimated number), `prad` (m), `pconf` (0-100), `pext` (1: not between anchors, extended from an end or from the opposite side) |
| `building_cell` | `cell` (0.0005° grid), `ids` (building ids, delta coded) |
| `street_range` | optional: for street, segment (`comp`) and side (`side`), `min`/`max` of the anchor numbers, `parity` (1 odd), estimated ends `pmin`/`pmax`, `anchors` (anchor count) and `quality` (1: one anchor, 2: two, 3: ≥ 3) |
| `road` | optional: unnamed road segments (`id`, `hood`, `geom`); only rows that are the `road` value of some building are written. These roads are not in the address pack, cannot be searched and no number estimate is made on them |
| `entrance` | OSM entrance nodes: `building`, position, `kind`, `ref`, `flats`, `unit` |
| `building_name` | buildings that have a name: `key` (`nameKey(name)`, at least 3 characters and 2 letters), `id`; `(key, id)` is the primary key, read with a prefix search. Optional table: older packs do not have it, and the SDK skips name search if it is missing. |
| `settlement` | site, village and neighbourhood nodes: name, kind, position, building count |

### `learned` schema

| Table | Fields |
|---|---|
| `meta` | `format` = `1`, `region`, `doors`, `layouts` |
| `door` | `key` (`province\|district\|neighbourhood\|street~type\|number`, from official names, the same as `learnKey`), `lng`/`lat` (×1e6), `trusted` (0/1), `sources` (number of independent sources), `spread` (m) |
| `layout` | `key` (the door key, `#block` for a building with blocks), `per` (flats per floor, 0 = not reliable), `basement`, `floors`, `fit` (%), `samples`, `ranges` (JSON `[floor, first flat, last flat]`) |
| `entrance` | `key`, `idx`, position, `sources` (≥ 2 independent sources, at most 4) |
| `hint` | a street that is not on the map: `district` (`nameKey`), `name`, position, `radius` (m), `sources`; derived from municipal/open data evidence (≥ 2 sources) or from directory businesses (a single business gives a 500 m radius, two or more 250-1500 m by spread); always `approximate` |
| `way` | optional: the street line of a `hint` (`district`, `name`, `line` JSON micro-degree points ≤ 60, `doors` JSON `[number, metres along the line]` ≥ 4); for a numbered query the position is estimated from the line (`interpolated`). Old readers do not see the table |

The list of tables and columns is fixed; there is **no** person, courier id, timestamp or individual delivery record (the validator checks the columns, the texts for phone/e-mail/id patterns and the meta keys). Rows are written in key order, and the same input gives the same bytes.

Delivery trace (phase 14): an export record can carry a `trace` (at most 30 points: `lng`, `lat`, `accuracyM`, `speed`, `t`) and `courierFloor`. `t` is the **number of seconds before the delivery** (0-600); a trace that carries an absolute timestamp is rejected. The trace enters no pack: `learned-stops.ts` reduces it to a single stop point (`stop`, a cluster with speed < 1 m/s, the one closest to the pin and to the map point; if there is none, the one closest to the confirmation GPS) and, if it is ≤ 15 m from a building edge, to an entrance candidate (`entrance`), and throws the trace away. Point rule v2: stop point > pin > confirmation GPS (if there is a stop point the confirmation GPS is not used, a pin ≤ 30 m away stays as a low-weight validator, a pin farther away is dropped). Floor: the floor the courier chose (`courierFloor`) is preferred to the address floor, if the two conflict the pair is dropped, and lower bounds such as "8+" do not enter learning. `deliveryStop` in the core (`src/core/learned/stops.ts`) also runs on the phone.

Production (`scripts/learned-build.ts`): the export from the delivery app `~/.yuksi-geo/gercek/<date>/records.jsonl` (format `pipeline/real/records.ts`: only whitelisted fields, otherwise the record is dropped) → record resolution with the province pack (typed names are turned into official names, unresolved ones become new street candidates) → merging (`pipeline/build/learned.ts`). Rules: GPS accuracy ≤ 30 m or a pin; weighted geometric median, with the weight decaying with a 26-week half-life; outliers > 50 m are dropped; trusted = ≥ 2 independent sources and a spread < 25 m, or the pin and the GPS agree within ≤ 25 m; a learned point that differs from an OSM door by > 25 m wins only with ≥ 3 independent sources; the point is pulled into the building within ≤ 20 m. A floor layout is learned from ≥ 2 sources and ≥ 3 distinct (floor, flat) pairs.

`chain` ids are bound to **the address pack of the same version**; the two parts are installed together and updated together (the same `version`). The validator checks that the chains are in the address pack.

## Manifests

| File | Format | Content | Who reads it |
|---|---|---|---|
| `manifest-v1.json` (+ `.sig`) | `format: 1` | only the old kinds: `address`, `tiles`, `route`, `buildings`, `places`, `directory` | SDKs 0.3.0 – 0.7.x; the 0.8.0 SDK reads it if there is no v2 |
| `manifest-v2.json` (+ `.sig`) | `format: 2` | all of v1 + the new kinds (`buildings2`); `minSdk` ≥ 0.8.0 | 0.8.0 and later; it asks for this first |

Rules:

1. **No new kind enters manifest-v1.json.** An old SDK rejected a manifest with an unknown kind entirely (`invalid file kind`), so new kinds are in a separate file. The build always writes v1 and writes v2 only if there is a new kind; v2 is a superset of v1 (the same paths and digests). The validator compares the two.
2. **The 0.8.0 SDK skips unknown kinds.** A file whose `kind` it does not recognise is ignored and the manifest is not rejected; this way later kinds do not break an old 0.8.x SDK. A kind it recognises in the wrong list (for example `base` in a region) is still an error. If `format` > 2 it is `manifest-newer`.
3. **SDK 0.8.0 asks for `manifest-v2.json` first**, and for `manifest-v1.json` if it gets a 404. Any other server error (503 etc.) does not fall back to v1, the same poll is counted as failed. The address in the app configuration may stay `manifest-v1.json`; the SDK tries v2 in the same folder. If the address is a different file name, only that one is requested.
4. The cached manifest is read in the same order (v2, then v1); an app upgraded from 0.7.x opens with the old cache without going to the network.
5. A new part (`buildings2`) is **not downloaded by itself** for an installed province: new installs include it in the default parts; for an installed province it is added with `geo.regions.download(id, { parts: [...installedParts, 'buildings2'] })`. If `buildings2` is not downloaded, search works as before, without the building layer.

## Format version rules

- An **additive** change to an existing part (a new table, a new optional column, a new `meta` key) does not raise the format version; an old SDK ignores it. If the meaning of a table or column changes, a **new kind** is opened (like `buildings` → `buildings2`) and the old kind keeps being published for old SDKs.
- Raising the format version makes that part unusable in old SDKs; in that case the manifest's `minSdk` is raised too.
- Two builds from the same source and the same code produce byte-identical files (`npx tsx scripts/measure-packs.ts --check determinism-adres` re-runs the address steps in a second work folder and compares the address, building and intermediate files by sha256; for the full build use `--check determinism`): rows are written sorted and the files have no timestamps (only `meta.osm_time`).

## Patches

The new kinds also enter the patch system of `docs/patch-format.md` (`patches[]`, `from` is the sha256 of the old file); there are no patches in the first release, and later releases carry patches against the previous three releases.
