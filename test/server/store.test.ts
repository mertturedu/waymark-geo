import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { zstdCompressSync } from 'node:zlib';
import { createServerStore, unpack } from '../../server/store';
import { parseManifest } from '../../src/core/region/manifest';
import { packsDir } from './helpers';

const entryOf = (dir: string) => {
  const manifest = parseManifest(readFileSync(join(dir, 'manifest-v1.json'), 'utf8'));
  return (manifest.regions[0] as NonNullable<(typeof manifest.regions)[0]>).files[0] as NonNullable<(typeof manifest.regions)[0]['files'][0]>;
};

describe('createServerStore', () => {
  it('lists the installed regions and opens the address part once', async () => {
    const dir = await packsDir();
    const store = createServerStore(dir, 20);
    expect(await store.installed()).toEqual(['34']);
    const [a, b] = await Promise.all([store.open('34'), store.open('34')]);
    expect(a).toBe(b);
    expect((await a?.all<{ n: number }>('SELECT COUNT(*) AS n FROM address'))?.[0]?.n).toBeGreaterThan(0);
    expect(store.handles()).toBe(1);
    expect(await store.open('06')).toBeNull();
    expect(await store.openPart?.('34', 'buildings2')).toBeNull();
    store.release?.('34');
    store.release?.('34');
    const kept = await store.open('34');
    expect(kept).toBe(a);
    expect(await kept?.all('SELECT 1 AS n')).toHaveLength(1);
    store.release?.('34');
    store.release?.('06');
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(store.handles()).toBe(0);
    await expect(a?.all('SELECT 1')).rejects.toThrow(/closed/);
    const again = await store.open('34');
    expect(again).not.toBe(a);
    await store.closeAll();
    expect(store.handles()).toBe(0);
    store.release?.('34');
  });

  it('unpacks a zstd file once when only the packed one is there, and refuses one that does not match', async () => {
    const dir = await packsDir();
    const entry = entryOf(dir);
    const plain = join(dir, entry.path);
    const keep = readFileSync(plain);
    rmSync(plain);
    expect(unpack(dir, entry)).toBe(plain);
    expect(readFileSync(plain).equals(keep)).toBe(true);
    expect(unpack(dir, entry)).toBe(plain);
    rmSync(plain);
    const bad = join(dir, entry.encoded?.path as string);
    const packed = readFileSync(bad);
    writeFileSync(bad, zstdCompressSync(Buffer.from('başka içerik')));
    expect(() => unpack(dir, entry)).toThrow(/özet/);
    writeFileSync(bad, packed);
    expect(unpack(dir, entry)).toBe(plain);
    expect(unpack(dir, { ...entry, path: 'yok/dosya.sqlite', encoded: undefined })).toBeNull();
    expect(unpack(dir, { ...entry, path: 'yok/dosya.sqlite', encoded: { codec: 'zstd', path: 'yok/dosya.zst', sha256: 'a'.repeat(64), size: 1 } })).toBeNull();
    expect(existsSync(plain)).toBe(true);
  });

  it('says what is wrong when there is no manifest', () => {
    expect(() => createServerStore(join(process.cwd(), 'test'))).toThrow(/manifest yok/);
  });
});
