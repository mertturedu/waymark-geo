import fc from 'fast-check';
import type { NetPort } from '../../src/core/packs/ports';
import { loadState, parseState, STATE_PATH, BACKUP_PATH } from '../../src/core/packs/state-file';
import { createPackManager } from '../../src/core/packs/manager';
import { makeWorld, type World } from '../helpers/pack-world';
import { requested, setup, stored } from '../helpers/pack-setup';

function hanging(world: World, afterBytes: number, match: string): NetPort {
  return {
    getText: world.env.net.getText,
    async get(url, options) {
      const response = await world.env.net.get(url, options);
      if (!url.includes(match)) return response;
      let sent = 0;
      return {
        status: response.status,
        body: (async function* () {
          for await (const chunk of response.body) {
            yield chunk;
            sent += chunk.length;
            if (sent >= afterBytes) await new Promise<void>(() => undefined);
          }
        })(),
      };
    },
  };
}

describe('restart', () => {
  it('finds an interrupted download paused and finishes it from the partial data', async () => {
    const world = makeWorld();
    const first = await setup(world, { net: hanging(world, 20_000, '/tiles-') });
    await first.manager.checkUpdates();
    void first.manager.download('35').catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect([...world.env.fs.files.keys()].some((p) => p.startsWith('.part/'))).toBe(true);

    const second = await setup(world);
    expect(second.manager.status('35')).toMatchObject({ state: 'paused', installedParts: [] });
    world.env.server.log.length = 0;
    await second.manager.resume('35');
    expect(second.manager.status('35')).toMatchObject({ state: 'installed', installedParts: ['address', 'tiles'] });
    expect(world.env.server.log.some((r) => r.rangeStart !== null && r.rangeStart > 0)).toBe(true);
    expect(stored(world, second.manager.installedFile('35', 'tiles') as string)).toEqual(Array.from(world.regions[1]?.parts.tiles ?? []));
  });

  it('keeps installed regions through a restart', async () => {
    const world = makeWorld();
    const first = await setup(world);
    await first.manager.download('34');
    const second = await setup(world);
    expect(second.manager.status('34')).toMatchObject({ state: 'installed', installedParts: ['address', 'tiles'] });
    expect(second.manager.installedFile('34', 'address')).toBe(first.manager.installedFile('34', 'address'));
    expect(second.manager.baseDir()).toBe('files/base-20261022');
    expect(second.manager.manifest()?.regions.length).toBe(3);
  });

  it('shows an update again after a restart without asking the server', async () => {
    const world = makeWorld();
    const first = await setup(world);
    await first.manager.download('06');
    world.setPart('06', 'address', new Uint8Array(10_001).fill(4));
    world.publish();
    await first.manager.checkUpdates();
    const second = await setup(world);
    expect(second.manager.status('06').state).toBe('update-available');
  });

  it('falls back to the backup, which still knows the second download was under way', async () => {
    const world = makeWorld();
    const first = await setup(world);
    await first.manager.download('34');
    await first.manager.download('06');
    const text = (await world.env.fs.readText(STATE_PATH)) as string;
    await world.env.fs.writeAtomic(STATE_PATH, text.slice(0, 40));
    const second = await setup(world);
    expect(second.manager.status('34').state).toBe('installed');
    expect(second.manager.status('06').state).toBe('paused');
    expect(parseState((await world.env.fs.readText(BACKUP_PATH)) ?? '')).not.toBeNull();
  });

  it('deletes nothing when both state copies are unreadable', async () => {
    const world = makeWorld();
    const first = await setup(world);
    await first.manager.download('34');
    const before = [...world.env.fs.files.keys()].filter((p) => p.startsWith('files/'));
    await world.env.fs.writeAtomic(STATE_PATH, 'junk');
    await world.env.fs.writeAtomic(BACKUP_PATH, 'junk');
    const second = await setup(world);
    expect(second.manager.status('34').state).toBe('none');
    expect([...world.env.fs.files.keys()].filter((p) => p.startsWith('files/'))).toEqual(before);
    world.env.server.log.length = 0;
    await second.manager.download('34');
    expect(second.manager.status('34').state).toBe('installed');
    expect(requested(world).filter((p) => p.startsWith('34/') || p.startsWith('base-'))).toEqual([]);
  });

  it('sweeps files nobody asked for but keeps files the manifest knows', async () => {
    const world = makeWorld();
    const first = await setup(world);
    await first.manager.download('34');
    await world.env.fs.append('files/99/stray.sqlite', new Uint8Array(100));
    await world.env.fs.append('.part/99__stale.bin', new Uint8Array(100));
    await world.env.fs.append(`.part/${world.pathOf('06', 'address').replace(/\//g, '__')}`, new Uint8Array(100));
    const second = await setup(world);
    expect(world.env.fs.files.has('files/99/stray.sqlite')).toBe(false);
    expect(world.env.fs.files.has('.part/99__stale.bin')).toBe(false);
    expect(world.env.fs.files.has(`.part/${world.pathOf('06', 'address').replace(/\//g, '__')}`)).toBe(true);
    expect(second.manager.status('34').state).toBe('installed');
    expect(world.env.fs.files.has(second.manager.installedFile('34', 'address') as string)).toBe(true);
  });

  it('drops an installed part whose file went missing without failing to start', async () => {
    const world = makeWorld();
    const first = await setup(world);
    await first.manager.download('34');
    world.env.fs.files.delete(first.manager.installedFile('34', 'tiles') as string);
    const second = await setup(world);
    expect(second.manager.status('34')).toMatchObject({ state: 'installed', installedParts: ['address'] });
    world.env.fs.files.delete(first.manager.installedFile('34', 'address') as string);
    const third = await setup(world);
    expect(third.manager.status('34')).toMatchObject({ state: 'none', installedParts: [] });
  });

  it('drops a file whose size changed on disk', async () => {
    const world = makeWorld();
    const first = await setup(world);
    await first.manager.download('06', { parts: ['address'] });
    await world.env.fs.truncate(first.manager.installedFile('06', 'address') as string);
    const second = await setup(world);
    expect(second.manager.status('06').installedParts).toEqual([]);
  });

  it('ignores a stored manifest that no longer verifies and still serves installed files', async () => {
    const world = makeWorld();
    const first = await setup(world);
    await first.manager.download('34');
    const text = (await world.env.fs.readText('manifest-v1.json')) as string;
    await world.env.fs.writeAtomic('manifest-v1.json', `${text} `);
    const second = await setup(world);
    expect(second.manager.manifest()).toBeNull();
    expect(second.manager.status('34')).toMatchObject({ state: 'installed', installedParts: ['address', 'tiles'] });
    expect(second.manager.installedFile('34', 'address')).not.toBeNull();
    expect(world.env.fs.files.has(second.manager.installedFile('34', 'address') as string)).toBe(true);
  });

  it('ignores a stored manifest signed by a key that is no longer trusted', async () => {
    const world = makeWorld();
    const first = await setup(world);
    await first.manager.checkUpdates();
    const manager = await createPackManager({ fs: world.env.fs, net: world.env.net, hash: world.env.hash, clock: world.env.clock, connectivity: world.env.connectivity }, { ...world.config, publicKeys: [makeWorld().config.publicKeys[0] as string] });
    expect(manager.manifest()).toBeNull();
  });
});

