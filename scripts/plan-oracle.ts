export type OracleInput = {
  from: ReadonlyArray<number>;
  between: ReadonlyArray<ReadonlyArray<number>>;
  back: ReadonlyArray<number> | null;
  pins: ReadonlyMap<number, number>;
  before: ReadonlyArray<readonly [number, number]>;
};

export function bestByEnumeration(input: OracleInput): number | null {
  const n = input.from.length;
  const need = new Array<number>(n).fill(0);
  for (const [a, b] of input.before) need[b] = (need[b] as number) | (1 << a);
  const slotOwner = new Map<number, number>();
  for (const [node, slot] of input.pins) slotOwner.set(slot, node);
  const cheapestInto = Array.from({ length: n }, (_, j) => {
    let least = input.from[j] as number;
    for (let i = 0; i < n; i++) if (i !== j) least = Math.min(least, (input.between[i] as ReadonlyArray<number>)[j] as number);
    return least;
  });
  let best = Infinity;
  const walk = (mask: number, last: number, cost: number, rest: number): void => {
    const slot = n - rest;
    if (rest === 0) {
      const total = cost + (input.back ? (input.back[last] as number) : 0);
      if (total < best) best = total;
      return;
    }
    if (cost + rest * 0 >= best) return;
    let floor = 0;
    for (let j = 0; j < n; j++) if (!(mask & (1 << j))) floor += cheapestInto[j] as number;
    if (cost + floor >= best) return;
    const owner = slotOwner.get(slot);
    for (let j = 0; j < n; j++) {
      if (mask & (1 << j)) continue;
      if (((need[j] as number) & mask) !== (need[j] as number)) continue;
      if (owner !== undefined && owner !== j) continue;
      const pinned = input.pins.get(j);
      if (pinned !== undefined && pinned !== slot) continue;
      const step = last === -1 ? (input.from[j] as number) : ((input.between[last] as ReadonlyArray<number>)[j] as number);
      walk(mask | (1 << j), j, cost + step, rest - 1);
    }
  };
  walk(0, -1, 0, n);
  return best === Infinity ? null : best;
}
