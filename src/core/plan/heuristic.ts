import { costOf, type Problem } from './problem';
import { feasibleOrder, obeys, type Rules } from './rules';

export type Budget = { now: () => number; ms: number; seed: number };

type Meter = { ops: number; limit: number; stop: number; now: () => number };

const MAX_ROUNDS = 4000;
const OPS_PER_MS = 60_000;
const WALL_FACTOR = 1.5;
const MAX_SEGMENT = 5;

const busy = (meter: Meter): boolean => meter.ops < meter.limit && meter.now() < meter.stop;

function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function suffixRules(rules: Rules, placed: ReadonlySet<number>, taken: number): Rules | null {
  const remaining: number[] = [];
  for (let i = 0; i < rules.size; i++) if (!placed.has(i)) remaining.push(i);
  const index = new Map(remaining.map((node, i) => [node, i]));
  const pins = new Map<number, number>();
  for (const [node, slot] of rules.pins) {
    if (placed.has(node)) continue;
    if (slot < taken) return null;
    pins.set(index.get(node) as number, slot - taken);
  }
  const before: [number, number][] = [];
  for (const [a, b] of rules.before) {
    if (placed.has(b)) return null;
    if (!placed.has(a)) before.push([index.get(a) as number, index.get(b) as number]);
  }
  return { size: remaining.length, pins, before };
}

function construct(problem: Problem): number[] | null {
  const { size, rules } = problem;
  if (feasibleOrder(rules) === null) return null;
  const placed = new Set<number>();
  const sequence: number[] = [];
  let last = -1;
  while (sequence.length < size) {
    const candidates: number[] = [];
    for (let node = 0; node < size; node++) if (!placed.has(node)) candidates.push(node);
    const price = (node: number): number => (last === -1 ? (problem.from[node] as number) : ((problem.between[last] as ReadonlyArray<number>)[node] as number));
    candidates.sort((a, b) => price(a) - price(b) || a - b);
    let chosen = -1;
    for (const node of candidates) {
      const trial = new Set(placed);
      trial.add(node);
      const pinned = rules.pins.get(node);
      if (pinned !== undefined && pinned !== sequence.length) continue;
      const rest = suffixRules(rules, trial, sequence.length + 1);
      if (rest !== null && feasibleOrder(rest) !== null) {
        chosen = node;
        break;
      }
    }
    if (chosen === -1) return feasibleOrder(rules);
    placed.add(chosen);
    sequence.push(chosen);
    last = chosen;
  }
  return sequence;
}

function relocate(sequence: number[], from: number, length: number, to: number): number[] {
  const moved = sequence.slice(from, from + length);
  const rest = [...sequence.slice(0, from), ...sequence.slice(from + length)];
  return [...rest.slice(0, to), ...moved, ...rest.slice(to)];
}

function walker(problem: Problem): (a: number, b: number) => number {
  const { from, between, back } = problem;
  return (a, b) => (a === -1 ? (from[b] as number) : b === -1 ? (back ? (back[a] as number) : 0) : ((between[a] as ReadonlyArray<number>)[b] as number));
}

