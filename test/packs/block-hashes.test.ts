import { createHash } from 'node:crypto';
import { downloadFile } from '../../src/core/packs/download';
import { parseManifest, serializeManifest, type Manifest } from '../../src/core/region/manifest';

const sha = (c: string): string => c.repeat(64);
const manifestWith = (blocks: unknown, size = 10): string => {
  const manifest = {
    format: 1,
    minSdk: '0.3.0',
    osm: { file: 'a', time: 'b' },
    tiles: { build: '20261022', time: 'c' },
    base: [{ kind: 'base', path: 'b/x.pmtiles', size, sha256: sha('a'), blocks }],
    regions: [],
  } as unknown as Manifest;
  return serializeManifest(manifest);
};

describe('block hashes in the manifest', () => {
  it('parses and keeps a valid block list', () => {
    const parsed = parseManifest(manifestWith({ size: 4, sha256: [sha('1'), sha('2'), sha('3')] }));
    expect(parsed.base[0]?.blocks).toEqual({ size: 4, sha256: [sha('1'), sha('2'), sha('3')] });
  });

  it('rejects a block count that does not match the file size', () => {
    expect(() => parseManifest(manifestWith({ size: 4, sha256: [sha('1')] }))).toThrow('blok sayısı');
    expect(() => parseManifest(manifestWith({ size: 0, sha256: [] }, 0))).toThrow('blok boyutu');
    expect(() => parseManifest(manifestWith({ size: 4, sha256: ['zz', sha('2'), sha('3')] }))).toThrow('blok sha256');
  });

  it('stays valid without blocks', () => {
    expect(parseManifest(manifestWith(undefined)).base[0]?.blocks).toBeUndefined();
  });
});

describe('downloadFile with block hashes', () => {
  const run = async (data: Uint8Array, blockHashes: string[], whole: string, withBlocksPort: boolean) => {
    const files = new Map<string, Uint8Array>();
    let wholeCalls = 0;
    const fs = {
      exists: async (p: string) => files.has(p),
      size: async (p: string) => files.get(p)?.length ?? null,
      read: async (p: string, o: number, l: number) => (files.get(p) as Uint8Array).slice(o, o + l),
      readText: async () => null,
      append: async (p: string, b: Uint8Array) => void files.set(p, Uint8Array.from([...(files.get(p) ?? []), ...b])),
      truncate: async (p: string) => void files.set(p, new Uint8Array()),
      writeAtomic: async () => undefined,
      move: async (a: string, b: string) => {
        files.set(b, files.get(a) as Uint8Array);
        files.delete(a);
      },
      remove: async (p: string) => void files.delete(p),
      list: async () => [],
      freeBytes: async () => 1e9,
    };
    const net = { get: async () => ({ status: 200, body: (async function* () { yield data; })() }), getText: async () => ({ status: 200, text: '' }) };
    const hash = {
      sha256File: async () => {
        wholeCalls += 1;
        return whole;
      },
      ...(withBlocksPort
        ? {
            sha256Blocks: async (p: string, size: number) => {
              const bytes = files.get(p) as Uint8Array;
              const out: string[] = [];
              for (let i = 0; i < bytes.length; i += size) out.push(createHash('sha256').update(bytes.slice(i, i + size)).digest('hex'));
              return out;
            },
          }
        : {}),
    };
    const result = await downloadFile({ fs, net, hash, clock: { now: () => 0, sleep: async () => undefined }, url: 'u', partPath: 'a.part', finalPath: 'a', size: data.length, sha256: 'whole', blocks: { size: 4, sha256: blockHashes } });
    return { result, wholeCalls, files };
  };

  const data = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  const good = [0, 4, 8].map((i) => createHash('sha256').update(data.slice(i, i + 4)).digest('hex'));

  it('verifies by blocks and skips the whole-file hash', async () => {
    const { result, wholeCalls, files } = await run(data, good, 'nope', true);
    expect(result.bytes).toBe(10);
    expect(wholeCalls).toBe(0);
    expect(files.get('a')).toEqual(data);
  });

  it('falls back to the whole-file hash when the platform has no block hashing', async () => {
    const { wholeCalls } = await run(data, good, 'whole', false);
    expect(wholeCalls).toBe(1);
  });

  it('fails with checksum when a block differs', async () => {
    await expect(run(data, [good[0] as string, sha('0'), good[2] as string], 'whole', true)).rejects.toMatchObject({ code: 'checksum' });
  });
});
