import { blob } from '../helpers/pack-world';
import { setup } from '../helpers/pack-setup';

const DAY = 24 * 3_600_000;

describe('daily update check', () => {
  it('fetches the manifest the first time and skips a second call inside the window', async () => {
    const { world, manager } = await setup();
    await manager.download('35');
    world.setPart('35', 'address', blob(21_000, 41));
    world.publish();
    world.env.clock.advance(DAY + 1);
    const first = await manager.checkUpdates({ minIntervalMs: DAY });
    expect(first).toMatchObject({ ok: true, updates: ['35'] });
    expect(first.ok && first.skipped).toBeFalsy();
    world.env.clock.advance(1000);
    const second = await manager.checkUpdates({ minIntervalMs: DAY });
    expect(second).toMatchObject({ ok: true, updates: ['35'], skipped: true });
  });

  it('checks again once the window has passed and always when no window is given', async () => {
    const { world, manager } = await setup();
    await manager.download('06');
    await manager.checkUpdates({ minIntervalMs: DAY });
    world.env.clock.advance(DAY + 1);
    expect(await manager.checkUpdates({ minIntervalMs: DAY })).not.toHaveProperty('skipped');
    expect(await manager.checkUpdates()).not.toHaveProperty('skipped');
    expect(await manager.checkUpdates({ minIntervalMs: DAY })).toHaveProperty('skipped', true);
  });

  it('remembers the last check across a restart', async () => {
    const { world, manager } = await setup();
    await manager.download('06');
    await manager.checkUpdates({ minIntervalMs: DAY });
    const reopened = (await setup(world)).manager;
    expect(await reopened.checkUpdates({ minIntervalMs: DAY })).toHaveProperty('skipped', true);
  });

  it('does not skip after a failed check', async () => {
    const { world, manager } = await setup();
    world.env.clock.advance(DAY + 1);
    world.env.server.inject({ effect: { kind: 'offline' }, times: 1 });
    expect(await manager.checkUpdates({ minIntervalMs: DAY })).toMatchObject({ ok: false });
    expect(await manager.checkUpdates({ minIntervalMs: DAY })).toMatchObject({ ok: true });
  });
});
