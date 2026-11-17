import { costOf, type Problem } from './problem';

export const EXACT_LIMIT = 12;

export function solveExact(problem: Problem): number[] | null {
  const { size, rules } = problem;
  if (size === 0) return [];
  const preds = new Array<number>(size).fill(0);
  for (const [a, b] of rules.before) preds[b] = (preds[b] as number) | (1 << a);
  const reserved = new Map<number, number>();
  for (const [node, slot] of rules.pins) {
    if (slot < 0 || slot >= size || reserved.has(slot)) return null;
    reserved.set(slot, node);
  }
  const full = (1 << size) - 1;
  const best = new Float64Array((full + 1) * size).fill(Infinity);
  const from = new Int8Array((full + 1) * size).fill(-1);
  const popcount = (value: number): number => {
    let count = 0;
    for (let v = value; v !== 0; v &= v - 1) count++;
    return count;
  };
  const allowed = (mask: number, node: number): boolean => {
    if (mask & (1 << node)) return false;
    if (((preds[node] as number) & mask) !== (preds[node] as number)) return false;
    const slot = popcount(mask);
    const owner = reserved.get(slot);
    if (owner !== undefined && owner !== node) return false;
    const pinned = rules.pins.get(node);
    return pinned === undefined || pinned === slot;
  };
  for (let node = 0; node < size; node++) if (allowed(0, node)) best[(1 << node) * size + node] = problem.from[node] as number;
  for (let mask = 1; mask <= full; mask++) {
    for (let last = 0; last < size; last++) {
      const here = best[mask * size + last] as number;
      if (here === Infinity) continue;
      for (let node = 0; node < size; node++) {
        if (!allowed(mask, node)) continue;
        const total = here + ((problem.between[last] as ReadonlyArray<number>)[node] as number);
        const target = (mask | (1 << node)) * size + node;
        if (total < (best[target] as number)) {
          best[target] = total;
          from[target] = last;
        }
      }
    }
  }
  let end = -1;
  let endCost = Infinity;
  for (let last = 0; last < size; last++) {
    const total = (best[full * size + last] as number) + (problem.back ? (problem.back[last] as number) : 0);
    if (total < endCost) {
      endCost = total;
      end = last;
    }
  }
  if (end === -1) return null;
  const sequence: number[] = [];
  let mask = full;
  for (let node = end; node !== -1; ) {
    sequence.push(node);
    const previous = from[mask * size + node] as number;
    mask &= ~(1 << node);
    node = previous;
  }
  sequence.reverse();
  return costOf(problem, sequence) === Infinity ? null : sequence;
}
