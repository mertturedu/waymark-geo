import { downloadFile } from '../../src/core/packs/download';
import { packError } from '../../src/core/packs/types';

describe('downloadFile', () => {
  it('downloads again when the part file vanished before the hash', async () => {
    const files = new Map<string, Uint8Array>();
    const body = new Uint8Array([1, 2, 3, 4]);
    let hashes = 0;
    const fs = {
      exists: async (p: string) => files.has(p),
      size: async (p: string) => files.get(p)?.length ?? null,
      read: async () => new Uint8Array(),
      readText: async () => null,
      append: async (p: string, b: Uint8Array) => {
        files.set(p, Uint8Array.from([...(files.get(p) ?? []), ...b]));
      },
      truncate: async (p: string) => void files.set(p, new Uint8Array()),
      writeAtomic: async () => undefined,
      move: async (a: string, b: string) => {
        files.set(b, files.get(a)!);
        files.delete(a);
      },
      remove: async (p: string) => void files.delete(p),
      list: async () => [],
      freeBytes: async () => 1e9,
    };
    const net = {
      get: async () => ({
        status: 200,
        body: (async function* () {
          yield body;
        })(),
      }),
    };
    const hash = {
      sha256File: async (p: string) => {
        hashes += 1;
        if (hashes === 1) {
          files.delete(p);
          throw packError('storage', 'missing');
        }
        return 'ok';
      },
    };
    const result = await downloadFile({ fs, net, hash, clock: { now: () => 0, sleep: async () => undefined }, url: 'u', partPath: 'a.part', finalPath: 'a', size: 4, sha256: 'ok' } as never);
    expect(result.bytes).toBe(4);
    expect(hashes).toBe(2);
    expect(files.get('a')).toEqual(body);
  });
});
