import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { blocksOf } from '../../pipeline/build/blocks';
import { assemblePacks, type RegionInput } from '../../pipeline/build/manifest';
import { applyPatch, archivePack, compareVersions, encodePatch, listArchive, makePatches, patchKeep, PATCH_KEEP_BELOW, pruneArchive, zstdPatchTool, type PatchFile, type PatchTool } from '../../pipeline/build/patches';
import { validatePacks } from '../../pipeline/validate/validate-packs';
import { readPatchIndex } from '../../src/core/packs/patch';
import { parseManifest } from '../../src/core/region/manifest';

const shape = { segment: 64 * 1024, margin: 32 * 1024 };
const sha = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const noise = (length: number, seed = 'a'): Buffer => {
  const parts: Buffer[] = [];
  let total = 0;
  for (let i = 0; total < length; i++) {
    const part = createHash('sha256').update(`${seed}${i}`).digest();
    parts.push(part);
    total += part.length;
  }
  return Buffer.concat(parts).subarray(0, length);
};
const edited = (source: Buffer, at: number, patch: Buffer, drop = patch.length): Buffer => Buffer.concat([source.subarray(0, at), patch, source.subarray(at + drop)]);

const roots: string[] = [];
const temp = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'patch-'));
  roots.push(dir);
  return dir;
};
afterAll(() => roots.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const MB = 1024 * 1024;
const OLD = noise(Math.round(1.2 * MB));

describe('encodePatch and applyPatch', () => {
  it('rebuilds the new file exactly from the old one', async () => {
    const tmp = temp();
    const next = edited(OLD, 500_000, noise(200, 'x'));
    const patch = await encodePatch(OLD, next, zstdPatchTool, tmp, shape);
    expect(patch).not.toBeNull();
    expect(patch!.length).toBeLessThan(next.length * 0.1);
    expect(sha((await applyPatch(OLD, patch!, zstdPatchTool, tmp))!)).toBe(sha(next));
  });

  it('stays small when bytes are inserted and everything after shifts', async () => {
    const tmp = temp();
    const next = edited(OLD, 100_000, noise(70_000, 'y'), 0);
    const patch = await encodePatch(OLD, next, zstdPatchTool, tmp, shape);
    expect(patch!.length).toBeLessThan(next.length * 0.2);
    expect(sha((await applyPatch(OLD, patch!, zstdPatchTool, tmp))!)).toBe(sha(next));
  });

  it('stays small when bytes are removed', async () => {
    const tmp = temp();
    const next = edited(OLD, 300_000, Buffer.alloc(0), 90_000);
    const patch = await encodePatch(OLD, next, zstdPatchTool, tmp, shape);
    expect(patch!.length).toBeLessThan(next.length * 0.25);
    expect(sha((await applyPatch(OLD, patch!, zstdPatchTool, tmp))!)).toBe(sha(next));
  });

  it('writes the reference range of every slice into the index', async () => {
    const tmp = temp();
    const patch = (await encodePatch(OLD, edited(OLD, 10, noise(5, 'z')), zstdPatchTool, tmp, shape))!;
    const index = readPatchIndex(patch)!;
    expect(index.newSize).toBe(OLD.length);
    expect(index.oldSize).toBe(OLD.length);
    expect(index.slices).toHaveLength(Math.ceil(OLD.length / shape.segment));
    expect(index.slices[0]).toMatchObject({ refStart: 0 });
    for (const slice of index.slices) expect(slice.refStart + slice.refLength).toBeLessThanOrEqual(OLD.length);
  });

  it('copes with a new file much longer than the old one (slices with no reference)', async () => {
    const tmp = temp();
    const small = OLD.subarray(0, 100_000);
    const big = Buffer.concat([small, noise(400_000, 'tail')]);
    const patch = (await encodePatch(small, big, zstdPatchTool, tmp, shape))!;
    expect(readPatchIndex(patch)!.slices.some((slice) => slice.refLength === 0)).toBe(true);
    expect(sha((await applyPatch(small, patch, zstdPatchTool, tmp))!)).toBe(sha(big));
  });

  it('gives the same bytes every time', async () => {
    const next = edited(OLD, 500_000, noise(200, 'x'));
    const first = await encodePatch(OLD, next, zstdPatchTool, temp(), shape);
    const second = await encodePatch(OLD, next, zstdPatchTool, temp(), shape);
    expect(sha(first!)).toBe(sha(second!));
  });

  it('returns nothing for empty files or a failing tool', async () => {
    const tmp = temp();
    expect(await encodePatch(Buffer.alloc(0), OLD, zstdPatchTool, tmp, shape)).toBeNull();
    expect(await encodePatch(OLD, Buffer.alloc(0), zstdPatchTool, tmp, shape)).toBeNull();
    const broken: PatchTool = { compress: async () => false, decompress: async () => false };
    expect(await encodePatch(OLD, OLD, broken, tmp, shape)).toBeNull();
  });

  it('refuses a patch that does not fit the old file, is damaged, or decodes to the wrong length', async () => {
    const tmp = temp();
    const next = edited(OLD, 500_000, noise(200, 'x'));
    const patch = (await encodePatch(OLD, next, zstdPatchTool, tmp, shape))!;
    expect(await applyPatch(OLD.subarray(1), patch, zstdPatchTool, tmp)).toBeNull();
    expect(await applyPatch(OLD, patch.subarray(0, 30), zstdPatchTool, tmp)).toBeNull();
    const flipped = patch.slice();
    flipped[flipped.length - 5] = (flipped[flipped.length - 5] as number) ^ 0xff;
    const broken = await applyPatch(OLD, flipped, zstdPatchTool, tmp);
    expect(broken === null || sha(broken) !== sha(next)).toBe(true);
    const liar: PatchTool = { compress: zstdPatchTool.compress, decompress: async (_reference, _input, output) => (writeFileSync(output, 'x'), true) };
    expect(await applyPatch(OLD, patch, liar, tmp)).toBeNull();
  });
});

describe('versions and the archive', () => {
  it('orders versions by number, not by text', () => {
    expect(compareVersions('20261028.20261030.10', '20261028.20261030.9')).toBeGreaterThan(0);
    expect(compareVersions('20261028.20261030', '20261028.20261030.2')).toBeLessThan(0);
    expect(compareVersions('20261028.20261030', '20261028.20261030')).toBe(0);
    expect(compareVersions('20261029.20261030', '20261028.20261031')).toBeGreaterThan(0);
  });

  it('reads GEO_PATCHES as a version count, 3 by default, 0 to switch off', () => {
    const was = process.env.GEO_PATCHES;
    try {
      delete process.env.GEO_PATCHES;
      expect(patchKeep()).toBe(3);
      process.env.GEO_PATCHES = '5';
      expect(patchKeep()).toBe(5);
      process.env.GEO_PATCHES = '0';
      expect(patchKeep()).toBe(0);
      process.env.GEO_PATCHES = 'x';
      expect(patchKeep()).toBe(3);
      process.env.GEO_PATCHES = '';
      expect(patchKeep()).toBe(3);
      process.env.GEO_PATCHES = '-2';
      expect(patchKeep()).toBe(3);
    } finally {
      if (was === undefined) delete process.env.GEO_PATCHES;
      else process.env.GEO_PATCHES = was;
    }
  });
});

const sourcesOf = (day: string, build: string) => ({ osmFile: `turkey-${day.slice(2)}.osm.pbf`, osmMd5: 'a'.repeat(32), osmTimestamp: `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}T20:00:00Z`, tilesBuild: build, tilesOsmTime: '2026-10-22T04:00:00Z' });

function rig() {
  const dir = temp();
  const write = (name: string, content: Buffer): string => {
    const path = join(dir, 'in', name);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, content);
    return path;
  };
  const baseDir = join(dir, 'work', 'base');
  mkdirSync(baseDir, { recursive: true });
  writeFileSync(join(baseDir, 'overview.pmtiles'), 'base');
  const regionOf = (tiles: Buffer, route: Buffer, small: Buffer, tag: string): RegionInput[] => [
    {
      id: '34',
      tier: 'full',
      names: { tr: 'İstanbul' },
      bbox: [27.9, 40.7, 30, 41.7],
      stats: { addresses: 1, streets: 1, neighbourhoods: 1 },
      files: [
        { kind: 'tiles', source: write(`tiles-${tag}.pmtiles`, tiles) },
        { kind: 'route', source: write(`route-${tag}.bin`, route) },
        { kind: 'address', source: write(`address-${tag}.sqlite`, small) },
      ],
    },
  ];
  const publish = (out: string, build: string, regions: RegionInput[], extra: Record<string, unknown> = {}) =>
    assemblePacks({ outDir: out, sources: sourcesOf('20261020', build), regions, baseDir, keyDir: join(dir, 'keys'), minSdk: '0.5.0', ...extra });
  return { dir, regionOf, publish, packs: join(dir, 'packs'), archive: join(dir, 'archive'), cache: join(dir, 'cache'), tmp: join(dir, 'tmp') };
}

