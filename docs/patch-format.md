# Patch format (differential updates)

A patch is an optional speed-up. If it is missing, corrupt or cannot be applied, the SDK downloads the same file in full. A file with the patch applied is byte for byte identical to the fully downloaded one (its sha256 must match the value in the manifest).

## Manifest record

An optional `patches` array is added to a file record (region files in `files[]`, not `base[]`):

```json
{
  "kind": "tiles",
  "path": "34/tiles-6f086fc5.mlt.pmtiles",
  "size": 47090000,
  "sha256": "<new file>",
  "patches": [
    { "from": "<sha256 of the old file>", "codec": "zstd-patch-seg", "path": "34/patches/6f086fc5-from-e54e9d46.zpatch", "size": 8200000, "sha256": "<patch file>", "blocks": { "size": 4194304, "sha256": ["<block 1>", "<block 2>"] }, "segment": 8388608, "margin": 4194304 }
  ]
}
```

| Field | Meaning |
|---|---|
| `from` | The sha256 of the old file the patch applies to (not a version name). The patch whose digest matches the file on the phone is chosen. |
| `codec` | For now only `zstd-patch-seg`. Any other value makes the patch invalid. |
| `path` | Path of the patch file (`checkPath` rules; it cannot equal the file's own path or its `encoded` path). |
| `size`, `sha256` | Size (> 0) and digest of the patch file. |
| `blocks` | Optional. 4 MiB block digests of the patch file (`{ size, sha256[] }`, the same shape as `blocks` in the file record); written only for patches larger than 8 MiB. The block count must be `ceil(size / blocks.size)`; otherwise the patch record is dropped. The phone verifies a large patch with these blocks (native digest) and does not compute a full-file digest in JS. |
| `segment` | Output slice size (bytes, > 0). Default 8 MiB. |
| `margin` | Margin added to the reference in the old file (bytes, >= 0). Default 4 MiB. |

The signature covers the whole manifest; patches are not signed separately.

### Reader rules

- A corrupt patch record does not make the manifest rejected: only that record is dropped (wrong type, bad digest, `from` equal to the file's own digest, invalid path, zero size, missing field).
- If the same `from` or the same `path` appears twice, the first stays.
- If no usable patch remains, the `patches` field is not created at all.
- If `patches` is not an array it is ignored.
- Old SDKs ignore an unknown field in a file record, so a manifest with patches does not break them (verified by running with the pre-0.6.0 pin `6d5832b`).

## Patch file (`.zpatch`)

Numbers are little endian.

| Offset | Size | Meaning |
|---|---|---|
| 0 | u32 | magic number `0x54504759` (`YGPT`) |
| 4 | u16 | version (1) |
| 6 | u16 | flags (0) |
| 8 | u32 | length of the new file |
| 12 | u32 | length of the old file |
| 16 | u32 | slice count `n` |

An index of `n` records follows immediately, 16 bytes each: `u32 output length`, `u32 reference start`, `u32 reference length`, `u32 frame size`. Then the zstd frames of the slices one after another, in the order of the index.

- Slice `i` fills the range `[Σ previous lengths, +length)` of the output; the last slice carries the rest.
- The reference is the range `[start, start + length)` of the old file and is given to zstd as a prefix (`refPrefix`). Because the range is written explicitly in the index, the producer can correct the drift per slice; the applier only follows the index.
- Producer default: `start = i·segment − margin`, length `segment + 2·margin` (clipped to the file bounds).
- The applier checks that every range in the index stays inside the file, that the sum of the output lengths matches the new size and that the sum of the frame sizes matches the end of the file; otherwise the patch is invalid and a full download follows.
- If the sha256 of the resulting file does not match the `sha256` in the manifest, the patch is dropped and a full download follows.

## Production (data pipeline)

In the release step of `npm run data:build` (`pipeline/build/orchestrate.ts`, `pipeline/build/patches.ts`):

1. The published `dist/packs` (the previous release) is archived under `dist/archive/<release>/` with hard links: the plain form of the manifest and region files (`.zst` files and patches do not enter the archive, so almost no disk is used). The last `GEO_PATCHES` (default 3) releases stay in the archive, older ones are deleted. `GEO_PATCHES=0` turns off patch production and archiving.
2. For every region file of the new release, if any old release in the archive has a file of the same type in the same region with a **different digest** (one patch if the same old digest exists in two releases), a patch is produced. Files smaller than 1 MiB are not patched.
3. For every slice two candidate reference ranges are tried and the smaller result is chosen: the fixed position (`i·segment − margin`) and a position scaled by the old/new length ratio. The chosen range is written to the index. If the new file is longer than the old one, a slice with no reference becomes a plain zstd frame (`refLength = 0`).
4. Compression: `zstd -19 -T1 --long=26 --patch-from=<reference>` (single thread, the output is the same on every run). The window is 64 MiB and the reference is at most `segment + 2·margin` = 16 MiB.
5. Right after production, the patch is applied back to the old file slice by slice and the sha256 of the merged file is compared with the new file; a patch that does not match is dropped and does not enter the manifest.
6. A patch is dropped if it is larger than **85%** of the full file to be downloaded (of `encoded` if present). This decision is written to the cache (`.none`) and the same pair is not tried again.
7. Verified patches are written to `<plate>/patches/<type>-<new digest 8>-from-<old digest 8>.zpatch`; in the manifest they are listed in the file record, ordered by the `from` digest.

The cache is `dist/work/<date>/patch-cache/` (key: old digest, new digest, slice, margin, zstd level, window). On a re-run a verified patch is used as it is; if the cache is deleted the same bytes are produced again.

`pipeline/validate/validate-packs.ts` checks for every patch that the file exists, its size, its sha256, the validity of the header and slice index, and that the new file length agrees with the manifest.

## Applying (phone)

`applyPatchFile` in `src/core/packs/patch-apply.ts` turns a patch into the new file. There is no native code, Expo module or new dependency; the decoder is `decompressInPlaceSteps` in `src/core/packs/fzstd.ts` (zstd prefix support, the same JS on both platforms).

1. The patch header and slice index are read, and their consistency with the file sizes and the size of the old file are checked (`patch`/`old` errors).
2. The output file is reset. For every slice the reference range is read from the old file and the frame from the patch file, in 1 MiB pieces, into a single **reused** work buffer (`largest reference + largest slice`, at most 24 MiB in this format), and the frame is decoded into the buffer after the reference. A new buffer is not allocated per slice: on Hermes large buffers pile up before the garbage collector can keep up (about 115 MB with 16 slices, about 35 MB with reuse).
3. Decoding can pause per block (at most 128 KB): when `budgetMs` (default 8 ms) is used up, `pause()` is called so the JS thread is released. `pause()` is also called when a slice is finished.
4. The decoded slice is appended to the output file and progress is reported with `onProgress(done, total)`.
5. After all slices, the digest of the output is compared with the expected one: with the block digests if the file record has `blocks` (`HashPort.sha256Blocks`, native), otherwise with the full-file digest. For a large file the full-file digest is computed in JavaScript and blocks the JS thread for about 1.3 s per 2 MB (iPhone 11), so the block path is required for large files. If any step fails, the output file is deleted and the reason is returned: `patch` (patch corrupt/missing), `old` (the old file is missing or is not the patch's source), `decode` (zstd error), `sha256`, `io`. The caller then falls back to a full download (phase 4).

Peak memory: the work buffer + the largest frame (up to 8 MiB) + the 1 MiB read pieces, about 40 MiB.

## Update flow (SDK)

`src/core/packs/manager.ts`:

1. **Selection.** If a region file differs from the installed version and there is a `patches` record (`from`) that matches the sha256 of the installed file, the job type for that file is "patch", otherwise "full download". `PackConfig.patches: false` turns patches off completely. `base` files are never patched.
2. **Download.** The patch is downloaded through the same `downloadFile` path as a full file (resume, progress, sha256). `status(id).updateBytes` and `downloadBytes(id)` give the patch size; the UI shows this size in the update row. The total of the progress bar is the patch sizes.
3. **Apply.** `applyPatchFile` writes the new file under `.part/`, verifies the sha256 and then moves it under `files/`. The old file stays in place and readable until the update is finished (map and search keep working); the region record and the deletion of the old file happen last in `commit`, as before. The patch file is deleted after it is applied. If there is not enough space (the free space left is less than 1.2 times the new file), the patch is dropped and a full download follows; if that does not fit either, `no-space` is returned and the old files are kept.
4. **Fallback.** If the patch cannot be downloaded (404, HTTP error, sha256 mismatch) or cannot be applied (corrupt patch, old file corrupt/different, storage error), only that file is downloaded in full. If the network is completely down (`network`) or the user cancelled/paused, there is no fallback to a full download, the error is returned as it is (the job becomes `paused` or `error` and resumes where it stopped).
5. **Report.** `status(id).lastUpdate = { patched, fellBack, bytes }`: the number of files updated with a patch in the last job, the number of files for which a patch was tried and fell back to a full download, and the total bytes downloaded. It is kept in memory (not persistent); the app can write it to its own log if it wants.
6. **Cleanup.** Patch files listed in the manifest are not deleted by the startup scan (an interrupted download can resume), unlisted ones are deleted. When a region is removed its patches are removed too.
