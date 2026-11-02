export type Heap = {
  push(node: number, key: number): void;
  popKey(): number;
  peekKey(): number;
  node(): number;
  size(): number;
  clear(): void;
};

export function createHeap(): Heap {
  const keys: number[] = [];
  const nodes: number[] = [];
  let popped = -1;

  const up = (from: number, node: number, key: number): void => {
    let i = from;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if ((keys[parent] as number) <= key) break;
      keys[i] = keys[parent] as number;
      nodes[i] = nodes[parent] as number;
      i = parent;
    }
    keys[i] = key;
    nodes[i] = node;
  };

  const down = (node: number, key: number, length: number): void => {
    let i = 0;
    for (;;) {
      let child = 2 * i + 1;
      if (child >= length) break;
      if (child + 1 < length && (keys[child + 1] as number) < (keys[child] as number)) child++;
      if ((keys[child] as number) >= key) break;
      keys[i] = keys[child] as number;
      nodes[i] = nodes[child] as number;
      i = child;
    }
    keys[i] = key;
    nodes[i] = node;
  };

  return {
    push(node, key) {
      keys.push(key);
      nodes.push(node);
      up(keys.length - 1, node, key);
    },
    popKey() {
      const top = keys[0] as number;
      popped = nodes[0] as number;
      const lastKey = keys.pop() as number;
      const lastNode = nodes.pop() as number;
      if (keys.length > 0) down(lastNode, lastKey, keys.length);
      return top;
    },
    peekKey: () => (keys.length > 0 ? (keys[0] as number) : Infinity),
    node: () => popped,
    size: () => keys.length,
    clear() {
      keys.length = 0;
      nodes.length = 0;
    },
  };
}
