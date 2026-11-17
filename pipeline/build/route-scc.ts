import type { Csr } from '../../src/core/route/plain';

export type Component = { inside: Uint8Array; size: number };

export function largestComponent(g: Csr): Component {
  const n = g.n;
  const index = new Int32Array(n).fill(-1);
  const low = new Int32Array(n);
  const onStack = new Uint8Array(n);
  const label = new Int32Array(n).fill(-1);
  const cursor = new Uint32Array(n);
  const stack: number[] = [];
  const work: number[] = [];
  const sizes: number[] = [];
  let counter = 0;
  for (let root = 0; root < n; root++) {
    if (index[root] !== -1) continue;
    work.push(root);
    index[root] = low[root] = counter++;
    cursor[root] = g.first[root] as number;
    stack.push(root);
    onStack[root] = 1;
    while (work.length > 0) {
      const v = work[work.length - 1] as number;
      if ((cursor[v] as number) < (g.first[v + 1] as number)) {
        const u = g.to[cursor[v] as number] as number;
        cursor[v] = (cursor[v] as number) + 1;
        if (index[u] === -1) {
          index[u] = low[u] = counter++;
          cursor[u] = g.first[u] as number;
          stack.push(u);
          onStack[u] = 1;
          work.push(u);
        } else if (onStack[u] === 1) {
          low[v] = Math.min(low[v] as number, index[u] as number);
        }
        continue;
      }
      work.pop();
      if (low[v] === index[v]) {
        let size = 0;
        const id = sizes.length;
        for (;;) {
          const w = stack.pop() as number;
          onStack[w] = 0;
          label[w] = id;
          size++;
          if (w === v) break;
        }
        sizes.push(size);
      }
      const parent = work[work.length - 1];
      if (parent !== undefined) low[parent] = Math.min(low[parent] as number, low[v] as number);
    }
  }
  let best = -1;
  for (let id = 0; id < sizes.length; id++) if (best === -1 || (sizes[id] as number) > (sizes[best] as number)) best = id;
  const inside = new Uint8Array(n);
  for (let v = 0; v < n; v++) if (label[v] === best) inside[v] = 1;
  return { inside, size: best === -1 ? 0 : (sizes[best] as number) };
}