function improve(problem: Problem, start: number[], meter: Meter): number[] {
  const w = walker(problem);
  const size = start.length;
  let current = start;
  const forward = new Float64Array(size + 1);
  const reverse = new Float64Array(size + 1);
  const refresh = (): void => {
    for (let t = 0; t < size - 1; t++) {
      forward[t + 1] = (forward[t] as number) + w(current[t] as number, current[t + 1] as number);
      reverse[t + 1] = (reverse[t] as number) + w(current[t + 1] as number, current[t] as number);
    }
  };
  const at = (index: number): number => (index < 0 || index >= size ? -1 : (current[index] as number));
  refresh();
  const accept = (candidate: number[]): boolean => {
    if (!obeys(candidate, problem.rules)) return false;
    current = candidate;
    meter.ops += size;
    refresh();
    return true;
  };
  let better = true;
  while (better && busy(meter)) {
    better = false;
    for (let length = 1; length <= MAX_SEGMENT && !better; length++) {
      for (let i = 0; i + length <= size && !better; i++) {
        const head = at(i);
        const tail = at(i + length - 1);
        const before = at(i - 1);
        const after = at(i + length);
        const removed = w(before, head) + w(tail, after) - w(before, after);
        for (let j = -1; j < size && !better; j++) {
          if (j >= i - 1 && j <= i + length - 1) continue;
          meter.ops += 1;
          const left = at(j);
          const right = at(j + 1);
          const added = w(left, head) + w(tail, right) - w(left, right);
          if (added < removed - 1e-9) {
            const target = j < i ? j + 1 : j + 1 - length;
            better = accept(relocate(current, i, length, target));
          }
        }
        for (let j = -1; j < size && !better && length > 1; j++) {
          if (j >= i - 1 && j <= i + length - 1) continue;
          meter.ops += 1;
          const left = at(j);
          const right = at(j + 1);
          const inner = (reverse[i + length - 1] as number) - (reverse[i] as number) - ((forward[i + length - 1] as number) - (forward[i] as number));
          const added = w(left, tail) + w(head, right) - w(left, right) + inner;
          if (added < removed - 1e-9) {
            const moved = current.slice(i, i + length).reverse();
            const rest = [...current.slice(0, i), ...current.slice(i + length)];
            const target = j < i ? j + 1 : j + 1 - length;
            better = accept([...rest.slice(0, target), ...moved, ...rest.slice(target)]);
          }
        }
      }
    }
    for (let i = 0; i < size - 1 && !better; i++) {
      for (let j = i + 1; j < size && !better; j++) {
        meter.ops += 1;
        const inner = (reverse[j] as number) - (reverse[i] as number) - ((forward[j] as number) - (forward[i] as number));
        const delta = w(at(i - 1), at(j)) + w(at(i), at(j + 1)) - w(at(i - 1), at(i)) - w(at(j), at(j + 1)) + inner;
        if (delta < -1e-9) better = accept([...current.slice(0, i), ...current.slice(i, j + 1).reverse(), ...current.slice(j + 1)]);
      }
    }
    for (let i = 0; i < size - 2 && !better; i++) {
      for (let j = i + 2; j < size && !better; j++) {
        meter.ops += 1;
        const a = at(i);
        const b = at(j);
        const delta = w(at(i - 1), b) + w(b, at(i + 1)) + w(at(j - 1), a) + w(a, at(j + 1)) - w(at(i - 1), a) - w(a, at(i + 1)) - w(at(j - 1), b) - w(b, at(j + 1));
        if (delta < -1e-9) {
          const swapped = current.slice();
          swapped[i] = b;
          swapped[j] = a;
          better = accept(swapped);
        }
      }
    }
  }
  return current;
}

export function solveHeuristic(problem: Problem, budget: Budget): number[] | null {
  const first = construct(problem);
  if (first === null) return null;
  const meter: Meter = { ops: 0, limit: budget.ms * OPS_PER_MS, stop: budget.now() + budget.ms * WALL_FACTOR, now: budget.now };
  const next = random(budget.seed);
  let best = improve(problem, first, meter);
  let bestCost = costOf(problem, best);
  let current = best;
  let currentCost = bestCost;
  for (let round = 0; round < MAX_ROUNDS && busy(meter) && best.length > 3; round++) {
    const size = current.length;
    const a = Math.floor(next() * size);
    const length = 1 + Math.floor(next() * Math.min(5, size - 1));
    const to = Math.floor(next() * (size - length + 1));
    const kicked = relocate(current, Math.min(a, size - length), length, to);
    const start = obeys(kicked, problem.rules) ? kicked : current;
    const candidate = improve(problem, start, meter);
    const price = costOf(problem, candidate);
    if (price < currentCost - 1e-9 || next() < 0.02) {
      current = candidate;
      currentCost = price;
    }
    if (price < bestCost - 1e-9) {
      best = candidate;
      bestCost = price;
    }
  }
  return best;
}