const tilesOf = (seed: string) => noise(Math.round(1.1 * MB), seed);

describe('patches for a kind that only manifest-v2 lists', () => {
  it('archives manifest-v2 with the release and patches the new kind against it', async () => {
    const w = rig();
    const part = (seed: string, tag: string): RegionInput => {
      const file = join(w.dir, `buildings2-${tag}.sqlite`);
      writeFileSync(file, seed === 'a' ? noise(Math.round(1.1 * MB), 'b2') : edited(noise(Math.round(1.1 * MB), 'b2'), 500_000, noise(300, 'edit')));
      return { id: '34', tier: 'full', names: { tr: 'İstanbul' }, bbox: [27.9, 40.7, 30, 41.7], stats: { addresses: 1, streets: 1, neighbourhoods: 1 }, files: [{ kind: 'address', source: join(w.dir, `a-${tag}.sqlite`) }, { kind: 'buildings2', source: file }] };
    };
    for (const tag of ['a', 'b']) writeFileSync(join(w.dir, `a-${tag}.sqlite`), noise(5000, 'addr'));
    await w.publish(w.packs, '20261022', [part('a', 'a')]);
    expect(archivePack(w.packs, w.archive)).toBe('20261020.20261022');
    const archived = readdirSync(join(w.archive, '20261020.20261022', '34'));
    expect(archived.some((f) => f.startsWith('buildings2-'))).toBe(true);
    expect(existsSync(join(w.archive, '20261020.20261022', 'manifest-v2.json'))).toBe(true);

    const out = join(w.dir, 'next');
    const result = await w.publish(out, '20261029', [part('b', 'b')], { patches: { archiveDir: w.archive, cacheDir: w.cache, tmpDir: w.tmp, shape, concurrency: 2 } });
    expect(result.patchStats).toMatchObject({ made: 1, unverified: 0 });
    const v2 = parseManifest(readFileSync(join(out, 'manifest-v2.json'), 'utf8'));
    expect(v2.regions[0]?.files.find((f) => f.kind === 'buildings2')?.patches).toHaveLength(1);
    const v1 = parseManifest(readFileSync(join(out, 'manifest-v1.json'), 'utf8'));
    expect(v1.regions[0]?.files.map((f) => f.kind)).toEqual(['address']);
    expect(listArchive(w.archive)[0]?.manifest.format).toBe(2);
  });
});

