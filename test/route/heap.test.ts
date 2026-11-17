import { createHeap } from '../../src/core/route/heap';

describe('createHeap order and bookkeeping', () => {
  it('keeps equal keys apart from their nodes and pops each node with its key', () => {
    const heap = createHeap();
    const input: [number, number][] = [[10, 4], [11, 2], [12, 4], [13, 1], [14, 3], [15, 2], [16, 5], [17, 1]];
    for (const [node, key] of input) heap.push(node, key);
    const popped: [number, number][] = [];
    while (heap.size() > 0) {
      const key = heap.popKey();
      popped.push([heap.node(), key]);
    }
    expect(popped.map((p) => p[1])).toEqual([1, 1, 2, 2, 3, 4, 4, 5]);
    expect(popped.slice().sort((a, b) => a[0] - b[0])).toEqual(input.slice().sort((a, b) => a[0] - b[0]).map(([node, key]) => [node, key]));
  });

  it('starts with an unset node and works again after being emptied by pops', () => {
    const heap = createHeap();
    expect(heap.node()).toBe(-1);
    heap.push(1, 1);
    heap.popKey();
    expect(heap.size()).toBe(0);
    heap.push(2, 7);
    heap.push(3, 6);
    expect(heap.popKey()).toBe(6);
    expect(heap.node()).toBe(3);
    expect(heap.popKey()).toBe(7);
    expect(heap.node()).toBe(2);
  });

  it('moves a small key past larger siblings and keeps the larger child when it is the smaller one', () => {
    const heap = createHeap();
    for (const key of [9, 8, 7, 6, 5, 4, 3, 2, 1]) heap.push(key, key);
    const order: number[] = [];
    while (heap.size() > 0) order.push(heap.popKey());
    expect(order).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    for (const key of [1, 2, 3, 4, 5, 6, 7]) heap.push(key, key);
    const again: number[] = [];
    while (heap.size() > 0) again.push(heap.popKey());
    expect(again).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});