describe('whatever happens, installed files are the verified ones', () => {
  it('holds after random actions, cut connections and restarts', async () => {
    const actions = fc.constantFrom('download', 'pause', 'resume', 'remove', 'restart', 'cut', 'wait');
    await fc.assert(
      fc.asyncProperty(fc.array(fc.tuple(actions, fc.constantFrom('34', '35', '06')), { minLength: 3, maxLength: 14 }), async (steps) => {
        const world = makeWorld();
        let { manager } = await setup(world);
        await manager.checkUpdates();
        for (const [action, id] of steps) {
          if (action === 'download') void manager.download(id).catch(() => undefined);
          else if (action === 'pause') await manager.pause(id);
          else if (action === 'resume') void manager.resume(id).catch(() => undefined);
          else if (action === 'remove') await manager.remove(id);
          else if (action === 'cut') world.env.server.inject({ effect: { kind: 'cut', afterBytes: 5_000 }, times: 1 });
          else if (action === 'wait') await manager.idle();
          else {
            await manager.idle();
            manager = (await setup(world)).manager;
          }
        }
        for (const id of ['34', '35', '06']) void manager.resume(id).catch(() => undefined);
        await manager.idle();
        const recorded = (await loadState(world.env.fs)).state;
        const files = Object.values(recorded.regions).flatMap((r) => Object.values(r.files)).concat(recorded.base?.files ?? []);
        for (const file of files) {
          expect(await world.env.fs.size(`files/${file.path}`)).toBe(file.size);
          expect(await world.env.hash.sha256File(`files/${file.path}`)).toBe(file.sha256);
        }
        for (const id of ['34', '35', '06']) {
          const status = manager.status(id);
          for (const kind of status.installedParts) expect(manager.installedFile(id, kind)).not.toBeNull();
        }
      }),
      { numRuns: 60 },
    );
  }, 120_000);
});
