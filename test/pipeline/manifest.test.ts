import { createHash, createPublicKey, verify } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assemblePacks, ensureDevKey, signManifest, type RegionInput } from '../../pipeline/build/manifest';
import { parseManifest } from '../../src/core/region/manifest';

const sources = { osmFile: 'turkey-261020.osm.pbf', osmMd5: 'a'.repeat(32), osmTimestamp: '2026-10-20T20:23:47Z', tilesBuild: '20261022', tilesOsmTime: '2026-10-22T04:00:00Z' };
const sha256 = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');

function workspace() {
  const dir = mkdtempSync(join(tmpdir(), 'assemble-'));
  const put = (name: string, content: string): string => {
    const path = join(dir, 'in', name);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, content);
    return path;
  };
  const regions: RegionInput[] = [
    { id: '34', tier: 'full', names: { tr: 'İstanbul', en: 'Istanbul' }, bbox: [27.9, 40.7, 30, 41.7] as [number, number, number, number], stats: { addresses: 3, streets: 2, neighbourhoods: 1 }, files: [{ kind: 'address' as const, source: put('34-address.sqlite', 'adres paketi 34') }, { kind: 'tiles' as const, source: put('34.pmtiles', 'karo 34') }] },
    { id: '06', tier: 'basic', names: { tr: 'Ankara' }, bbox: [31.2, 38.9, 34, 40.6] as [number, number, number, number], stats: { addresses: 1, streets: 1, neighbourhoods: 1 }, files: [{ kind: 'address' as const, source: put('06-address.sqlite', 'adres paketi 06') }] },
  ];
  const baseDir = join(dir, 'base');
  mkdirSync(join(baseDir, 'sprites'), { recursive: true });
  writeFileSync(join(baseDir, 'overview.pmtiles'), 'genel harita');
  writeFileSync(join(baseDir, 'sprites', 'light.json'), '{}');
  return { dir, regions, baseDir, outDir: join(dir, 'packs'), keyDir: join(dir, 'keys') };
}

describe('ensureDevKey', () => {
  it('makes a key once, keeps it private and gives back only the public half', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'key-')), 'k');
    const first = ensureDevKey(dir);
    expect(first.created).toBe(true);
    expect(Object.keys(first)).toEqual(['publicKeyPem', 'created']);
    expect(first.publicKeyPem).toMatch(/BEGIN PUBLIC KEY/);
    expect(statSync(join(dir, 'dev-signing.key')).mode & 0o777).toBe(0o600);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    const second = ensureDevKey(dir);
    expect(second).toEqual({ publicKeyPem: first.publicKeyPem, created: false });
    expect(existsSync(join(dir, 'signing.key'))).toBe(false);
  });
});

describe('signManifest', () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'key-')), 'k');
  ensureDevKey(dir);
  const privatePem = readFileSync(join(dir, 'dev-signing.key'), 'utf8');
  const publicKey = createPublicKey(ensureDevKey(dir).publicKeyPem);

  it('signs the exact text so Ed25519 verifies it and any change breaks it', () => {
    const text = '{"format":1}\n';
    const signature = signManifest(text, privatePem);
    expect(signature.endsWith('\n')).toBe(true);
    const raw = Buffer.from(signature.trim(), 'base64');
    expect(raw.length).toBe(64);
    expect(verify(null, Buffer.from(text), publicKey, raw)).toBe(true);
    expect(verify(null, Buffer.from(text + ' '), publicKey, raw)).toBe(false);
    expect(signManifest(text, privatePem)).toBe(signature);
  });

  it('fails without showing what it was given as a key', () => {
    expect(() => signManifest('x', 'KEY-SECRET-TEXT')).toThrow(/imza anahtarı/);
    try {
      signManifest('x', 'KEY-SECRET-TEXT');
    } catch (error) {
      expect(String(error)).not.toContain('KEY-SECRET-TEXT');
    }
  });
});

