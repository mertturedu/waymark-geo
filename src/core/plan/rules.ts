export type Rules = {
  size: number;
  pins: ReadonlyMap<number, number>;
  before: ReadonlyArray<readonly [number, number]>;
};

const topological = (size: number, before: Rules['before']): number[] | null => {
  const into: number[] = new Array<number>(size).fill(0);
  const out: number[][] = Array.from({ length: size }, () => []);
  for (const [a, b] of before) {
    (out[a] as number[]).push(b);
    into[b] = (into[b] as number) + 1;
  }
  const ready: number[] = [];
  for (let i = 0; i < size; i++) if (into[i] === 0) ready.push(i);
  const order: number[] = [];
  while (ready.length > 0) {
    const next = ready.shift() as number;
    order.push(next);
    for (const b of out[next] as number[]) {
      into[b] = (into[b] as number) - 1;
      if (into[b] === 0) ready.push(b);
    }
  }
  return order.length === size ? order : null;
};

export function feasibleOrder(rules: Rules): number[] | null {
  const { size, pins, before } = rules;
  if (size === 0) return [];
  for (const [node, slot] of pins) if (!Number.isInteger(slot) || slot < 0 || slot >= size || node < 0 || node >= size) return null;
  const order = topological(size, before);
  if (order === null) return null;
  const release = Array.from({ length: size }, (_, i) => pins.get(i) ?? 0);
  const deadline = Array.from({ length: size }, (_, i) => pins.get(i) ?? size - 1);
  const successors: number[][] = Array.from({ length: size }, () => []);
  for (const [a, b] of before) (successors[a] as number[]).push(b);
  for (const a of order) for (const b of successors[a] as number[]) release[b] = Math.max(release[b] as number, (release[a] as number) + 1);
  for (let k = order.length - 1; k >= 0; k--) {
    const a = order[k] as number;
    for (const b of successors[a] as number[]) deadline[a] = Math.min(deadline[a] as number, (deadline[b] as number) - 1);
  }
  const placed = new Array<boolean>(size).fill(false);
  const result: number[] = [];
  for (let slot = 0; slot < size; slot++) {
    let pick = -1;
    for (let i = 0; i < size; i++) {
      if (placed[i] || (release[i] as number) > slot) continue;
      if (pick === -1 || (deadline[i] as number) < (deadline[pick] as number)) pick = i;
    }
    if (pick === -1 || (deadline[pick] as number) < slot) return null;
    placed[pick] = true;
    result.push(pick);
  }
  return result;
}

export function obeys(sequence: ReadonlyArray<number>, rules: Rules): boolean {
  if (sequence.length !== rules.size) return false;
  const at = new Array<number>(rules.size).fill(-1);
  for (let slot = 0; slot < sequence.length; slot++) {
    const node = sequence[slot] as number;
    if (node < 0 || node >= rules.size || at[node] !== -1) return false;
    at[node] = slot;
  }
  for (const [node, slot] of rules.pins) if (at[node] !== slot) return false;
  for (const [a, b] of rules.before) if ((at[a] as number) >= (at[b] as number)) return false;
  return true;
}