describe('patches in the published packs', () => {
  it('adds a verified patch beside a changed file, and leaves tiny or unchanged files alone', async () => {
    const w = rig();
    const tiles = tilesOf('t');
    const route = noise(Math.round(1.1 * MB), 'r');
    const small = noise(5000, 's');
    await w.publish(w.packs, '20261022', w.regionOf(tiles, route, small, 'a'));
    expect(archivePack(w.packs, w.archive)).toBe('20261020.20261022');

    const out = join(w.dir, 'next');
    const next = w.regionOf(edited(tiles, 600_000, noise(300, 'edit')), route, noise(5000, 'changed'), 'b');
    const result = await w.publish(out, '20261029', next, { patches: { archiveDir: w.archive, cacheDir: w.cache, tmpDir: w.tmp, shape, concurrency: 2 } });
    expect(result.patchStats).toMatchObject({ made: 1, unverified: 0, tooBig: 0, skippedSmall: 1 });

    const manifest = parseManifest(readFileSync(join(out, 'manifest-v1.json'), 'utf8'));
    const files = manifest.regions[0]!.files;
    const tilesFile = files.find((f) => f.kind === 'tiles')!;
    expect(tilesFile.patches).toHaveLength(1);
    const patch = tilesFile.patches![0]!;
    const oldSha = parseManifest(readFileSync(join(w.archive, '20261020.20261022', 'manifest-v1.json'), 'utf8')).regions[0]!.files.find((f) => f.kind === 'tiles')!.sha256;
    expect(patch).toMatchObject({ from: oldSha, codec: 'zstd-patch-seg', segment: shape.segment, margin: shape.margin });
    expect(patch.path).toBe(`34/patches/tiles-${tilesFile.sha256.slice(0, 8)}-from-${oldSha.slice(0, 8)}.zpatch`);
    expect(statSync(join(out, patch.path)).size).toBe(patch.size);
    expect(sha(readFileSync(join(out, patch.path)))).toBe(patch.sha256);
    expect(patch.size).toBeLessThan(tilesFile.size * PATCH_KEEP_BELOW);
    expect(patch.blocks).toBeUndefined();
    expect(files.find((f) => f.kind === 'route')!.patches).toBeUndefined();
    expect(files.find((f) => f.kind === 'address')!.patches).toBeUndefined();

    const old = readFileSync(join(w.archive, '20261020.20261022', manifest.regions[0]!.files.find((f) => f.kind === 'tiles')!.path.replace(tilesFile.sha256.slice(0, 8), oldSha.slice(0, 8))));
    const rebuilt = await applyPatch(old, new Uint8Array(readFileSync(join(out, patch.path))), zstdPatchTool, temp());
    expect(sha(rebuilt!)).toBe(tilesFile.sha256);
  });

  it('gives the same manifest and patch bytes when the build is repeated from scratch', async () => {
    const w = rig();
    const tiles = tilesOf('t');
    await w.publish(w.packs, '20261022', w.regionOf(tiles, noise(2000, 'r'), noise(2000, 's'), 'a'));
    archivePack(w.packs, w.archive);
    const next = w.regionOf(edited(tiles, 700_000, noise(100, 'e')), noise(2000, 'r'), noise(2000, 's'), 'b');
    const run = async (name: string, cache: string) => {
      const out = join(w.dir, name);
      await w.publish(out, '20261029', next, { patches: { archiveDir: w.archive, cacheDir: cache, tmpDir: w.tmp, shape } });
      return { manifest: readFileSync(join(out, 'manifest-v1.json'), 'utf8'), patches: readdirSync(join(out, '34', 'patches')).map((n) => sha(readFileSync(join(out, '34', 'patches', n)))) };
    };
    const first = await run('one', join(w.dir, 'cache-one'));
    const second = await run('two', join(w.dir, 'cache-two'));
    expect(second).toEqual(first);
    expect(first.patches).toHaveLength(1);
  });

  it('uses the cache the second time and still lists the patch', async () => {
    const w = rig();
    const tiles = tilesOf('t');
    await w.publish(w.packs, '20261022', w.regionOf(tiles, noise(2000, 'r'), noise(2000, 's'), 'a'));
    archivePack(w.packs, w.archive);
    const next = w.regionOf(edited(tiles, 700_000, noise(100, 'e')), noise(2000, 'r'), noise(2000, 's'), 'b');
    const options = { patches: { archiveDir: w.archive, cacheDir: w.cache, tmpDir: w.tmp, shape } };
    const first = await w.publish(join(w.dir, 'one'), '20261029', next, options);
    const second = await w.publish(join(w.dir, 'two'), '20261029', next, options);
    expect(first.patchStats).toMatchObject({ made: 1, cached: 0 });
    expect(second.patchStats).toMatchObject({ made: 0, cached: 1 });
    expect(readFileSync(join(w.dir, 'two', 'manifest-v1.json'), 'utf8')).toBe(readFileSync(join(w.dir, 'one', 'manifest-v1.json'), 'utf8'));
  });

  it('skips a patch that is not smaller enough than a full download, and remembers that', async () => {
    const w = rig();
    await w.publish(w.packs, '20261022', w.regionOf(tilesOf('old'), noise(2000, 'r'), noise(2000, 's'), 'a'));
    archivePack(w.packs, w.archive);
    const next = w.regionOf(tilesOf('completely-new'), noise(2000, 'r'), noise(2000, 's'), 'b');
    const options = { patches: { archiveDir: w.archive, cacheDir: w.cache, tmpDir: w.tmp, shape } };
    const first = await w.publish(join(w.dir, 'one'), '20261029', next, options);
    expect(first.patchStats).toMatchObject({ made: 0, tooBig: 1 });
    const second = await w.publish(join(w.dir, 'two'), '20261029', next, options);
    expect(second.patchStats).toMatchObject({ made: 0, tooBig: 1 });
    const manifest = parseManifest(readFileSync(join(w.dir, 'two', 'manifest-v1.json'), 'utf8'));
    expect(manifest.regions[0]!.files.every((f) => f.patches === undefined)).toBe(true);
    expect(existsSync(join(w.dir, 'two', '34', 'patches'))).toBe(false);
  });

  it('drops a patch that does not rebuild the file when applied back', async () => {
    const w = rig();
    const tiles = tilesOf('t');
    await w.publish(w.packs, '20261022', w.regionOf(tiles, noise(2000, 'r'), noise(2000, 's'), 'a'));
    archivePack(w.packs, w.archive);
    const next = w.regionOf(edited(tiles, 700_000, noise(100, 'e')), noise(2000, 'r'), noise(2000, 's'), 'b');
    const lying: PatchTool = { compress: zstdPatchTool.compress, decompress: async (reference, input, output) => ((await zstdPatchTool.decompress(reference, input, output)) ? (writeFileSync(output, Buffer.concat([readFileSync(output).subarray(1), Buffer.from([0])])), true) : false) };
    const logs: string[] = [];
    const result = await w.publish(join(w.dir, 'one'), '20261029', next, { patches: { archiveDir: w.archive, cacheDir: w.cache, tmpDir: w.tmp, shape, tool: lying, log: (line: string) => logs.push(line) } });
    expect(result.patchStats).toMatchObject({ made: 0, unverified: 1 });
    expect(logs.join('\n')).toMatch(/geri uygulanınca tutmadı/);
    const manifest = parseManifest(readFileSync(join(w.dir, 'one', 'manifest-v1.json'), 'utf8'));
    expect(manifest.regions[0]!.files.every((f) => f.patches === undefined)).toBe(true);
    expect(readdirSync(w.cache)).toEqual([]);
  });

  it('makes one patch per distinct older version, from the newest versions only', async () => {
    const w = rig();
    const tiles = tilesOf('t');
    const builds = ['20261022', '20261023', '20261024', '20261025'];
    let current = tiles;
    for (const build of builds) {
      current = edited(current, 200_000, noise(80, build));
      const out = join(w.dir, `pub-${build}`);
      await w.publish(out, build, w.regionOf(current, noise(2000, 'r'), noise(2000, 's'), build));
      archivePack(out, w.archive);
    }
    const latest = edited(current, 900_000, noise(80, 'latest'));
    const out = join(w.dir, 'latest');
    const options = { patches: { archiveDir: w.archive, cacheDir: w.cache, tmpDir: w.tmp, shape, keep: 3 } };
    await w.publish(out, '20261026', w.regionOf(latest, noise(2000, 'r'), noise(2000, 's'), 'z'), options);
    const patches = parseManifest(readFileSync(join(out, 'manifest-v1.json'), 'utf8')).regions[0]!.files.find((f) => f.kind === 'tiles')!.patches!;
    expect(patches).toHaveLength(3);
    const used = patches.map((p) => p.from);
    expect([...used].sort()).toEqual(used);
    const sources = ['20261025', '20261024', '20261023'].map((v) => parseManifest(readFileSync(join(w.archive, `20261020.${v}`, 'manifest-v1.json'), 'utf8')).regions[0]!.files.find((f) => f.kind === 'tiles')!.sha256);
    expect([...used].sort()).toEqual([...sources].sort());
  });

  it('passes the pack validator, and the validator catches damaged patches', async () => {
    const w = rig();
    const tiles = tilesOf('t');
    await w.publish(w.packs, '20261022', w.regionOf(tiles, noise(2000, 'r'), noise(2000, 's'), 'a'));
    archivePack(w.packs, w.archive);
    const out = join(w.dir, 'next');
    await w.publish(out, '20261029', w.regionOf(edited(tiles, 700_000, noise(100, 'e')), noise(2000, 'r'), noise(2000, 's'), 'b'), { patches: { archiveDir: w.archive, cacheDir: w.cache, tmpDir: w.tmp, shape } });
    const about = async () => (await validatePacks(out)).findings.filter((f) => f.where.includes('/patches/'));
    expect(await about()).toEqual([]);
    const summary = (await validatePacks(out)).summary;
    expect(summary.patchFiles).toBe(1);
    expect(summary.patchBytes).toBeGreaterThan(0);

    const manifest = parseManifest(readFileSync(join(out, 'manifest-v1.json'), 'utf8'));
    const patch = manifest.regions[0]!.files.find((f) => f.kind === 'tiles')!.patches![0]!;
    const path = join(out, patch.path);
    const original = readFileSync(path);
    writeFileSync(path, original.subarray(0, original.length - 3));
    expect((await about()).some((f) => f.level === 'error' && /boyut/.test(f.message))).toBe(true);
    const flipped = Buffer.from(original);
    flipped[flipped.length - 1] = (flipped[flipped.length - 1] as number) ^ 0xff;
    writeFileSync(path, flipped);
    expect((await about()).some((f) => f.level === 'error' && /sha256/.test(f.message))).toBe(true);
    rmSync(path);
    expect((await about()).some((f) => f.level === 'error' && /yok/.test(f.message))).toBe(true);
  });
});

