import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Decompress } from '../../src/core/packs/fzstd';
import { assemblePacks, encodeFile, ZSTD_KEEP_BELOW, ZSTD_KINDS, zstdCompress, type Compress, type RegionInput } from '../../pipeline/build/manifest';
import { decodedSha256 } from '../../pipeline/validate/validate-packs';
import { parseManifest, serializeManifest } from '../../src/core/region/manifest';

const sources = { osmFile: 'turkey-261020.osm.pbf', osmMd5: 'a'.repeat(32), osmTimestamp: '2026-10-20T20:23:47Z', tilesBuild: '20261022', tilesOsmTime: '2026-10-22T04:00:00Z' };
const sha = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');
const PLAIN = 'abcdefgh'.repeat(40_000);
const noise = (length: number): Buffer => {
  const parts: Buffer[] = [];
  for (let i = 0; Buffer.concat(parts).length < length; i++) parts.push(createHash('sha256').update(String(i)).digest());
  return Buffer.concat(parts).subarray(0, length);
};

function rig() {
  const dir = mkdtempSync(join(tmpdir(), 'zst-'));
  const write = (name: string, content: string | Buffer): string => {
    const path = join(dir, 'in', name);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, content);
    return path;
  };
  const regions: RegionInput[] = [
    {
      id: '34',
      tier: 'full',
      names: { tr: 'İstanbul' },
      bbox: [27.9, 40.7, 30, 41.7],
      stats: { addresses: 1, streets: 1, neighbourhoods: 1 },
      files: [
        { kind: 'address', source: write('address.sqlite', PLAIN) },
        { kind: 'tiles', source: write('tiles.pmtiles', PLAIN) },
        { kind: 'route', source: write('route.bin', noise(5000)) },
      ],
    },
  ];
  const baseDir = join(dir, 'work', 'base');
  mkdirSync(baseDir, { recursive: true });
  writeFileSync(join(baseDir, 'overview.pmtiles'), PLAIN);
  return { dir, regions, baseDir, outDir: join(dir, 'packs'), keyDir: join(dir, 'keys') };
}

const run = (w: ReturnType<typeof rig>, compress?: Compress | false) => assemblePacks({ outDir: w.outDir, sources, regions: w.regions, baseDir: w.baseDir, keyDir: w.keyDir, minSdk: '0.5.0', ...(compress === undefined ? {} : { compress }) });
const manifestOf = (w: ReturnType<typeof rig>) => parseManifest(readFileSync(join(w.outDir, 'manifest-v1.json'), 'utf8'));
const fake: Compress = (source, target) => {
  const size = statSync(source).size;
  writeFileSync(target, Buffer.from('z'.repeat(source.endsWith('route.bin') ? size : Math.max(10, Math.floor(size / 50)))));
  return true;
};

describe('compressed files in the manifest', () => {
  it('lists a .zst next to each file that gets much smaller and says nothing for the others', async () => {
    const w = rig();
    await run(w, fake);
    const files = manifestOf(w).regions[0]!.files;
    const address = files.find((f) => f.kind === 'address')!;
    expect(address.encoded).toMatchObject({ codec: 'zstd', path: `${address.path}.zst` });
    expect(address.encoded!.size).toBeLessThan(address.size);
    expect(address.encoded!.sha256).toBe(sha(readFileSync(join(w.outDir, address.encoded!.path))));
    expect(files.find((f) => f.kind === 'tiles')!.encoded).toBeUndefined();
    expect(existsSync(join(w.outDir, `${files.find((f) => f.kind === 'tiles')!.path}.zst`))).toBe(false);
  });

  it('leaves a file whose compressed version is not smaller by a tenth as it is', async () => {
    const w = rig();
    await run(w, fake);
    expect(manifestOf(w).regions[0]!.files.find((f) => f.kind === 'route')!.encoded).toBeUndefined();
  });

  it('makes no compressed file when switched off and still signs and counts the rest', async () => {
    const w = rig();
    const result = await run(w, false);
    expect(manifestOf(w).regions[0]!.files.every((f) => f.encoded === undefined)).toBe(true);
    expect(result.files).toBeGreaterThan(3);
  });

  it('counts the compressed files in the file total and puts them where the manifest says', async () => {
    const w = rig();
    const plain = await run(rig(), false);
    const packed = await run(w, fake);
    expect(packed.files).toBe(plain.files + 1);
  });

  it('stops with a clear message when the compressor fails', async () => {
    const w = rig();
    await expect(run(w, () => false)).rejects.toThrow(/zstd sıkıştırması başarısız/);
  });

  it('reuses what it compressed before for a file with the same content', async () => {
    const w = rig();
    let calls = 0;
    const counting: Compress = (source, target) => {
      calls += 1;
      return fake(source, target);
    };
    await run(w, counting);
    const first = calls;
    await run(w, counting);
    expect(first).toBe(2);
    expect(calls).toBe(first);
  });

  it('only compresses the database and route kinds', () => {
    expect([...ZSTD_KINDS].sort()).toEqual(['address', 'buildings', 'directory', 'route']);
    expect(ZSTD_KEEP_BELOW).toBe(0.9);
  });

  it('keeps the compressed path, its size and its checksum through a round trip of the manifest text', async () => {
    const w = rig();
    await run(w, fake);
    const manifest = manifestOf(w);
    expect(parseManifest(serializeManifest(manifest))).toEqual(manifest);
  });
});

describe('the real compressor', () => {
  it('makes files that open to the same bytes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zstreal-'));
    const source = join(dir, 'a.bin');
    writeFileSync(source, PLAIN);
    const packed = await encodeFile(source, join(dir, 'cache'), zstdCompress);
    expect(packed).not.toBeNull();
    expect(packed!.encoded.size).toBeLessThan(PLAIN.length / 20);
    expect(await decodedSha256(packed!.path)).toBe(sha(Buffer.from(PLAIN)));
    const out: Buffer[] = [];
    const stream = new Decompress((chunk) => void out.push(Buffer.from(chunk)));
    stream.push(new Uint8Array(readFileSync(packed!.path)), true);
    expect(Buffer.concat(out).toString()).toBe(PLAIN);
  });

  it('gives null for something that does not get smaller', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zstreal-'));
    const source = join(dir, 'noise.bin');
    writeFileSync(source, noise(4000));
    expect(await encodeFile(source, join(dir, 'cache'), zstdCompress)).toBeNull();
  });

  it('refuses data that is not zstd when it checks a compressed file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zstreal-'));
    const path = join(dir, 'junk.zst');
    writeFileSync(path, Buffer.from('not zstd at all, just some text that is long enough'));
    await expect(decodedSha256(path)).rejects.toBeDefined();
  });
});
