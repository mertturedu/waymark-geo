export type Timers<H> = { now(): number; set(run: () => void, ms: number): H; clear(handle: H): void };

export function createCoalescer<H>(run: () => void, intervalMs: number, timers: Timers<H>): { notify(): void; stop(): void } {
  let last = Number.NEGATIVE_INFINITY;
  let waiting: H | null = null;

  const fire = (): void => {
    waiting = null;
    last = timers.now();
    run();
  };

  return {
    notify() {
      if (waiting !== null) return;
      const wait = intervalMs - (timers.now() - last);
      if (wait <= 0) fire();
      else waiting = timers.set(fire, wait);
    },
    stop() {
      if (waiting !== null) timers.clear(waiting);
      waiting = null;
    },
  };
}
