import type { RoutePack } from '../../../src/core/route/format';
import type { Snap } from '../../../src/core/route/snap';

export const seededSnaps = (pack: Pick<RoutePack, 'edges'>, seed: number): (() => Snap) => {
  let state = seed >>> 0;
  const random = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  return () => {
    const edge = Math.floor(random() * pack.edges.count);
    return { edge, offsetM: random() * (pack.edges.length[edge] as number), distanceM: 0, point: [0, 0] };
  };
};

export const p95 = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0;
};
