import { fitLayout, floorFromLayout, layoutKey } from '../../src/core/learned/layout';

const pairs = (list: [number, number][]) => list.map(([floor, door]) => ({ floor, door }));

describe('fitLayout', () => {
  it('learns doors per floor and keeps every observed range', () => {
    const layout = fitLayout(pairs([[0, 1], [0, 3], [1, 5], [1, 7], [2, 9], [2, 12], [3, 14]]));
    expect(layout).toMatchObject({ perFloor: 4, basement: 0, floors: 3, fit: 1, samples: 7 });
    expect(layout?.ranges).toEqual([[0, 1, 3], [1, 5, 7], [2, 9, 12], [3, 14, 14]]);
  });

  it('learns a basement from negative floors', () => {
    const layout = fitLayout(pairs([[-1, 1], [-1, 2], [0, 3], [0, 4], [1, 5], [1, 6]]));
    expect(layout).toMatchObject({ perFloor: 2, basement: 1 });
    expect(floorFromLayout(layout as never, 3)).toMatchObject({ value: 0, source: 'learned' });
  });

  it('needs three distinct pairs and ignores duplicates and nonsense', () => {
    expect(fitLayout(pairs([[1, 4], [1, 4], [2, 8]]))).toBeNull();
    expect(fitLayout(pairs([[1, 4], [2, 8], [500, 3], [1, -2]]))).toBeNull();
  });

  it('turns the per floor model off when declarations disagree', () => {
    const layout = fitLayout(pairs([[0, 1], [3, 2], [1, 30], [5, 31], [2, 7]]));
    expect((layout?.fit ?? 1) < 0.6).toBe(true);
    expect(layout?.perFloor).toBe(0);
    expect(floorFromLayout(layout as never, 100)).toBeNull();
  });
});

describe('floorFromLayout', () => {
  const layout = fitLayout(pairs([[0, 1], [0, 3], [1, 5], [1, 7], [2, 9], [2, 12], [3, 14], [3, 16]])) as NonNullable<ReturnType<typeof fitLayout>>;

  it('prefers an observed range', () => {
    expect(floorFromLayout(layout, 6)).toEqual({ value: 1, low: 1, high: 1, source: 'learned' });
  });

  it('extrapolates with the learned doors per floor', () => {
    expect(floorFromLayout(layout, 18)).toMatchObject({ value: 4, source: 'learned' });
  });

  it('widens the answer when the fit is only fair', () => {
    const fair = { ...layout, ranges: [], fit: 0.7 };
    const floor = floorFromLayout(fair, 9);
    expect(floor?.low).toBeLessThan(floor?.high as number);
  });
});

describe('layoutKey', () => {
  it('separates blocks of the same address', () => {
    expect(layoutKey('34|k|m|s|10', null)).toBe('34|k|m|s|10');
    expect(layoutKey('34|k|m|s|10', 'b')).toBe('34|k|m|s|10#b');
  });
});
