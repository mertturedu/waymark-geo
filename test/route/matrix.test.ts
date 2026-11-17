import { contract } from '../../pipeline/build/route-ch';
import { createMatrixSolver, UNREACHABLE } from '../../src/core/route/matrix';

function hierarchyOf(n: number, tail: number[], head: number[], w: number[], len: number[]) {
  const { hierarchy, toNew } = contract({ n, tail: Uint32Array.from(tail), head: Uint32Array.from(head), ds: Uint32Array.from(w), len: Uint32Array.from(len), pa: Uint32Array.from(tail.map((_, i) => i)) });
  return { h: hierarchy, id: (v: number) => toNew[v] as number };
}

describe('createMatrixSolver', () => {
  const { h, id } = hierarchyOf(5, [0, 1, 2, 3], [1, 2, 3, 4], [5, 7, 9, 11], [50, 70, 90, 110]);
  const label = (v: number, w = 0, len = 0) => ({ node: id(v), w, len });

  it('fills every pair with the weight and the length of the best path and marks the unreachable', () => {
    const solver = createMatrixSolver(h);
    const got = solver.solve([[label(0)], [label(2)], [label(4)]], [[label(1)], [label(4)], [label(0)]]);
    expect(Array.from(got.w)).toEqual([5, 32, 0, UNREACHABLE, 20, UNREACHABLE, UNREACHABLE, 0, UNREACHABLE]);
    expect(got.len[0]).toBe(50);
    expect(got.len[1]).toBe(320);
    expect(got.len[4]).toBe(200);
  });

  it('adds the head starts of the labels and takes the best label of a stop', () => {
    const solver = createMatrixSolver(h);
    const got = solver.solve([[label(0, 100, 1000), label(1, 1, 10)]], [[label(4, 2, 20), label(3, 50, 500)]]);
    expect(got.w[0]).toBe(1 + 7 + 9 + 11 + 2);
    expect(got.len[0]).toBe(10 + 70 + 90 + 110 + 20);
  });

  it('keeps the cheaper of two labels on the same node, in either order', () => {
    const solver = createMatrixSolver(h);
    expect(solver.solve([[label(0, 9, 90), label(0, 2, 20)]], [[label(1)]]).w[0]).toBe(7);
    expect(solver.solve([[label(0, 2, 20), label(0, 9, 90)]], [[label(1)]]).w[0]).toBe(7);
    expect(solver.solve([[label(0)]], [[label(1, 9, 90), label(1, 2, 20)]]).w[0]).toBe(7);
    expect(solver.solve([[label(0)]], [[label(1, 2, 20), label(1, 9, 90)]]).w[0]).toBe(7);
    expect(solver.solve([[label(0, 9, 90), label(0, 2, 20)]], [[label(1)]]).len[0]).toBe(70);
  });

  it('gives the same answers when asked again with other questions in between', () => {
    const solver = createMatrixSolver(h);
    const first = solver.solve([[label(0)]], [[label(4)]]);
    solver.solve([[label(3)]], [[label(4)]]);
    const again = solver.solve([[label(0)]], [[label(4)]]);
    expect(Array.from(again.w)).toEqual(Array.from(first.w));
    expect(Array.from(again.len)).toEqual(Array.from(first.len));
    expect(again.w[0]).toBe(32);
  });

  it('answers empty questions with empty tables', () => {
    const solver = createMatrixSolver(h);
    expect(solver.solve([], [[label(1)]]).w).toHaveLength(0);
    expect(solver.solve([[label(1)]], []).w).toHaveLength(0);
  });

  it('keeps the first best path when two cost the same', () => {
    const square = hierarchyOf(4, [0, 0, 1, 2], [1, 2, 3, 3], [5, 5, 5, 5], [10, 30, 10, 30]);
    const solver = createMatrixSolver(square.h);
    const got = solver.solve([[{ node: square.id(0), w: 0, len: 0 }]], [[{ node: square.id(3), w: 0, len: 0 }]]);
    expect(got.w[0]).toBe(10);
    expect([20, 60]).toContain(got.len[0]);
  });
});
