import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { cuttingFs, fileUrl, installWith } from '../../example/src/device-test/install';
import { recordingNet, resumedWithRange } from '../../example/src/device-test/recording-fetch';
import { partPath } from '../../src/core/packs/paths';
import { createFakeEnv } from '../helpers/fake-env';
import { blob } from '../helpers/pack-world';

const SERVER = 'http://192.168.1.10:8090';
const bytes = blob(200_000, 3);
const file = { path: 'tiles/istanbul köy.pmtiles', size: bytes.length, sha256: bytesToHex(sha256(bytes)) };
const stored = (env: ReturnType<typeof createFakeEnv>, path: string): number[] => Array.from(env.fs.files.get(path) ?? []);

function rig() {
  const env = createFakeEnv();
  env.server.put(fileUrl(SERVER, file.path), bytes);
  return { env, ports: { fs: env.fs, net: env.net, hash: env.hash, clock: env.clock } };
}

describe('fileUrl', () => {
  it('encodes every piece of the path and keeps the slashes', () => {
    expect(fileUrl('http://s:8090', 'a b/ç.bin')).toBe('http://s:8090/a%20b/%C3%A7.bin');
  });
});

describe('installWith', () => {
  it('puts the file at its own path, reports progress up to the full size and leaves no half downloaded file', async () => {
    const { env, ports } = rig();
    const progress: [number, number][] = [];
    const result = await installWith(ports, SERVER, file, { onProgress: (done, total) => progress.push([done, total]) });
    expect(result).toEqual({ bytes: file.size, retries: 0 });
    expect(stored(env, file.path)).toEqual(Array.from(bytes));
    expect(env.fs.files.has(partPath(file.path))).toBe(false);
    expect(progress.at(-1)).toEqual([file.size, file.size]);
    expect(env.server.log.map((request) => request.url)).toEqual([fileUrl(SERVER, file.path)]);
  });

  it('can put the file under another name', async () => {
    const { env, ports } = rig();
    await installWith(ports, SERVER, file, { to: 'space-probe' });
    expect(stored(env, 'space-probe')).toEqual(Array.from(bytes));
    expect(env.fs.files.has(file.path)).toBe(false);
  });

  it('goes on from the half downloaded file with a ranged request after a cut', async () => {
    const { env, ports } = rig();
    const cut = cuttingFs(env.fs, 60_000);
    const net = recordingNet(env.net);
    const result = await installWith({ ...ports, fs: cut, net }, SERVER, file);
    expect(cut.interrupted).toBe(true);
    expect(result.retries).toBeGreaterThanOrEqual(1);
    expect(resumedWithRange(net.calls)).toBe(true);
    expect(stored(env, file.path)).toEqual(Array.from(bytes));
  });

  it('does not cut anything when the limit is never reached', async () => {
    const { env, ports } = rig();
    const cut = cuttingFs(env.fs, file.size * 2);
    const result = await installWith({ ...ports, fs: cut }, SERVER, file);
    expect(cut.interrupted).toBe(false);
    expect(result.retries).toBe(0);
  });

  it('refuses a download that does not fit before it writes anything', async () => {
    const { env, ports } = rig();
    await expect(installWith({ ...ports, fs: { ...env.fs, freeBytes: async () => 1000 } }, SERVER, file, { to: 'space-probe' })).rejects.toMatchObject({ code: 'no-space' });
    expect(env.fs.files.has(partPath('space-probe'))).toBe(false);
    expect(env.fs.files.has('space-probe')).toBe(false);
    expect(env.server.log).toEqual([]);
  });
});
