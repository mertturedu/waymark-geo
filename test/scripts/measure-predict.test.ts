import { chooseVariant, pickTargets, summarize, type AddressPoint } from '../../scripts/measure-predict';

const row = (id: number, street: number, num: number, parity: 0 | 1 = (num % 2) as 0 | 1): AddressPoint => ({ id, streetId: street, districtId: 1, hoodId: 1, num, parity, lng: 29 + num / 1000, lat: 41 });

describe('pickTargets', () => {
  const rows = [row(1, 10, 1), row(2, 10, 3), row(3, 10, 5), row(4, 10, 2), row(5, 10, 4), row(6, 11, 1), row(7, 11, 3), row(8, 12, 7)];

  it('keeps only doors with a lower and an upper neighbour on the same side of the same street', () => {
    const picked = pickTargets(rows, 100, 1);
    expect(picked.both.map((r) => r.id)).toEqual([2]);
  });

  it('lists the doors that have a neighbour on one side only, apart', () => {
    const picked = pickTargets(rows, 100, 1);
    expect(picked.oneSided.map((r) => r.id).sort((a, b) => a - b)).toEqual([1, 3, 4, 5, 6, 7]);
    expect(picked.alone.map((r) => r.id)).toEqual([8]);
  });

  it('is repeatable for one seed, differs for another, and respects the limit', () => {
    const many: AddressPoint[] = Array.from({ length: 200 }, (_, i) => row(i + 1, 1, (i + 1) * 2, 0));
    const a = pickTargets(many, 20, 7).both.map((r) => r.id);
    expect(a).toHaveLength(20);
    expect(pickTargets(many, 20, 7).both.map((r) => r.id)).toEqual(a);
    expect(pickTargets(many, 20, 8).both.map((r) => r.id)).not.toEqual(a);
  });

  it('looks for the neighbours inside the same district of the street', () => {
    const inDistrict = (r: AddressPoint, districtId: number): AddressPoint => ({ ...r, districtId });
    const split = [inDistrict(row(1, 1, 1), 1), inDistrict(row(2, 1, 3), 2), inDistrict(row(3, 1, 5), 1), inDistrict(row(4, 1, 7), 2), inDistrict(row(5, 1, 9), 2)];
    const picked = pickTargets(split, 100, 1);
    expect(picked.both.map((r) => r.id)).toEqual([4]);
    expect(picked.alone.map((r) => r.id)).toEqual([]);
  });

  it('skips doors whose number repeats on the street', () => {
    const twice = [row(1, 1, 1), row(2, 1, 3), row(3, 1, 3), row(4, 1, 5)];
    expect(pickTargets(twice, 100, 1).both).toEqual([]);
  });
});

describe('summarize', () => {
  it('gives the median and the 90th percentile', () => {
    expect(summarize([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toEqual({ count: 10, median: 5.5, p90: 9.1 });
    expect(summarize([4])).toEqual({ count: 1, median: 4, p90: 4 });
    expect(summarize([])).toEqual({ count: 0, median: 0, p90: 0 });
  });
});

describe('chooseVariant', () => {
  const stats = (median: number, p90: number) => ({ count: 100, median, p90 });
  const perProvince = (a: [number, number], b: [number, number], c: [number, number], base: [number, number]) => ({
    '34': { A: stats(...a), B: stats(...b), C: stats(...c), base: stats(...base) },
  });

  it('takes the variant with the smallest pooled median when it is not worse than the baseline anywhere', () => {
    const result = chooseVariant(perProvince([12, 40], [8, 30], [9, 35], [12, 40]));
    expect(result.variant).toBe('B');
  });

  it('keeps A when the best variant is worse than the baseline in some province at the median or the 90th percentile', () => {
    expect(chooseVariant(perProvince([12, 40], [8, 41], [9, 45], [12, 40])).variant).toBe('A');
    expect(chooseVariant(perProvince([12, 40], [13, 30], [14, 30], [12, 40])).variant).toBe('A');
  });

  it('says why', () => {
    expect(chooseVariant(perProvince([12, 40], [8, 30], [9, 35], [12, 40])).reason).toMatch(/B/);
    expect(chooseVariant(perProvince([12, 40], [12, 40], [12, 40], [12, 40])).variant).toBe('A');
  });
});