describe('block hashes of big patches', () => {
  const big = { segment: MB, margin: MB / 2 };

  it('lists the block hashes of a patch over 8 MiB, which the validator checks', async () => {
    const w = rig();
    const tiles = noise(12 * MB, 'big');
    await w.publish(w.packs, '20261022', w.regionOf(tiles, noise(2000, 'r'), noise(2000, 's'), 'a'));
    archivePack(w.packs, w.archive);
    const out = join(w.dir, 'next');
    await w.publish(out, '20261029', w.regionOf(Buffer.concat([tiles, noise(9 * MB, 'tail')]), noise(2000, 'r'), noise(2000, 's'), 'b'), { patches: { archiveDir: w.archive, cacheDir: w.cache, tmpDir: w.tmp, shape: big } });
    const manifest = parseManifest(readFileSync(join(out, 'manifest-v1.json'), 'utf8'));
    const patch = manifest.regions[0]!.files.find((f) => f.kind === 'tiles')!.patches![0]!;
    expect(patch.size).toBeGreaterThan(8 * MB);
    expect(patch.blocks).toEqual(blocksOf(join(out, patch.path)));
    expect(patch.blocks!.sha256).toHaveLength(Math.ceil(patch.size / patch.blocks!.size));
    const about = async () => (await validatePacks(out)).findings.filter((f) => f.where.includes('/patches/'));
    expect(await about()).toEqual([]);

    const text = readFileSync(join(out, 'manifest-v1.json'), 'utf8');
    writeFileSync(join(out, 'manifest-v1.json'), text.replace(patch.blocks!.sha256[0]!, 'f'.repeat(64)));
    expect((await about()).some((f) => f.level === 'error' && /blok/.test(f.message))).toBe(true);
    const without = JSON.parse(text) as { regions: { files: { kind: string; patches?: { blocks?: unknown }[] }[] }[] };
    delete without.regions[0]!.files.find((f) => f.kind === 'tiles')!.patches![0]!.blocks;
    writeFileSync(join(out, 'manifest-v1.json'), JSON.stringify(without));
    expect((await about()).some((f) => f.level === 'error' && /blok/.test(f.message))).toBe(true);
  }, 120_000);
});

