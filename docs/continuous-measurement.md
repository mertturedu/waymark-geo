# Continuous measurement and improvement loop

## Weekly

`npm run data:release -- --regions=all --promote` downloads the new OSM file, builds the packs, compares the data (K8.2: loss of addresses, streets and route nodes) and then runs the **weekly measurement** (`scripts/weekly.ts`). If either fails, the release is not promoted into `dist/packs` (exit code 1). Use `--approve-regressions` to approve by hand and `--skip-weekly` to skip the measurement.

The weekly measurement measures the new release packs against fixed G sets (5 provinces, at most 300 G2 texts per province):

| Set | Measure |
|---|---|
| G2 / G2a | ≤ 15 / 30 / 50 m, street and neighbourhood correct, not found, median and p90 |
| G7 | place search first, in the top 3 |
| G8 | reverse search street correct, number exact, ±2 |
| Time | geocode p50 and p95 |
| Comparison | the **cached** answers of Nominatim and Photon to the same G2 texts (≤ 30 m); if the engines are not running, only the cached texts are compared |

Gate (`K18.2`): compared with the previous week, G2 ≤ 30 m and street correct may fall by at most 1 point, not found may rise by at most 0.5 points, G7 top 3 may fall by at most 1.5 points, G8 street by at most 2 points, and the p95 time may grow by at most 1.5 times (`WEEKLY_LIMITS`, `scripts/weekly-lib.ts`).

Outputs go to `~/Desktop/yuksi-geo-raporlar/haftalik/`: `<tag>.json` (machine readable, next week's baseline), `<tag>.md` (report, difference from the previous week) and `farklilik-<tag>.md` (**the difference queue**: the most frequent failing patterns, newly failing and fixed texts).

Running by hand: `npm run weekly -- --tag <release tag> [--plates 34,06] [--cap 300] [--baseline <previous .json>]`.

**Regression simulation:** `npm run weekly:simulate` deletes 1/8 of the streets from the release pack, runs the measurement again and checks that the gate stops the release.

## Monthly

`npm run monthly` (dry run): checks how fresh the comparison engines' data is (whether the map file imported into the comparison engines equals the current source, whether it is older than 35 days), prepares the import script for a new file if needed, and writes the request count for the external comparison service. **Nothing is sent to the external service.** The real run needs a confirmation every time: `npm run monthly -- --confirm --env <the app's .env file>`; only counts and medians go into the report, the service's answers are not written to disk, and the request history is tracked in `mapbox-gecmis.json`.

## Scheduling

`tools/launchd/com.yuksi.geo.weekly.plist` is an example launchd job that starts the weekly release on Tuesday at 03:00 (replace `KULLANICI` with the user name, copy it into `~/Library/LaunchAgents` and load it with `launchctl load`). It is not loaded; loading it runs the release build automatically every week on that machine.
