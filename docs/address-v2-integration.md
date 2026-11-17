# Address v2: UI integration guide

The contract for the flow implemented in a courier app, for admin panel, business/seller and customer interfaces. The repositories of those interfaces are not touched; they build the same components on the server endpoints (`GeoClient`).

## Flag

`GET /v1/flags?user=<stable user id>` → `{ flags: { address_v2: boolean } }`. Server side: `GEO_FLAGS="address_v2=25"` (percent), `GEO_FLAGS_ALLOW="address_v2:u1|u2"`, `GEO_FLAGS_DENY="address_v2:u3"`. A user falls into the flag's percentage by a stable digest (the result stays the same while the id stays the same); if the percentage is only ever increased, nobody who has it on loses it. If the flag is `false` or no answer comes, the **old behaviour** runs. Send a digest of the id instead of a plain phone number.

## Flow (the same in all four interfaces)

| Step | Call | What to show |
|---|---|---|
| Suggestion | `autocomplete(text, { hints, near })` | label and evidence line (`Place.precision`, `source`) |
| Validation | `validate(text)` | `status`, `notes[0].message` (ready text in the user's language), `suggestions` |
| Band and radius | `resolve(text)` → `Place.radiusM`, `precision`, `approximate` | "Door point", "Estimated from neighbouring doors", "Only the street is known"; "within about N m" |
| Inside the building | `Place.unit` (`block`, `entrance`, `floor`, `door`) | "Block C, floor 3 (estimated, between 2 and 4), flat 7"; when the floor estimate has `source: 'model'` it is written as an estimate |
| Pin correction | the map's centre pin | save the point; on mobile `learn.confirm({ place, point, source: 'pin' })` |
| Arrival side | `route.route(from, to, { toPlace })` → `arrival.side` | "The destination is on the left/right of the road" |
| Identity | `Place.sid` | the id to store permanently; resolved back with `lookup(sid)` |

For every suggestion result and saved address, `coord_source` is written: `pin` (the user placed or corrected the pin), `gps` (the courier's delivery position), `geocode` (a search result), `manual` (a hand-entered coordinate). Only `pin` and `gps` enter learning.

Web interfaces use `createGeoClient` (`resolve`, `validate`, `autocomplete`, `lookup`, `resolveMany`, `validateCsv`); pin learning exists only in the SDK on the phone, no pin record is written to the server.

## Monitoring

Client counters arrive with `POST /v1/events` (`{ events: [{ name, count }] }`; name `[a-z0-9_.]{1,40}`, at most 50 events, each count ≤ 1000). Address text and location are **not sent**. They appear in `/metrics` as `geo_client_events_total{name}`. The courier app's counters:

| Name | Meaning |
|---|---|
| `v2.check.resolved`, `.ambiguous`, `.not_found`, `.region_missing` | resolution result of the task address |
| `v2.evidence.door`, `.neighbour`, `.street`, `.hood`, `.area`, `.business` | evidence distribution |
| `v2.offset_m.15`, `.30`, `.60`, `.150`, `.500`, `.over` | difference between the task coordinate and the resolution |
| `v2.pin.here`, `v2.pin.corrected` | pin saved and corrected (the correction rate) |
| `v2.delivery.stop`, `v2.delivery.fix` | whether the delivery point came from the trace's stop or from a single fix |
| `v2.target_trace_m.<bucket>` | distance between the target and the delivery point |
| `v2.floor.shown_model`, `.hit`, `.near`, `.miss` | the floor estimate compared with the courier's choice |

## Rollback

Setting `GEO_FLAGS` to `address_v2=0` on the server is enough; the app returns to the old flow at its next launch (or within 10 minutes at most). On the client it is turned off permanently with `EXPO_PUBLIC_GEO_ADDRESS_V2=off`.
