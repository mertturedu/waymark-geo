import { makeStallMonitor } from '../../example/src/device-test/stall';

describe('makeStallMonitor', () => {
  it('records the longest gap beyond the tick interval', () => {
    let clock = 0;
    const monitor = makeStallMonitor({ now: () => clock, everyMs: 250 });
    monitor.tick();
    clock = 260;
    monitor.tick();
    clock = 1760;
    monitor.tick();
    clock = 2010;
    monitor.tick();
    expect(monitor.maxStallMs()).toBe(1250);
  });

  it('reports zero when ticks arrive on time', () => {
    let clock = 0;
    const monitor = makeStallMonitor({ now: () => clock, everyMs: 250 });
    for (let i = 0; i < 5; i++) {
      clock += 250;
      monitor.tick();
    }
    expect(monitor.maxStallMs()).toBe(0);
  });

  it('starts a fresh window on reset and ignores the gap before the next tick', () => {
    let clock = 0;
    const monitor = makeStallMonitor({ now: () => clock, everyMs: 250 });
    clock = 5000;
    monitor.tick();
    expect(monitor.maxStallMs()).toBe(4750);
    monitor.reset();
    expect(monitor.maxStallMs()).toBe(0);
    clock = 5250;
    monitor.tick();
    expect(monitor.maxStallMs()).toBe(0);
  });

  it('describes a stall for the report note only above the limit', () => {
    let clock = 0;
    const monitor = makeStallMonitor({ now: () => clock, everyMs: 250 });
    clock = 700;
    monitor.tick();
    expect(monitor.note(1000)).toBe('');
    clock = 3000;
    monitor.tick();
    expect(monitor.note(1000)).toBe('en uzun takılma 2050 ms');
  });
});