describe('archivePack, listArchive and pruneArchive', () => {
  it('copies the published files by version, once, and prunes the oldest', async () => {
    const w = rig();
    const versions = ['20261022', '20261023', '20261024'];
    for (const build of versions) {
      const out = join(w.dir, `pub-${build}`);
      await w.publish(out, build, w.regionOf(noise(3000, build), noise(3000, `r${build}`), noise(3000, 's'), build));
      expect(archivePack(out, w.archive)).toBe(`20261020.${build}`);
      expect(archivePack(out, w.archive)).toBe(`20261020.${build}`);
    }
    const listed = listArchive(w.archive);
    expect(listed.map((a) => a.version)).toEqual(['20261020.20261024', '20261020.20261023', '20261020.20261022']);
    expect(existsSync(join(w.archive, '20261020.20261024', '34'))).toBe(true);
    expect(readdirSync(w.archive).filter((name) => name.endsWith('.tmp'))).toEqual([]);
    expect(listArchive(w.archive, '20261020.20261023').map((a) => a.version)).toHaveLength(2);
    expect(pruneArchive(w.archive, 2, '20261020.20261024')).toEqual([]);
    expect(pruneArchive(w.archive, 1, '20261020.20261024')).toEqual(['20261020.20261022']);
    expect(existsSync(join(w.archive, '20261020.20261022'))).toBe(false);
    expect(existsSync(join(w.archive, '20261020.20261024'))).toBe(true);
    expect(listArchive(w.archive)).toHaveLength(2);
  });

  it('ignores a folder without a readable manifest and a missing archive', () => {
    const w = rig();
    expect(listArchive(join(w.dir, 'nothing'))).toEqual([]);
    mkdirSync(join(w.archive, 'broken'), { recursive: true });
    writeFileSync(join(w.archive, 'broken', 'manifest-v1.json'), '{');
    expect(listArchive(w.archive)).toEqual([]);
    expect(archivePack(join(w.dir, 'empty'), w.archive)).toBeNull();
  });

  it('archives nothing when there are no regions to take a version from', () => {
    const w = rig();
    mkdirSync(w.packs, { recursive: true });
    writeFileSync(join(w.packs, 'manifest-v1.json'), JSON.stringify({ format: 1, minSdk: '0.5.0', osm: { file: 'a', time: 't' }, tiles: { build: '20261022', time: 't' }, base: [], regions: [] }));
    expect(archivePack(w.packs, w.archive)).toBeNull();
  });

  it('makes no patches when there is nothing archived', async () => {
    const w = rig();
    const file: PatchFile = { regionId: '34', kind: 'tiles', path: '34/x', size: 2 * MB, sha256: 'a'.repeat(64), download: 2 * MB, source: join(w.dir, 'x') };
    const made = await makePatches([file], { outDir: w.packs, archiveDir: w.archive, cacheDir: w.cache, tmpDir: w.tmp });
    expect(made.patches.size).toBe(0);
    expect(made.stats).toMatchObject({ made: 0 });
  });
});
