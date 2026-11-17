import { generateKeyPairSync, verify } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeAltPacks, swapFiles } from '../../scripts/make-alt-packs';
import { parseManifest, serializeManifest } from '../../src/core/region/manifest';
import { blob, makeWorld } from '../helpers/pack-world';

const fresh = () => {
  const world = makeWorld({ regions: [{ id: '34', parts: { address: blob(2_000, 1), tiles: blob(3_000, 2), places: blob(1_500, 3) } }] });
  return { world, manifest: world.publish() };
};

describe('swapFiles', () => {
  it('points one region part at a new file and keeps everything else', () => {
    const { manifest } = fresh();
    const before = manifest.regions[0]!.files.find((file) => file.kind === 'places')!;
    const { manifest: next, added } = swapFiles(manifest, [{ region: '34', kind: 'places', source: '/new/34.pmtiles' }], () => ({ sha256: 'ab'.repeat(32), size: 777, blocks: undefined }));
    const after = next.regions[0]!.files.find((file) => file.kind === 'places')!;
    expect(after).toMatchObject({ path: '34/places-abababab.pmtiles', sha256: 'ab'.repeat(32), size: 777 });
    expect(after.blocks).toBeUndefined();
    expect(added).toEqual([{ from: '/new/34.pmtiles', to: '34/places-abababab.pmtiles' }]);
    expect(manifest.regions[0]!.files.find((file) => file.kind === 'places')).toBe(before);
    expect(next.regions[0]!.files.filter((file) => file.kind !== 'places')).toEqual(manifest.regions[0]!.files.filter((file) => file.kind !== 'places'));
  });

  it('stops when the region or part is not in the manifest', () => {
    const { manifest } = fresh();
    expect(() => swapFiles(manifest, [{ region: '99', kind: 'places', source: 'x' }], () => ({ sha256: '', size: 0, blocks: undefined }))).toThrow(/il 99 places/);
  });
});

describe('makeAltPacks', () => {
  it('links the files, swaps the part and signs the new manifest with the given key', () => {
    const { manifest } = fresh();
    const source = mkdtempSync(join(tmpdir(), 'alt-src-'));
    const target = join(mkdtempSync(join(tmpdir(), 'alt-dst-')), 'k');
    writeFileSync(join(source, 'manifest-v1.json'), serializeManifest(manifest));
    mkdirSync(join(source, '34'));
    writeFileSync(join(source, '34', 'keep.bin'), 'keep');
    writeFileSync(join(source, 'dev-public-key.pem'), 'PUBLIC');
    const replacement = join(mkdtempSync(join(tmpdir(), 'alt-new-')), 'places.pmtiles');
    writeFileSync(replacement, 'brand new places file');
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const result = makeAltPacks(source, target, [{ region: '34', kind: 'places', source: replacement }], String(privateKey.export({ type: 'pkcs8', format: 'pem' })));
    expect(result).toEqual({ files: 2, added: 1 });
    const text = readFileSync(join(target, 'manifest-v1.json'), 'utf8');
    const places = parseManifest(text).regions[0]!.files.find((file) => file.kind === 'places')!;
    expect(places.size).toBe('brand new places file'.length);
    expect(readFileSync(join(target, places.path), 'utf8')).toBe('brand new places file');
    expect(readFileSync(join(target, '34', 'keep.bin'), 'utf8')).toBe('keep');
    expect(existsSync(join(target, 'dev-public-key.pem'))).toBe(true);
    const signature = Buffer.from(readFileSync(join(target, 'manifest-v1.json.sig'), 'utf8').trim(), 'base64');
    expect(verify(null, Buffer.from(text), publicKey, signature)).toBe(true);
  });
});
