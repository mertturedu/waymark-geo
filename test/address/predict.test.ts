import fc from 'fast-check';
import { distanceM } from '../../src/core/geo/distance';
import { predictNumber } from '../../src/core/address/predict';
import { linearBaseline } from '../reference/linear';
import { miniRegion } from './helpers/mini-pack';
import { part, where } from '../pipeline/helpers/mini-work';
import { LINE, streetRows } from './helpers/predict-fixture';

const ODD = [1, 3, 5, 9, 11, 13, 15, 17, 19];
const EVEN = [2, 4, 6, 8, 10, 12, 14, 16, 18, 20];

async function setup(options: Parameters<typeof streetRows>[0] = { even: EVEN, odd: ODD }) {
  const fixture = await miniRegion(streetRows(options));
  const street = (await fixture.region.allNames('street')).find((n) => n.key === 'test') as { ref: number };
  const loc = (await fixture.region.hoodsOfStreet([street.ref]))[0] as { districtId: number; hoodId: number | null };
  return { ...fixture, street: { id: street.ref, districtId: loc.districtId, hoodId: loc.hoodId } };
}

const odd = (n: number) => ({ int: n, key: String(n), parity: 1 as const });
const at = (n: number): [number, number] => [28.6 + (n / 20) * 0.01, 40.7];

describe('predictNumber between two neighbours', () => {
  it('variant A walks the street line between the neighbours', async () => {
    const { region, street, close } = await setup();
    const p = await predictNumber(region, street, odd(7), { variant: 'A' });
    expect(p).toMatchObject({ precision: 'interpolated', variant: 'A' });
    expect(p?.coordinate[1]).toBeCloseTo(40.7, 8);
    expect(p?.coordinate[0]).toBeCloseTo(28.6 + (7 / 20) * 0.01, 5);
    await close();
  });

  it('variant B keeps the side of the street the neighbours are on', async () => {
    const { region, street, close } = await setup();
    const p = await predictNumber(region, street, odd(7), { variant: 'B' });
    expect(p?.coordinate[1]).toBeCloseTo(40.7 - 0.00005, 7);
    expect(p?.coordinate[0]).toBeCloseTo(28.6 + (7 / 20) * 0.01, 5);
    await close();
  });

  it('variant C goes straight between the two neighbour points', async () => {
    const { region, street, close } = await setup();
    const p = await predictNumber(region, street, odd(7), { variant: 'C' });
    expect(p?.variant).toBe('C');
    expect(p?.coordinate[1]).toBeCloseTo(40.7 - 0.00005, 7);
    expect(p?.coordinate[0]).toBeCloseTo(28.6 + (7 / 20) * 0.01, 5);
    await close();
  });

  it('uses only the same side of the street', async () => {
    const { region, street, close } = await setup();
    const even = { int: 7, key: '7', parity: 0 as const };
    const p = await predictNumber(region, street, even, { variant: 'C' });
    expect(p?.coordinate[1]).toBeCloseTo(40.7 + 0.00005, 7);
    await close();
  });

  it('leaves out addresses it is told to hide', async () => {
    const { region, street, close } = await setup();
    const rows = await region.neighbours(street.id, 1);
    const hide = new Set(rows.filter((r) => r.num === 5).map((r) => r.id));
    const p = await predictNumber(region, street, odd(7), { variant: 'C', exclude: hide });
    expect(p?.coordinate[0]).toBeCloseTo(at(3)[0] + ((7 - 3) / (9 - 3)) * (at(9)[0] - at(3)[0]), 6);
    await close();
  });

  it('agrees with the independent reference on the walked line', async () => {
    const { region, street, close } = await setup();
    const neighbours = (await region.neighbours(street.id, 1)).map((r) => ({ int: r.num as number, point: [r.lng, r.lat] as [number, number] }));
    for (const target of [2, 4, 6, 7, 8, 10, 12, 14, 16, 18]) {
      if (target % 2 === 0) continue;
      const expected = linearBaseline(neighbours, LINE, target);
      const p = await predictNumber(region, street, odd(target), { variant: 'A' });
      expect(expected).not.toBeNull();
      expect(distanceM(p?.coordinate as [number, number], expected as [number, number])).toBeLessThan(0.5);
    }
    await close();
  });

  it('puts the answer inside the box of the neighbours for variants B and C', async () => {
    const { region, street, close } = await setup();
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 8 }), fc.constantFrom('B' as const, 'C' as const), async (k, variant) => {
        const target = 2 * k + 6 + 1;
        if (target >= 19 || ODD.includes(target)) return;
        const p = await predictNumber(region, street, odd(target), { variant });
        expect(p).not.toBeNull();
        const lo = Math.max(...ODD.filter((n) => n < target));
        const hi = Math.min(...ODD.filter((n) => n > target));
        const box = [Math.min(at(lo)[0], at(hi)[0]), Math.max(at(lo)[0], at(hi)[0])];
        expect(p!.coordinate[0]).toBeGreaterThanOrEqual(box[0]! - 1e-6);
        expect(p!.coordinate[0]).toBeLessThanOrEqual(box[1]! + 1e-6);
      }),
      { numRuns: 30, seed: 71 },
    );
    await close();
  });
});

describe('predictNumber default', () => {
  it('uses variant B, the one the experiment chose', async () => {
    const { region, street, close } = await setup();
    const p = await predictNumber(region, street, odd(7));
    expect(p?.variant).toBe('B');
    expect(p?.coordinate[1]).toBeCloseTo(40.7 - 0.00005, 7);
    await close();
  });
});

