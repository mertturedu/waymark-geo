import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assemblePacks, ensureDevKey, signManifest, zstdCompress, encodeFile } from '../../pipeline/build/manifest';
import { validatePacks } from '../../pipeline/validate/validate-packs';
import { parseManifest, serializeManifest } from '../../src/core/region/manifest';
import type { Runner } from '../../pipeline/build/tiles';

const sources = { osmFile: 'turkey-261020.osm.pbf', osmMd5: 'a'.repeat(32), osmTimestamp: '2026-10-20T20:23:47Z', tilesBuild: '20261022', tilesOsmTime: '2026-10-22T04:00:00Z' };
const PLAIN = 'sokak adı '.repeat(30_000);
const runner: Runner = async () => ({ code: 0, out: '' });

async function packs() {
  const dir = mkdtempSync(join(tmpdir(), 'vz-'));
  const source = join(dir, 'in', 'address.sqlite');
  mkdirSync(join(source, '..'), { recursive: true });
  writeFileSync(source, PLAIN);
  const baseDir = join(dir, 'work', 'base');
  mkdirSync(baseDir, { recursive: true });
  writeFileSync(join(baseDir, 'overview.pmtiles'), 'genel harita');
  const outDir = join(dir, 'packs');
  await assemblePacks({ outDir, sources, regions: [{ id: '34', tier: 'full', names: { tr: 'İstanbul' }, bbox: [27.9, 40.7, 30, 41.7], stats: { addresses: 1, streets: 1, neighbourhoods: 1 }, files: [{ kind: 'address', source }] }], baseDir, keyDir: join(dir, 'keys'), minSdk: '0.5.0' });
  const manifest = parseManifest(readFileSync(join(outDir, 'manifest-v1.json'), 'utf8'));
  const file = manifest.regions[0]!.files[0]!;
  return { dir, outDir, manifest, file, encodedPath: file.encoded!.path, encodedFull: join(outDir, file.encoded!.path), keyDir: join(dir, 'keys') };
}

const about = async (root: string, where: string) => (await validatePacks(root, { run: runner })).findings.filter((f) => f.where === where);

describe('validatePacks with compressed files', () => {
  it('has nothing to say about a sound compressed file and counts it', async () => {
    const p = await packs();
    expect(await about(p.outDir, p.encodedPath)).toEqual([]);
    const { summary } = await validatePacks(p.outDir, { run: runner });
    expect(summary.encodedFiles).toBe(1);
    expect(summary.encodedBytes).toBe(p.file.encoded!.size);
  });

  it('reports a compressed file that is gone', async () => {
    const p = await packs();
    rmSync(p.encodedFull);
    expect((await about(p.outDir, p.encodedPath)).map((f) => f.message)).toEqual(['sıkıştırılmış dosya yok']);
  });

  it('reports a compressed file with a changed size or changed bytes', async () => {
    const cut = await packs();
    truncateSync(cut.encodedFull, cut.file.encoded!.size - 3);
    expect((await about(cut.outDir, cut.encodedPath))[0]?.message).toMatch(/sıkıştırılmış boyut uyuşmuyor/);
    const bent = await packs();
    const bytes = readFileSync(bent.encodedFull);
    bytes[bytes.length >> 1] = (bytes[bytes.length >> 1] as number) ^ 0xff;
    writeFileSync(bent.encodedFull, bytes);
    expect((await about(bent.outDir, bent.encodedPath))[0]?.message).toBe('sıkıştırılmış sha256 uyuşmuyor');
  });

  it('reports a compressed file that opens to other bytes than the real file even if its own checksum was updated', async () => {
    const p = await packs();
    const other = join(p.dir, 'other.bin');
    writeFileSync(other, PLAIN.replace('sokak', 'cadde'));
    const packed = await encodeFile(other, join(p.dir, 'cache'), zstdCompress);
    writeFileSync(p.encodedFull, readFileSync(packed!.path));
    const manifest = { ...p.manifest };
    manifest.regions[0]!.files[0]!.encoded = { codec: 'zstd', path: p.encodedPath, size: packed!.encoded.size, sha256: packed!.encoded.sha256 };
    const text = serializeManifest(manifest);
    writeFileSync(join(p.outDir, 'manifest-v1.json'), text);
    writeFileSync(join(p.outDir, 'manifest-v1.json.sig'), signManifest(text, readFileSync(join(p.keyDir, 'dev-signing.key'), 'utf8')));
    expect((await about(p.outDir, p.encodedPath)).map((f) => f.message)).toEqual(['zstd açılınca asıl dosyanın sha256 değeri çıkmıyor']);
  });

  it('reports data that is not zstd and warns about a compressed file that the manifest does not know', async () => {
    const p = await packs();
    const junk = Buffer.from('bu zstd değil, uzun bir metin');
    writeFileSync(p.encodedFull, junk);
    const manifest = { ...p.manifest };
    manifest.regions[0]!.files[0]!.encoded = { codec: 'zstd', path: p.encodedPath, size: junk.length, sha256: createHash('sha256').update(junk).digest('hex') };
    const text = serializeManifest(manifest);
    writeFileSync(join(p.outDir, 'manifest-v1.json'), text);
    writeFileSync(join(p.outDir, 'manifest-v1.json.sig'), signManifest(text, readFileSync(join(p.keyDir, 'dev-signing.key'), 'utf8')));
    expect((await about(p.outDir, p.encodedPath)).map((f) => f.message)).toContain('zstd açılınca asıl dosyanın sha256 değeri çıkmıyor');
    appendFileSync(join(p.outDir, '34', 'fazla.zst'), 'x');
    expect((await about(p.outDir, '34/fazla.zst'))[0]).toMatchObject({ level: 'warn' });
  });

  it('warns when the compressed file is not smaller', async () => {
    const p = await packs();
    const manifest = { ...p.manifest };
    manifest.regions[0]!.files[0]!.encoded = { ...p.file.encoded!, size: p.file.size + 1 };
    const text = serializeManifest(manifest);
    writeFileSync(join(p.outDir, 'manifest-v1.json'), text);
    writeFileSync(join(p.outDir, 'manifest-v1.json.sig'), signManifest(text, readFileSync(join(p.keyDir, 'dev-signing.key'), 'utf8')));
    const messages = (await about(p.outDir, p.encodedPath)).map((f) => f.message);
    expect(messages.some((m) => /küçük değil/.test(m))).toBe(true);
    void ensureDevKey;
  });
});
