# Licence summary

This page lists what the SDK and its data packs are built from and what each licence asks of the app. It is a working summary, not legal advice: the points marked **decision** are for Yuksi and its lawyer.

## What is in the package and in the packs

| Part | Source | Licence | What it asks |
|---|---|---|---|
| SDK code | Yuksi | proprietary (`LICENSE`, `UNLICENSED`) | no use without written permission |
| Map data in the base and province tiles, addresses, streets, roads for routing | OpenStreetMap contributors, through Protomaps builds and Geofabrik extracts | ODbL 1.0 | credit "© OpenStreetMap contributors"; **decision**: share-alike (below) |
| Business places and the directory pack | Overture Maps Foundation, release 2026-10-21.0 | CDLA-Permissive-2.0 for the places theme (some sources Apache-2.0 or CC0) | credit Overture Maps Foundation; phone numbers, e-mail and web addresses are dropped at build time |
| Map style code | `@protomaps/basemaps` 5.7.2 | BSD-3-Clause | keep the notice |
| Badge glyphs | Maki 8.2.0 and Temaki 5.13.0 | CC0 1.0 | none; they are dev dependencies, only the generated pictures ship |
| Brand badges | drawn by Yuksi from the chain name and colour | not official logos | brand names are trademarks of their owners; **decision** before the app shows them as official logos |
| Noto Sans glyph files (base pack) | Google Noto fonts through Protomaps assets | SIL OFL 1.1 | keep the licence with the fonts; do not sell the fonts alone |
| Inter glyph files (only with `GEO_FONT=inter`) | Inter 4.0, Rasmus Andersson | SIL OFL 1.1 | same as Noto; the files are built by `npm run fonts` and merged with Noto glyphs |
| Signing and hashing code | `@noble/curves`, `@noble/hashes` | MIT | keep the notice |
| Map view in the apps | `@maplibre/maplibre-react-native` | MIT | keep the notice |

Not checked in this repository: the licence of the Protomaps sprite pictures that come with the base pack. Check it before the packs are published.

## Credit line

The credit text is in six languages: `t(lang, 'attribution.text')`. `GeoAttribution` is an optional overlay; the app decides where the line goes. A shipped app must show it somewhere a user can find (an About screen is enough for OpenStreetMap).

## Points for a decision

1. **ODbL share-alike.** The province packs (addresses, streets, routing network, tiles) are a derived database of OpenStreetMap. Giving them to the public on a phone is "public use", which asks that the derived database be offered under ODbL too. A private pack server that only Yuksi apps can read does not remove that duty. Options a lawyer can weigh: offer the derived packs under ODbL on request, or keep the packs inside Yuksi's own apps only.
2. **Overture sources.** Places from other Overture sources carry their own licences. The build keeps the places theme under CDLA-Permissive-2.0; confirm that no kept row comes from a source with another licence before publishing.
3. **Brand names and chain badges.** Badges are drawn text on a brand colour. Show them as map symbols, not as the brands' own logos.
4. **Fonts.** OFL fonts may travel inside the packs; the licence text has to stay with them. If a font is chosen as the default, add its licence file to the base pack.
5. **Comparison tools.** The map comparison tool (`tools/map-compare` in the parent folder) runs Apple MapKit snapshots only on the developer's Mac, after each run is confirmed; nothing from it is stored in the SDK or the packs.

## Dependencies

Run `npm ls --all --prod` to list the shipped dependencies. At the time of writing the package has three: `@noble/curves`, `@noble/hashes` and `@protomaps/basemaps`; all others are peer dependencies the app brings.
