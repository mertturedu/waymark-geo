import { makeWorkTracker } from '../../example/src/device-test/work-tracker';

describe('makeWorkTracker', () => {
  it('counts work until it settles and reports every change', async () => {
    const seen: number[] = [];
    const tracker = makeWorkTracker((n) => seen.push(n));
    let finish!: () => void;
    const slow = tracker.track(new Promise<void>((resolve) => (finish = resolve)));
    const quick = tracker.track(Promise.resolve(1));
    expect(tracker.count()).toBe(2);
    await quick;
    await Promise.resolve();
    expect(tracker.count()).toBe(1);
    finish();
    await slow;
    await Promise.resolve();
    expect(tracker.count()).toBe(0);
    expect(seen).toEqual([1, 2, 1, 0]);
  });

  it('counts rejected work as finished and still rejects to the caller', async () => {
    const tracker = makeWorkTracker(() => undefined);
    await expect(tracker.track(Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    await Promise.resolve();
    expect(tracker.count()).toBe(0);
  });
});
