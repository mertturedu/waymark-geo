# Neighbourhood and postcode directory

An optional list of every neighbourhood (mahalle) and village of Turkey with its postcode. It adds three things to address search and does nothing when it is not given:

- **Postcode to area.** A postcode in the text fills a missing province, and a missing district when the postcode belongs to one district only. The region is picked from it before any pack is read.
- **Postcode check.** `search.validate` adds a `postcode_mismatch` note (field `postcode`, a fix with the expected postcodes) when the typed postcode does not belong to the typed neighbourhood.
- **Neighbourhood suggestions.** The "did you mean" suggestion for a neighbourhood also looks at this list, so names that the map data does not carry are still offered. A neighbourhood the map data already has is never replaced.

Results also gain `components.postcode` when the map data has none and the neighbourhood has exactly one postcode.

## The data is not part of the SDK

The SDK ships the reader and the builder only. The data itself is yours to bring, and its licence is yours to check before it is distributed. `dist/` is ignored by git, so a built pack stays out of the repository.

## Input

A CSV with the header `city,district,neighborhood,postcode`.

```
city,district,neighborhood,postcode
İstanbul,Kadıköy,Moda,34710
Niğde,Çiftlik,Alışlı Mah (Çınarlı Köyü),51802
```

City and district names are matched with the SDK's own province and district list, in any case and with or without Turkish letters. A village neighbourhood may carry its village in brackets.

## Build

```
npm run data:neighbourhoods -- --csv <file> --source "<where the data comes from>" [--out dist/neighbourhoods] [--strict]
```

Rows are rejected, not guessed, and counted by reason in `dist/neighbourhoods-report.json`: `unknown_province`, `unknown_district`, `ambiguous_district`, `bad_postcode` (not five digits), `plate_mismatch` (the postcode does not start with the province plate), `empty_name` and `duplicate`. `--strict` fails the run when any row was rejected.

The output is `index.json` (postcode to areas) and one `<plate>.json` per province, grouped by district and postcode. Output is deterministic; the checksum printed by the build changes only when the data does.

## Use

```ts
import { createGeo, createNeighbourhoods } from '@waymark/geo';

const geo = await createGeo(config, {
  ...env,
  neighbourhoods: { index, load: async (plate) => readShard(plate) },
});
```

`index` is the parsed `index.json` and `load` returns the parsed shard of a province or `null`. How the files reach the device (bundled, downloaded, read from disk) is up to the app. Shards are read when a province is first asked about; the last six stay in memory.

`createNeighbourhoods(source)` can also be used on its own:

| Call | Answer |
| --- | --- |
| `areasOf(postcode)` | the `{ plate, district }` areas of a postcode (synchronous) |
| `list(plate, district?)` | all neighbourhoods |
| `find(plate, district, text)` | neighbourhoods matching the text, however it is written |
| `suggest(plate, district, text, limit?)` | close spellings; empty when the name exists |
| `postcodeOf(plate, district, text)` | the postcode, only when it is unique |
| `fillArea(parsed)` | a parsed address with province and district filled from its postcode |
| `checkPostcode(parsed, plate, district?)` | `{ typed, expected }` when the postcode does not fit |

`hoodKey(text)` is the matching key: lower case, Turkish letters folded, `Mah.`, `Mahallesi`, `Köyü`, `Beldesi` and a bracketed village note removed.

## Measure

```
npx tsx scripts/measure-neighbourhoods.ts dist/neighbourhoods
```

Prints shard load time, `find` and `suggest` latency, how often a real name is found with its right postcode, and the memory the directory holds.