describe('predictNumber with one neighbour or none', () => {
  it('takes the nearest neighbour when the number is past the end and says so', async () => {
    const { region, street, close } = await setup();
    const p = await predictNumber(region, street, odd(21), { variant: 'A' });
    expect(p).toMatchObject({ precision: 'interpolated', variant: 'one-sided' });
    expect(p?.coordinate[0]).toBeCloseTo(28.6 + (19 / 20) * 0.01, 5);
    const between = await predictNumber(region, street, odd(7), { variant: 'A' });
    expect(p!.confidence).toBeLessThan(between!.confidence);
    await close();
  });

  it('falls back to the middle of the street when that side has no numbers', async () => {
    const { region, street, close } = await setup({ even: EVEN, odd: [] });
    const p = await predictNumber(region, street, odd(7));
    expect(p).toMatchObject({ precision: 'street', variant: 'street' });
    expect(p?.coordinate[0]).toBeCloseTo(28.605, 5);
    expect(p?.coordinate[1]).toBeCloseTo(40.7, 7);
    await close();
  });

  it('falls back to the neighbourhood and then the district when the street has no line', async () => {
    const hood = await setup({ even: [2], odd: [], withLine: false });
    const p = await predictNumber(hood.region, hood.street, odd(7));
    expect(p).toMatchObject({ precision: 'neighbourhood', variant: 'hood' });
    expect(p?.coordinate).toEqual([28.6, 40.7]);
    await hood.close();
    const noHood = await setup({ even: [2], odd: [], withLine: false, hood: false });
    const q = await predictNumber(noHood.region, noHood.street, odd(7));
    expect(q).toMatchObject({ precision: 'district', variant: 'district' });
    expect(q?.coordinate).toEqual([28.7, 41]);
    await noHood.close();
  });

  it('never returns the precision address', async () => {
    const { region, street, close } = await setup();
    for (const n of [1, 7, 8, 21, 40, 0]) {
      const p = await predictNumber(region, street, { int: n, key: String(n), parity: (n % 2) as 0 | 1 });
      expect(p?.precision).not.toBe('address');
    }
    await close();
  });
});

describe('predictNumber for a street name shared by two districts', () => {
  async function shared() {
    const rows = streetRows({ even: EVEN, odd: ODD });
    rows.streets.push(part('Test Sokak', where('r11', 'r21'), [[[29.1, 40.7], [29.11, 40.7]]], ['w9002']));
    const fixture = await miniRegion(rows);
    const street = (await fixture.region.allNames('street')).find((n) => n.key === 'test') as { ref: number };
    const locs = await fixture.region.hoodsOfStreet([street.ref]);
    const other = locs.find((l) => l.districtId === 2) as { districtId: number; hoodId: number | null };
    const own = locs.find((l) => l.districtId === 1) as { districtId: number; hoodId: number | null };
    return { ...fixture, other: { id: street.ref, ...other }, own: { id: street.ref, ...own } };
  }

  it('does not borrow doors from another district', async () => {
    const { region, other, close } = await shared();
    const p = await predictNumber(region, other, odd(7));
    expect(p).toMatchObject({ precision: 'street', variant: 'street' });
    expect(p?.coordinate[0]).toBeCloseTo(29.105, 5);
    await close();
  });

  it('still predicts in the district that has the doors', async () => {
    const { region, own, close } = await shared();
    expect(await predictNumber(region, own, odd(7))).toMatchObject({ precision: 'interpolated', variant: 'B' });
    await close();
  });

  it('uses doors of other neighbourhoods of the same district when the own one has too few', async () => {
    const { region, own, close } = await shared();
    const p = await predictNumber(region, { ...own, hoodId: 999 }, odd(7));
    expect(p).toMatchObject({ precision: 'interpolated' });
    await close();
  });
});

describe('predictNumber with a building lookup', () => {
  const centre: [number, number] = [28.6035, 40.69995];

  it('moves a guess between two neighbours to the building the lookup finds', async () => {
    const { region, street, close } = await setup();
    const seen: [number, number][] = [];
    const p = await predictNumber(region, street, odd(7), { snap: async (point) => (seen.push(point), centre) });
    expect(p).toMatchObject({ precision: 'interpolated', variant: 'B', snapped: true });
    expect(p?.coordinate).toEqual(centre);
    expect(seen).toHaveLength(1);
    await close();
  });

  it('keeps the guess when the lookup finds nothing', async () => {
    const { region, street, close } = await setup();
    const plain = await predictNumber(region, street, odd(7), {});
    const p = await predictNumber(region, street, odd(7), { snap: async () => null });
    expect(p?.coordinate).toEqual(plain?.coordinate);
    expect(p?.snapped).toBe(false);
    await close();
  });

  it('does not use the lookup for a guess from one side only', async () => {
    const { region, street, close } = await setup({ even: EVEN, odd: [1, 3, 5] });
    let calls = 0;
    const one = await predictNumber(region, street, odd(15), { snap: async () => (calls++, centre) });
    expect(one?.variant).toBe('one-sided');
    expect(calls).toBe(0);
    await close();
  });

  it('does not use the lookup for the street itself', async () => {
    const { region, street, close } = await setup({ even: [], odd: [] });
    let calls = 0;
    const p = await predictNumber(region, street, odd(7), { snap: async () => (calls++, centre) });
    expect(p?.precision).toBe('street');
    expect(calls).toBe(0);
    await close();
  });
});
