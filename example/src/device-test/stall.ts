export function makeStallMonitor(options: { now: () => number; everyMs: number }) {
  let last = options.now();
  let max = 0;
  return {
    tick(): void {
      const at = options.now();
      max = Math.max(max, at - last - options.everyMs);
      last = at;
    },
    reset(): void {
      max = 0;
      last = options.now();
    },
    maxStallMs: (): number => max,
    note: (limitMs: number): string => (max >= limitMs ? `en uzun takılma ${max} ms` : ''),
  };
}
