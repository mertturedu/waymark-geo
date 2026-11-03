import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { downloadFile } from '../../src/core/packs/download';
import { createZstdDecode } from '../../src/core/packs/zstd';
import { createFakeEnv, type FakeEnv } from '../helpers/fake-env';

const PLAIN = 'https://packs.example/34/address-0a0b0c0d.sqlite';
const PACKED = 'https://packs.example/34/address-0a0b0c0d.sqlite.zst';
const SIZE = 200_000;
const content = (): Uint8Array => Uint8Array.from({ length: SIZE }, (_, i) => (i * 31 + 3 + (i >> 8)) & 255);
const packed = new Uint8Array(readFileSync(join(__dirname, 'fixtures', 'content-200k.zst')));
const hex = (bytes: Uint8Array): string => bytesToHex(sha256(bytes));

function rig(options: { capacity?: number; encodedBytes?: Uint8Array; encodedSha?: string; sha?: string; withDecode?: boolean } = {}) {
  const env = createFakeEnv(options.capacity === undefined ? {} : { capacity: options.capacity });
  const bytes = content();
  const served = options.encodedBytes ?? packed;
  env.server.put(PLAIN, bytes);
  env.server.put(PACKED, served);
  const run = (extra: { signal?: AbortSignal; onProgress?: (d: number, t: number) => void; onVerify?: () => void } = {}) =>
    downloadFile({
      fs: env.fs,
      net: env.net,
      hash: env.hash,
      clock: env.clock,
      url: PLAIN,
      partPath: '.part/34__address.sqlite',
      finalPath: 'files/34/address.sqlite',
      size: SIZE,
      sha256: options.sha ?? hex(bytes),
      encoded: { url: PACKED, partPath: '.part/34__address.sqlite.zst', finalPath: 'files/34/address.sqlite.zst', size: served.length, sha256: options.encodedSha ?? hex(packed) },
      ...(options.withDecode === false ? {} : { decode: createZstdDecode() }),
      ...extra,
    });
  return { env, bytes, run };
}

const stored = (env: FakeEnv, path: string): number[] => Array.from(env.fs.files.get(path) ?? []);

describe('downloadFile with a zstd file', () => {
  it('fetches the small file, opens it, checks the real file and tidies up', async () => {
    const { env, bytes, run } = rig();
    const progress: [number, number][] = [];
    const result = await run({ onProgress: (d, t) => progress.push([d, t]) });
    expect(result.bytes).toBe(SIZE);
    expect(stored(env, 'files/34/address.sqlite')).toEqual(Array.from(bytes));
    expect(env.fs.files.has('files/34/address.sqlite.zst')).toBe(false);
    expect(env.fs.files.has('.part/34__address.sqlite')).toBe(false);
    expect(env.server.log.map((entry) => entry.url)).toEqual([PACKED]);
    expect(progress.at(-1)).toEqual([SIZE, SIZE]);
    expect(progress.every(([d, t], i) => t === SIZE && d <= SIZE && (i === 0 || d >= (progress[i - 1] as [number, number])[0]))).toBe(true);
  });

  it('says it is verifying before it opens the file', async () => {
    const { env, run } = rig();
    const seen: number[] = [];
    await run({ onVerify: () => seen.push(env.fs.files.has('files/34/address.sqlite.zst') ? 1 : 0) });
    expect(seen).toContain(1);
  });

  it('carries on after a cut connection while it fetches the small file', async () => {
    const { env, bytes, run } = rig();
    env.server.inject({ effect: { kind: 'cut', afterBytes: Math.floor(packed.length / 2) }, times: 1 });
    const result = await run();
    expect(result.retries).toBe(1);
    expect(stored(env, 'files/34/address.sqlite')).toEqual(Array.from(bytes));
  });

  it('downloads the plain file when the app has no decoder', async () => {
    const { env, bytes, run } = rig({ withDecode: false });
    await run();
    expect(stored(env, 'files/34/address.sqlite')).toEqual(Array.from(bytes));
    expect(env.server.log.map((entry) => entry.url)).toEqual([PLAIN]);
  });

  it('refuses a small file whose checksum is wrong and leaves nothing behind', async () => {
    const bent = Uint8Array.from(packed);
    bent[100] = (bent[100] as number) ^ 0xff;
    const { env, run } = rig({ encodedBytes: bent, encodedSha: hex(packed) });
    await expect(run()).rejects.toMatchObject({ code: 'checksum' });
    expect(env.fs.files.has('files/34/address.sqlite')).toBe(false);
  });

  it('refuses a file that opens to something else than the manifest says', async () => {
    const { env, run } = rig({ sha: '0'.repeat(64) });
    await expect(run()).rejects.toMatchObject({ code: 'checksum' });
    expect(env.fs.files.has('files/34/address.sqlite')).toBe(false);
    expect(env.fs.files.has('files/34/address.sqlite.zst')).toBe(false);
    expect(env.fs.files.has('.part/34__address.sqlite')).toBe(false);
  });

  it('refuses data that has the right checksum but is not zstd', async () => {
    const junk = Uint8Array.from({ length: 5000 }, (_, i) => (i * 7) & 255);
    const { env, run } = rig({ encodedBytes: junk, encodedSha: hex(junk) });
    await expect(run()).rejects.toMatchObject({ code: 'checksum' });
    expect(env.fs.files.has('files/34/address.sqlite')).toBe(false);
  });

  it('stops with no-space when the phone cannot hold the opened file', async () => {
    const { env, run } = rig({ capacity: packed.length + 10_000 });
    await expect(run()).rejects.toMatchObject({ code: 'no-space' });
    expect(env.fs.files.has('files/34/address.sqlite')).toBe(false);
  });

  it('stops when it is cancelled before it starts opening the file', async () => {
    const { run } = rig();
    const controller = new AbortController();
    controller.abort();
    await expect(run({ signal: controller.signal })).rejects.toMatchObject({ code: 'cancelled' });
  });

  it('does nothing when the real file is already in place', async () => {
    const { env, bytes, run } = rig();
    env.fs.files.set('files/34/address.sqlite', bytes);
    expect(await run()).toEqual({ bytes: SIZE, retries: 0 });
    expect(env.server.log).toEqual([]);
  });
});