describe('assemblePacks', () => {
  const run = (w: ReturnType<typeof workspace>) => assemblePacks({ outDir: w.outDir, sources, regions: w.regions, baseDir: w.baseDir, keyDir: w.keyDir, minSdk: '0.1.0' });

  it('copies each file under a name with its digest, lists them sorted by plate and signs the manifest', async () => {
    const w = workspace();
    const result = await run(w);
    const text = readFileSync(join(w.outDir, 'manifest-v1.json'), 'utf8');
    const manifest = parseManifest(text);
    expect(manifest.regions.map((r) => r.id)).toEqual(['06', '34']);
    expect(manifest.regions.map((r) => r.tier)).toEqual(['basic', 'full']);
    const istanbulAddress = manifest.regions[1]?.files.find((f) => f.kind === 'address');
    expect(istanbulAddress?.sha256).toBe(sha256('adres paketi 34'));
    expect(istanbulAddress?.path).toBe(`34/address-${sha256('adres paketi 34').slice(0, 8)}.sqlite`);
    expect(istanbulAddress?.size).toBe(Buffer.byteLength('adres paketi 34'));
    expect(readFileSync(join(w.outDir, istanbulAddress?.path as string), 'utf8')).toBe('adres paketi 34');
    expect(manifest.regions[1]?.files.find((f) => f.kind === 'tiles')?.path).toMatch(/^34\/tiles-[0-9a-f]{8}\.pmtiles$/);
    expect(manifest.regions[1]?.version).toBe('20261020.20261022');
    expect(manifest.base.map((f) => f.path)).toEqual(['base-20261022/overview.pmtiles', 'base-20261022/sprites/light.json']);
    expect(manifest.osm).toEqual({ file: 'turkey-261020.osm.pbf', time: '2026-10-20T20:23:47Z' });
    const signature = Buffer.from(readFileSync(join(w.outDir, 'manifest-v1.json.sig'), 'utf8').trim(), 'base64');
    expect(verify(null, Buffer.from(text), createPublicKey(readFileSync(join(w.outDir, 'dev-public-key.pem'))), signature)).toBe(true);
    expect(result.files).toBe(5);
    expect(readdirSync(w.outDir).filter((n) => n.endsWith('.tmp'))).toEqual([]);
  });

  it('builds a byte for byte equal folder on a second run from the same input', async () => {
    const a = workspace();
    const b = { ...workspace(), keyDir: a.keyDir };
    await run(a);
    await run(b);
    const listing = (dir: string): string[] =>
      readdirSync(dir, { recursive: true, withFileTypes: true })
        .filter((e) => e.isFile())
        .map((e) => `${join(e.parentPath, e.name).slice(dir.length)}:${sha256(readFileSync(join(e.parentPath, e.name)))}`)
        .sort();
    expect(listing(a.outDir)).toEqual(listing(b.outDir));
  });

  it('keeps the old manifest when a source file is missing and writes the new one last', async () => {
    const w = workspace();
    await run(w);
    const before = readFileSync(join(w.outDir, 'manifest-v1.json'));
    const broken = { ...w, regions: [{ ...w.regions[0]!, files: [{ kind: 'address' as const, source: join(w.dir, 'in', 'yok.sqlite') }] }, w.regions[1]!] };
    await expect(assemblePacks({ outDir: w.outDir, sources, regions: broken.regions, baseDir: w.baseDir, keyDir: w.keyDir, minSdk: '0.1.0' })).rejects.toThrow(/yok\.sqlite/);
    expect(readFileSync(join(w.outDir, 'manifest-v1.json'))).toEqual(before);
    expect(existsSync(join(w.outDir, 'manifest-v1.json.tmp'))).toBe(false);
  });

  it('links a file instead of copying it when both folders are on one disk', async () => {
    const w = workspace();
    await run(w);
    const manifest = parseManifest(readFileSync(join(w.outDir, 'manifest-v1.json'), 'utf8'));
    const target = join(w.outDir, manifest.regions[1]?.files[0]?.path as string);
    expect(statSync(target).nlink).toBeGreaterThanOrEqual(2);
    expect(statSync(target).ino).toBe(statSync(w.regions[0]!.files[0]!.source).ino);
  });

  it('refuses two regions with one plate', async () => {
    const w = workspace();
    await expect(assemblePacks({ outDir: w.outDir, sources, regions: [w.regions[0]!, w.regions[0]!], baseDir: w.baseDir, keyDir: w.keyDir, minSdk: '0.1.0' })).rejects.toThrow(/twice|iki kez/);
    expect(existsSync(join(w.outDir, 'manifest-v1.json'))).toBe(false);
  });
});
