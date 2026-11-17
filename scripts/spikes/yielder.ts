export type Yield = () => Promise<void>;

export function makeYielder(options: { now: () => number; wait: () => Promise<void>; everyMs: number }): Yield {
  let last = options.now();
  return async () => {
    if (options.now() - last < options.everyMs) return;
    await options.wait();
    last = options.now();
  };
}
