import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assetList, buildManifest, formatDate, resolveBuildDate, seededBlob, verifyManifest } from '../../scripts/make-test-data';

const today = new Date(Date.UTC(2026, 9, 22, 12, 0, 0));

describe('formatDate', () => {
  it('writes UTC dates as YYYYMMDD', () => {
    expect(formatDate(new Date(Date.UTC(2026, 0, 5)))).toBe('20260105');
    expect(formatDate(new Date(Date.UTC(2026, 9, 22, 23, 59)))).toBe('20261022');
  });
});

describe('resolveBuildDate', () => {
  it('returns the newest date the probe accepts', async () => {
    const seen: string[] = [];
    const date = await resolveBuildDate(async (d) => { seen.push(d); return d === '20261019'; }, today, 10);
    expect(date).toBe('20261019');
    expect(seen).toEqual(['20261022', '20261021', '20261020', '20261019']);
  });

  it('only tries today when maxBack is 0', async () => {
    const seen: string[] = [];
    await expect(resolveBuildDate(async (d) => { seen.push(d); return false; }, today, 0)).rejects.toThrow('build bulunamadı');
    expect(seen).toEqual(['20261022']);
  });

  it('crosses month boundaries', async () => {
    const date = await resolveBuildDate(async (d) => d === '20260930', new Date(Date.UTC(2026, 9, 2)), 5);
    expect(date).toBe('20260930');
  });

  it('fails when nothing is found within the window', async () => {
    await expect(resolveBuildDate(async () => false, today, 3)).rejects.toThrow('build bulunamadı');
  });
});

describe('seededBlob', () => {
  it('is deterministic and has the requested size', () => {
    const a = seededBlob(42, 1000);
    expect(a).toHaveLength(1000);
    expect(a.equals(seededBlob(42, 1000))).toBe(true);
    expect(a.equals(seededBlob(43, 1000))).toBe(false);
  });

  it('does not repeat in short cycles', () => {
    const blob = seededBlob(7, 4096);
    expect(new Set(blob).size).toBeGreaterThan(200);
  });
});

describe('assetList', () => {
  it('lists three font stacks across all 256 ranges and the light and dark sprites', () => {
    const list = assetList();
    expect(list.filter((a) => a.path.startsWith('fonts/'))).toHaveLength(768);
    expect(list.filter((a) => a.path.startsWith('sprites/'))).toHaveLength(8);
    expect(list.map((a) => a.path)).toContain('fonts/Noto Sans Regular/1024-1279.pbf');
    expect(list.map((a) => a.path)).toContain('sprites/v4/dark@2x.png');
  });

  it('also lists every font under a space free folder name with the same source url', () => {
    const list = assetList();
    const compact = list.filter((a) => a.path.startsWith('fonts-compact/'));
    expect(compact).toHaveLength(768);
    const original = list.find((a) => a.path === 'fonts/Noto Sans Medium/768-1023.pbf');
    expect(compact.find((a) => a.path === 'fonts-compact/NotoSansMedium/768-1023.pbf')?.url).toBe(original?.url);
  });

  it('pins the assets repository commit and encodes spaces', () => {
    const first = assetList()[0] as { url: string };
    expect(first.url).toContain('028c18f713baecad011301ff7a69acc39bcc2ae7');
    expect(first.url).not.toContain(' ');
  });
});

describe('manifest', () => {
  const makeRoot = () => {
    const root = mkdtempSync(join(tmpdir(), 'geo-manifest-'));
    mkdirSync(join(root, 'sub'));
    writeFileSync(join(root, 'a.bin'), Buffer.from('hello'));
    writeFileSync(join(root, 'sub', 'b.bin'), Buffer.from('dünya'));
    return root;
  };

  it('hashes every file below the root except the manifest itself', async () => {
    const root = makeRoot();
    writeFileSync(join(root, 'manifest.json'), '{}');
    const manifest = await buildManifest(root, '20261020');
    expect(manifest.protomapsBuild).toBe('20261020');
    expect(manifest.files.map((f) => f.path)).toEqual(['a.bin', 'sub/b.bin']);
    expect(manifest.files[0]).toEqual({ path: 'a.bin', size: 5, sha256: createHash('sha256').update('hello').digest('hex') });
  });

  it('accepts a matching tree', async () => {
    const root = makeRoot();
    expect(await verifyManifest(root, await buildManifest(root, '1'))).toEqual([]);
  });

  it('reports changed size, changed content and missing files', async () => {
    const root = makeRoot();
    const manifest = await buildManifest(root, '1');
    writeFileSync(join(root, 'a.bin'), Buffer.from('HELLO'));
    writeFileSync(join(root, 'sub', 'b.bin'), Buffer.from('daha uzun içerik'));
    const problems = await verifyManifest(root, { ...manifest, files: [...manifest.files, { path: 'gone.bin', size: 1, sha256: 'x' }] });
    expect(problems).toEqual(['a.bin: sha256 uyuşmuyor', 'sub/b.bin: boyut uyuşmuyor', 'gone.bin: dosya yok']);
  });
});
