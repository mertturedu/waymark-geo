import { blob, makeWorld, type World } from '../helpers/pack-world';
import { setup } from '../helpers/pack-setup';

const fonts = (count: number, seed: number): Record<string, Uint8Array> => Object.fromEntries(Array.from({ length: count }, (_, i) => [`fonts/f${i}.pbf`, blob(300, seed + i)]));
const worldOf = (): World => makeWorld({ regions: [{ id: '06', tier: 'basic', parts: { address: blob(1000, 1), tiles: blob(3000, 2) } }], base: fonts(24, 10) });

function slow(world: World, perCall: number): { pauses: () => number } {
  let pauses = 0;
  const { clock, fs } = world.env;
  const sleep = clock.sleep.bind(clock);
  clock.sleep = async (ms) => {
    if (ms === 0) pauses += 1;
    return sleep(ms);
  };
  const append = fs.append.bind(fs);
  fs.append = async (path, bytes) => {
    clock.advance(perCall);
    return append(path, bytes);
  };
  return { pauses: () => pauses };
}

describe('breathing between many small files', () => {
  it('hands the thread back while a pack of small files comes in', async () => {
    const world = worldOf();
    const { pauses } = slow(world, 20);
    const { manager } = await setup(world);
    await manager.download('06');
    expect(manager.status('06').state).toBe('installed');
    expect(pauses()).toBeGreaterThanOrEqual(10);
  });

  it('does not pause while the work is quick', async () => {
    const world = worldOf();
    const { pauses } = slow(world, 0);
    const { manager } = await setup(world);
    await manager.download('06');
    expect(pauses()).toBe(0);
  });

  it('also hands the thread back while the old base files are deleted', async () => {
    const world = worldOf();
    const { manager } = await setup(world);
    await manager.download('06');
    world.setBuild('20261105');
    world.publish();
    await manager.checkUpdates();
    const removed: string[] = [];
    const remove = world.env.fs.remove.bind(world.env.fs);
    world.env.fs.remove = async (path) => {
      if (path.startsWith('files/base-20261022/')) {
        world.env.clock.advance(20);
        removed.push(path);
      }
      return remove(path);
    };
    const { pauses } = slow(world, 0);
    await manager.download('06');
    expect(removed.length).toBe(24);
    expect(pauses()).toBeGreaterThanOrEqual(10);
    expect([...world.env.fs.files.keys()].some((p) => p.startsWith('files/base-20261022/'))).toBe(false);
  });
});
