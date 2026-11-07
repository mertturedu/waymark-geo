import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encodePatch, zstdPatchTool } from '../../pipeline/build/patches';
import type { World } from '../helpers/pack-world';
import { makeWorld } from '../helpers/pack-world';
import { requested, setup, type SetupOptions } from '../helpers/pack-setup';

const noise = (length: number, seed: string): Buffer => {
  const parts: Buffer[] = [];
  let total = 0;
  for (let i = 0; total < length; i++) {
    const part = createHash('sha256').update(`${seed}${i}`).digest();
    parts.push(part);
    total += part.length;
  }
  return Buffer.concat(parts).subarray(0, length);
};
const sha = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const edited = (source: Uint8Array, at: number, change: Buffer): Buffer => Buffer.concat([source.subarray(0, at), change, source.subarray(at + change.length)]);

const roots: string[] = [];
afterAll(() => roots.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const ADDRESS_OLD = noise(300_000, 'address');
const TILES_OLD = noise(400_000, 'tiles');
const ADDRESS_NEW = edited(ADDRESS_OLD, 120_000, noise(500, 'a2'));
const TILES_NEW = edited(TILES_OLD, 200_000, noise(800, 't2'));

async function patchOf(older: Uint8Array, newer: Uint8Array): Promise<Uint8Array> {
  const dir = mkdtempSync(join(tmpdir(), 'mp-'));
  roots.push(dir);
  return (await encodePatch(Buffer.from(older), Buffer.from(newer), zstdPatchTool, dir))!;
}

type Rig = Awaited<ReturnType<typeof rigUp>>;

async function rigUp(options: { patch?: boolean; encode?: boolean; capacity?: number; setup?: SetupOptions; patchTiles?: boolean } = {}) {
  const world = makeWorld({ regions: [{ id: '34', parts: { address: ADDRESS_OLD, tiles: TILES_OLD } }], ...(options.capacity === undefined ? {} : { capacity: options.capacity }), ...(options.encode ? { encode: ['address'] as ('address')[] } : {}) });
  const ready = await setup(world, options.setup);
  await ready.manager.download('34');
  const oldAddress = ready.manager.installedFile('34', 'address') as string;
  world.setPart('34', 'address', ADDRESS_NEW);
  world.setPart('34', 'tiles', TILES_NEW);
  const addressPatch = await patchOf(ADDRESS_OLD, ADDRESS_NEW);
  const tilesPatch = await patchOf(TILES_OLD, TILES_NEW);
  const entries = options.patch === false ? [] : [world.addPatch('34', 'address', ADDRESS_OLD, addressPatch), ...(options.patchTiles === false ? [] : [world.addPatch('34', 'tiles', TILES_OLD, tilesPatch)])];
  world.publish();
  await ready.manager.checkUpdates();
  world.env.server.log.length = 0;
  return { ...ready, oldAddress, addressPatch, tilesPatch, entries };
}

const file = (rig: Rig, kind: 'address' | 'tiles'): Uint8Array | undefined => rig.world.env.fs.files.get(rig.manager.installedFile('34', kind) as string);
const patchUrls = (world: World): string[] => requested(world).filter((url) => url.includes('/patches/'));
const wholeUrls = (world: World): string[] => requested(world).filter((url) => !url.includes('/patches/') && !url.endsWith('manifest-v1.json') && !url.endsWith('.sig'));

describe('updating with patches (selection and cleanup)', () => {
  it('picks the patch that starts from the installed file among several', async () => {
    const rig = await rigUp({ patch: false });
    const other = noise(300_000, 'other-address');
    const unrelated = world34(rig).addPatch('34', 'address', other, await patchOf(other, ADDRESS_NEW));
    const right = rig.world.addPatch('34', 'address', ADDRESS_OLD, rig.addressPatch);
    rig.world.publish();
    await rig.manager.checkUpdates();
    expect(unrelated.from).not.toBe(right.from);
    rig.world.env.server.log.length = 0;
    await rig.manager.download('34');
    expect(patchUrls(rig.world)).toEqual([right.path]);
    expect(rig.manager.status('34').lastUpdate).toMatchObject({ patched: 1, fellBack: 0 });
  });

  it('does not look for patches when nothing of that part is installed', async () => {
    const world = makeWorld({ regions: [{ id: '34', parts: { address: ADDRESS_NEW, tiles: TILES_NEW } }] });
    world.addPatch('34', 'address', ADDRESS_OLD, await patchOf(ADDRESS_OLD, ADDRESS_NEW));
    world.publish();
    const ready = await setup(world);
    await ready.manager.download('34');
    expect(patchUrls(world)).toEqual([]);
    expect(ready.manager.status('34').lastUpdate).toEqual({ patched: 0, fellBack: 0, bytes: ADDRESS_NEW.length + TILES_NEW.length + Object.values(world.base).reduce((sum, bytes) => sum + bytes.length, 0) });
  });

  it('downloads the whole file when the installed one has gone missing, without asking for the patch', async () => {
    const rig = await rigUp();
    rig.world.env.fs.files.delete(rig.oldAddress);
    await rig.manager.download('34');
    expect(patchUrls(rig.world).filter((url) => url.includes('address'))).toEqual([]);
    expect(sha(file(rig, 'address')!)).toBe(sha(ADDRESS_NEW));
    expect(rig.manager.status('34').lastUpdate?.fellBack).toBe(1);
  });

  it('counts the zstd size of a whole file it had to download, not the plain size', async () => {
    const rig = await rigUp({ patch: false, encode: true, setup: { decode: (await import('../../src/core/packs/zstd')).createZstdDecode() } });
    const encoded = rig.manager.manifest()!.regions[0]!.files.find((item) => item.kind === 'address')!.encoded!.size;
    await rig.manager.download('34');
    expect(rig.manager.status('34').lastUpdate?.bytes).toBe(encoded + TILES_NEW.length);
  });

  it('leaves no patch files behind after a fallback and ends the progress exactly at its total', async () => {
    const rig = await rigUp();
    const entry = rig.entries[0]!;
    rig.world.env.server.put(`${rig.world.baseUrl}/${entry.path}`, new Uint8Array(entry.size).fill(9));
    const seen: [number, number][] = [];
    await rig.manager.download('34', { onProgress: (done, all) => seen.push([done, all]) });
    expect([...rig.world.env.fs.files.keys()].filter((path) => path.includes('zpatch') || path.includes('patches'))).toEqual([]);
    const last = seen[seen.length - 1]!;
    expect(last[0]).toBe(last[1]);
    expect(last[1]).toBe(ADDRESS_NEW.length + rig.tilesPatch.length);
  });

  it('removes a file it already rebuilt when a later file runs out of room', async () => {
    const probe = await rigUp();
    const before = new Set(probe.world.env.fs.files.keys());
    const used = probe.world.env.fs.used();
    const rig = await rigUp({ capacity: used + probe.addressPatch.length + Math.ceil(ADDRESS_NEW.length * 1.2) + 1_000 });
    const start = new Set(rig.world.env.fs.files.keys());
    await expect(rig.manager.download('34')).rejects.toMatchObject({ code: 'no-space' });
    expect(new Set(rig.world.env.fs.files.keys())).toEqual(start);
    expect(start.size).toBe(before.size);
    expect(sha(file(rig, 'address')!)).toBe(sha(ADDRESS_OLD));
  });
});

const world34 = (rig: Rig): World => rig.world;

describe('updating with patches', () => {
  it('downloads only the patches, rebuilds both files exactly and cleans up', async () => {
    const rig = await rigUp();
    expect(rig.manager.status('34').state).toBe('update-available');
    await rig.manager.download('34');
    expect(patchUrls(rig.world)).toHaveLength(2);
    expect(wholeUrls(rig.world).filter((url) => url.startsWith('34/'))).toEqual([]);
    expect(sha(file(rig, 'address')!)).toBe(sha(ADDRESS_NEW));
    expect(sha(file(rig, 'tiles')!)).toBe(sha(TILES_NEW));
    const status = rig.manager.status('34');
    expect(status).toMatchObject({ state: 'installed', availableVersion: null, updateBytes: null });
    expect(status.lastUpdate).toEqual({ patched: 2, fellBack: 0, bytes: rig.addressPatch.length + rig.tilesPatch.length });
    expect(rig.world.env.fs.files.has(rig.oldAddress)).toBe(false);
    expect([...rig.world.env.fs.files.keys()].filter((path) => path.includes('patches') || path.includes('.zpatch'))).toEqual([]);
    expect([...rig.world.env.fs.files.keys()].filter((path) => path.startsWith('.part/') && path.includes('34'))).toEqual([]);
  });

  it('reports the patch sizes as the download size before and the progress while it runs', async () => {
    const rig = await rigUp();
    const total = rig.addressPatch.length + rig.tilesPatch.length;
    expect(rig.manager.downloadBytes('34', ['address', 'tiles'])).toBe(total);
    expect(rig.manager.status('34').updateBytes).toBe(total);
    const seen: [number, number][] = [];
    await rig.manager.download('34', { onProgress: (done, all) => seen.push([done, all]) });
    expect(seen.length).toBeGreaterThan(0);
    for (const [, all] of seen) expect(all).toBe(total);
    expect(Math.max(...seen.map(([done]) => done))).toBe(total);
  });

  it('falls back to the whole file when no patch starts from the installed one', async () => {
    const rig = await rigUp({ patch: false });
    await rig.manager.download('34');
    expect(patchUrls(rig.world)).toEqual([]);
    expect(wholeUrls(rig.world).filter((url) => url.startsWith('34/')).length).toBe(2);
    expect(rig.manager.status('34').lastUpdate).toEqual({ patched: 0, fellBack: 0, bytes: ADDRESS_NEW.length + TILES_NEW.length });
    expect(sha(file(rig, 'address')!)).toBe(sha(ADDRESS_NEW));
  });

  it('can be switched off, and then downloads whole files', async () => {
    const rig = await rigUp({ setup: { patches: false } });
    expect(rig.manager.downloadBytes('34', ['address'])).toBe(ADDRESS_NEW.length);
    await rig.manager.download('34');
    expect(patchUrls(rig.world)).toEqual([]);
    expect(sha(file(rig, 'tiles')!)).toBe(sha(TILES_NEW));
  });

  it('patches one file and downloads the other whole when only one has a patch', async () => {
    const rig = await rigUp({ patchTiles: false });
    await rig.manager.download('34');
    expect(patchUrls(rig.world)).toHaveLength(1);
    expect(wholeUrls(rig.world).filter((url) => url.startsWith('34/')).length).toBe(1);
    expect(rig.manager.status('34').lastUpdate).toEqual({ patched: 1, fellBack: 0, bytes: rig.addressPatch.length + TILES_NEW.length });
  });

  it('prefers the patch over a zstd copy of the whole file', async () => {
    const rig = await rigUp({ encode: true, patchTiles: false, setup: { decode: (await import('../../src/core/packs/zstd')).createZstdDecode() } });
    await rig.manager.download('34');
    expect(patchUrls(rig.world)).toHaveLength(1);
    expect(requested(rig.world).some((url) => url.endsWith('.zst'))).toBe(false);
    expect(sha(file(rig, 'address')!)).toBe(sha(ADDRESS_NEW));
  });

  it('falls back to the whole file when the patch fails its checksum, and says so', async () => {
    const rig = await rigUp();
    const entry = rig.entries[0]!;
    const broken = new Uint8Array(entry.size).fill(7);
    rig.world.env.server.put(`${rig.world.baseUrl}/${entry.path}`, broken);
    await rig.manager.download('34');
    expect(sha(file(rig, 'address')!)).toBe(sha(ADDRESS_NEW));
    expect(sha(file(rig, 'tiles')!)).toBe(sha(TILES_NEW));
    expect(rig.manager.status('34').lastUpdate).toMatchObject({ patched: 1, fellBack: 1 });
    expect(rig.manager.status('34').state).toBe('installed');
  });

  it('falls back when the patch is missing on the server', async () => {
    const rig = await rigUp();
    rig.world.env.server.inject({ effect: { kind: 'status', status: 404 }, match: (url) => url.includes('/patches/address'), times: 100 });
    await rig.manager.download('34');
    expect(rig.manager.status('34').lastUpdate).toMatchObject({ patched: 1, fellBack: 1 });
    expect(sha(file(rig, 'address')!)).toBe(sha(ADDRESS_NEW));
  });

  it('falls back when the patch applies cleanly but to different bytes than the manifest says', async () => {
    const rig = await rigUp({ patch: false });
    const wrong = await patchOf(ADDRESS_OLD, edited(ADDRESS_OLD, 5, noise(100, 'other')));
    rig.world.addPatch('34', 'address', ADDRESS_OLD, wrong);
    rig.world.publish();
    await rig.manager.checkUpdates();
    rig.world.env.server.log.length = 0;
    await rig.manager.download('34');
    expect(patchUrls(rig.world)).toHaveLength(1);
    expect(sha(file(rig, 'address')!)).toBe(sha(ADDRESS_NEW));
    expect(rig.manager.status('34').lastUpdate).toMatchObject({ patched: 0, fellBack: 1 });
  });

  it('falls back when the installed file was damaged but kept its size', async () => {
    const rig = await rigUp();
    const damaged = Uint8Array.from(ADDRESS_OLD);
    damaged[1000] = (damaged[1000] as number) ^ 0xff;
    rig.world.env.fs.files.set(rig.oldAddress, damaged);
    await rig.manager.download('34');
    expect(sha(file(rig, 'address')!)).toBe(sha(ADDRESS_NEW));
    expect(rig.manager.status('34').lastUpdate).toMatchObject({ patched: 1, fellBack: 1 });
  });

  it('falls back when writing the rebuilt file fails once', async () => {
    const rig = await rigUp();
    const original = rig.world.env.fs.append;
    let failed = false;
    rig.world.env.fs.append = async (path, bytes) => {
      if (!failed && path.startsWith('.part/') && path.includes('address') && !path.includes('patches')) {
        failed = true;
        throw new Error('disk hiccup');
      }
      return original(path, bytes);
    };
    await rig.manager.download('34');
    expect(failed).toBe(true);
    expect(sha(file(rig, 'address')!)).toBe(sha(ADDRESS_NEW));
    expect(rig.manager.status('34').lastUpdate).toMatchObject({ fellBack: 1 });
  });

  it('reports a dead network instead of retrying the whole file, and keeps the old files', async () => {
    const rig = await rigUp();
    rig.world.env.server.inject({ effect: { kind: 'offline' }, match: (url) => url.includes('/patches/'), times: 1000 });
    await expect(rig.manager.download('34')).rejects.toMatchObject({ code: 'network' });
    expect(sha(file(rig, 'address')!)).toBe(sha(ADDRESS_OLD));
    expect(rig.manager.status('34').state).toBe('error');
    rig.world.env.server.clear();
    await rig.manager.download('34');
    expect(sha(file(rig, 'address')!)).toBe(sha(ADDRESS_NEW));
  });

  it('stops with a no-space error and keeps the old files when there is no room for the rebuilt file', async () => {
    const probe = await rigUp();
    const used = probe.world.env.fs.used();
    const rig = await rigUp({ capacity: used + probeBytes(probe) });
    await expect(rig.manager.download('34')).rejects.toMatchObject({ code: 'no-space' });
    expect(sha(file(rig, 'address')!)).toBe(sha(ADDRESS_OLD));
    expect(sha(file(rig, 'tiles')!)).toBe(sha(TILES_OLD));
  });

  it('keeps the old file readable the whole time the patch is being applied', async () => {
    const rig = await rigUp();
    const seen: boolean[] = [];
    const sleep = rig.world.env.clock.sleep;
    rig.world.env.clock.sleep = async (ms) => {
      seen.push(rig.manager.installedFile('34', 'address') === rig.oldAddress && sha(rig.world.env.fs.files.get(rig.oldAddress) ?? new Uint8Array(0)) === sha(ADDRESS_OLD));
      return sleep(ms);
    };
    await rig.manager.download('34');
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every(Boolean)).toBe(true);
  });

  it('pauses during the apply and resumes to the right result', async () => {
    const rig = await rigUp();
    const sleep = rig.world.env.clock.sleep;
    let paused = false;
    rig.world.env.clock.sleep = async (ms) => {
      if (!paused) {
        paused = true;
        void rig.manager.pause('34');
      }
      return sleep(ms);
    };
    await expect(rig.manager.download('34')).rejects.toMatchObject({ code: 'cancelled' });
    expect(rig.manager.status('34').state).toBe('paused');
    expect(sha(file(rig, 'address')!)).toBe(sha(ADDRESS_OLD));
    rig.world.env.clock.sleep = sleep;
    await rig.manager.resume('34');
    expect(rig.manager.status('34').state).toBe('installed');
    expect(sha(file(rig, 'address')!)).toBe(sha(ADDRESS_NEW));
    expect(sha(file(rig, 'tiles')!)).toBe(sha(TILES_NEW));
  });

  it('starts again over a half written output left by a crash', async () => {
    const rig = await rigUp();
    const newPath = rig.world.pathOf('34', 'address');
    rig.world.env.fs.files.set(`.part/${newPath.replace(/\//g, '__')}`, noise(70_000, 'junk'));
    await rig.manager.download('34');
    expect(sha(file(rig, 'address')!)).toBe(sha(ADDRESS_NEW));
    expect(rig.manager.status('34').lastUpdate).toMatchObject({ patched: 2, fellBack: 0 });
  });

  it('keeps a listed patch through a restart sweep but sweeps one nobody lists, and drops patches with the region', async () => {
    const rig = await rigUp();
    const listed = `files/${rig.entries[0]!.path}`;
    const stray = 'files/34/patches/stray.zpatch';
    rig.world.env.fs.files.set(listed, new Uint8Array([1]));
    rig.world.env.fs.files.set(stray, new Uint8Array([2]));
    const again = await setup(rig.world);
    expect(rig.world.env.fs.files.has(listed)).toBe(true);
    expect(rig.world.env.fs.files.has(stray)).toBe(false);
    await again.manager.remove('34');
    expect(rig.world.env.fs.files.has(listed)).toBe(false);
  });
});

function probeBytes(rig: Rig): number {
  return Math.floor(rig.addressPatch.length + rig.tilesPatch.length + TILES_NEW.length * 0.5);
}
