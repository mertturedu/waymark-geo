# Enrichment with a local model (phase 16B)

Two local models run on Ollama (`qwen3:14b`, `gemma3:12b`). The principle: the model **does not produce points, door numbers, streets or addresses**; it only gives a short, verifiable text answer. Every answer is measured against hidden ground truth, and whatever does not pass the threshold does not enter a pack.

## The only thing that enters a pack: the category → group mapping

`pipeline/data/category-groups-model.json` (category name → directory group). When the directory pack (`directory`) is built (`pipeline/build/directory.ts`), a business category that stays `other` after the rule dictionary is written with the group from this file, if it is listed there, and is marked with `poi_info.msrc = 1`.

- **How it is produced:** `npx tsx scripts/enrich-categories.ts` (1,330 categories; both models are asked with the category name and its classification path). There is no mapping unless the two models give the same group.
- **Threshold:** among the 468 categories on which the two models agree and which the rule dictionary already groups, the share equal to the rule is measured per group (hidden label). A group needs at least 5 samples and ≥ 95% precision: `shop` 98.7%, `health` 96.0%, `worship` 100% and `money` 100% passed; `food` (93.5%), `public` (92.3%), `market` (46.7%), `lodging` and `fuel` did not and did not enter the pack.
- **Accepted:** 142 categories (52 `shop`, 75 `health`, 14 `money`, 1 `worship`).

### Share
Model-sourced businesses: 75,440 / 1,709,816 (4.4%); of the 745,850 businesses that are `other` in the category list (81 provinces, counting each category once), 10.1%; 75,440 can be located. The `other` share in the directory falls from 43.5% to 39.1% (743,587 → 668,147).

### Size
Directory packs 418.8 → 420.5 MB (+1.7 MB, 0.41%; including the new `msrc` column and the door changes from building with today's parser). The download (zstd) size difference is in the same proportion.

### Reader
`poi_info.msrc` is an optional column (the format version 2 stays the same; old SDKs ignore it and older packs do not have it). In category search (such as `hospital Kadıköy`) the SDK ranks model-sourced businesses after the reliable rule-sourced ones (`Place` score × 0.95, and in a truncated list the rule-sourced ones come first) and marks them with `PoiInfo.model`.

### Rollback
1. Empty `groups` in `pipeline/data/category-groups-model.json` (or delete the file).
2. Run `npx tsx scripts/data-build.ts --regions=all --steps=rehber` (about 3 min) and `scripts/address-release.ts` (about 25 min) again.
3. Phones receive the directory pack as a patch (weekly update). Without the model `msrc` is always 0 and business groups are as in the rule dictionary.
To roll back a single category, delete that line from the file.

## Audit (A16B.5)
`npx tsx scripts/audit-model.ts`: category names are only `[a-z0-9_]`, the group is in the allowed list, there is no coordinate-like text; for three provinces (41, 16, 06) the directory pack is built without and with the model, and it is verified that name, location, door, street and info fields are identical, that only the group changes, and that the number of marked records equals the counted number.

## What does not enter a pack (measured, did not pass the threshold)
- **Alias generation** (`scripts/enrich-aliases.ts`): 171 streets, 211 suggestions; 5 (2.4%) equal to the hidden real alias; 0 among suggestions both models agree on. The spellings used (Cd., Sk.) are already in the parser; real aliases are mostly old names and cannot be predicted. None entered a pack.
- **Query rewriting** (`scripts/enrich-rewrite.ts`, build-time measurement only): of 150 failing texts 8 were fixed (5.3%), of 150 working texts 9 were broken (6.0%). It did not enter the SDK.
- **Broken name cleaning** (`pipeline/build/name-clean.ts`): of 185,731 street names, 1,231 can be fixed by rule and dictionary (case, double spaces, type spelling). Report only; not applied because it changes the name label.

## Reports
`~/Desktop/yuksi-geo-raporlar/kapsama/` (coverage map, weak areas, missing data) and `faz-16b-*.md` (category, alias, rewriting, before/after, audit).
