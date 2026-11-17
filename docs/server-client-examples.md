# Server client: example calls

This file shows how to call the address server with `GeoClient` from a backend. It does not change any backend.

```ts
import { createGeoClient } from '@yuksi/geo/core';

const geo = createGeoClient({ baseUrl: process.env.GEO_URL!, key: process.env.GEO_KEY!, timeoutMs: 8000 });

// Bulk order check: up to 100 addresses in one request, with the same province hint.
const results = await geo.resolveMany(addresses, { hints: { city: 'İstanbul' } });
const fixable = results.filter((r) => r.status !== 'resolved');

// A customer's uploaded CSV file: the first column is the address, a header row ("adres") is skipped; up to 100 rows.
const checked = await geo.validateCsv(csvText, { hints: { city: 'Ankara' } });
for (const row of checked.rows) if (row.validation.notes.length > 0) console.log(row.row, row.address, row.validation.notes.map((n) => n.code));

// Saved address: store the stable id, it resolves even when the build changes.
const place = await geo.lookup('D34-n123456789');
const same = await geo.lookup(place!.id); // the old, sequence-numbered id resolves too

// Browsing: province → district → neighbourhood → street → number range.
const districts = await geo.admin({ province: '34' });
const hoods = await geo.admin({ district: districts.items[0]!.id });
const streets = await geo.admin({ hood: hoods.items[0]!.id });
const ranges = await geo.range(streets.items[0]!.id);
```

Ids: `D<plate>-<n|w|r><osm id>` is a door, `S<plate>-<digest>` a street, `H<plate>…` a neighbourhood, `I<plate>-r<relation>` a district. `Place.id` (e.g. `34:a:21588`) carries the build order and can shift in the next release; the value to store is `Place.sid`. Without a `sid` (a business, a building name) the result has no permanent id.
