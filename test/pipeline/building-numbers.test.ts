import { placeDoors, predictNumbers, SOURCE_DIRECTORY, SOURCE_OSM, type Door } from '../../pipeline/build/building-numbers';
import type { Row } from '../../pipeline/build/building-pack-v2';

const row = (i: number, side: 1 | -1, s: number): Row => {
  const lon = 30 + s * 0.00001;
  const lat = 40 + (side === 1 ? 0.00005 : -0.00005);
  const cand = { chain: 1, component: 0, side, s, distanceM: 6 };
  const trace = { id: `b${i}`, lon, lat, area: 100, ring: [[lon - 0.00002, lat - 0.00002], [lon + 0.00002, lat - 0.00002], [lon + 0.00002, lat + 0.00002], [lon - 0.00002, lat + 0.00002], [lon - 0.00002, lat - 0.00002]] as [number, number][], height: null, floors: null, name: null, cls: null, src: null, rec: null };
  return { trace, link: { chain: 1, component: 0, side, distanceM: 6, s, second: null, third: null, candidates: [cand] }, seq: i, floors: 2, floorsSource: 4, osmStreet: null, osmNumber: null };
};

const rows = [...Array.from({ length: 10 }, (_, i) => row(i, 1, 10 + i * 14)), ...Array.from({ length: 10 }, (_, i) => row(10 + i, -1, 10 + i * 14))];
const doorAt = (i: number, num: number, src: 1 | 2 = SOURCE_OSM): Door => ({ lon: (rows[i] as Row).trace.lon, lat: (rows[i] as Row).trace.lat, num, text: String(num), src, street: src === SOURCE_OSM ? 1 : undefined, streetKey: 'ataturk' });
const keys = new Map([[1, 'ataturk']]);

describe('placeDoors', () => {
  it('kapıyı içinde bulunduğu binaya ve sokağın adayına yerleştirir', () => {
    const placed = placeDoors(rows, [doorAt(0, 1), doorAt(4, 9)], keys);
    expect([...placed.anchors.keys()].sort()).toEqual([0, 4]);
    expect(placed.anchors.get(4)?.[0]?.cand.s).toBe(66);
  });

  it('rehber kapısını sokak adı anahtarıyla bağlar, aynı numaranın uzak ikinci konumunu çelişki sayar', () => {
    const far: Door = { ...doorAt(0, 1), lon: 30.0003, lat: 40.00005 };
    const placed = placeDoors(rows, [doorAt(0, 1), doorAt(2, 5, SOURCE_DIRECTORY), far], keys);
    expect(placed.anchors.get(2)?.[0]?.door.src).toBe(SOURCE_DIRECTORY);
    expect(placed.conflicts).toBe(0);
  });
});

describe('predictNumbers', () => {
  it('çapalar arasını ara değerler, tek taraf numarası karşı tarafa eşlik ile yansır', () => {
    const placed = placeDoors(rows, [doorAt(0, 1), doorAt(4, 9)], keys);
    const out = predictNumbers(rows, placed.anchors);
    expect(out.numbers[0]).toMatchObject({ known: '1', source: SOURCE_OSM });
    expect(out.numbers[2]?.predicted).toMatchObject({ value: 5, extrapolated: false });
    expect(out.numbers[7]?.predicted?.value).toBeGreaterThan(9);
    expect(out.numbers[7]?.predicted?.extrapolated).toBe(true);
    const mirrored = out.numbers[12]?.predicted;
    expect((mirrored?.value ?? 1) % 2).toBe(0);
    expect(mirrored?.extrapolated).toBe(true);
    expect(out.ranges.find((r) => r.side === 1)).toMatchObject({ min: 1, max: 9, parity: 1, anchors: 2 });
  });

  it('aynı izde OSM kapısı varsa rehber kapısı çapa sayılmaz', () => {
    const placed = placeDoors(rows, [doorAt(0, 1), doorAt(4, 9), doorAt(2, 41, SOURCE_DIRECTORY)], keys);
    const out = predictNumbers(rows, placed.anchors);
    expect(out.numbers[2]?.known).toBe('41');
    expect(out.ranges.find((r) => r.side === 1)?.anchors).toBe(2);
  });

  it('çapası olmayan izde numara üretmez', () => {
    const out = predictNumbers(rows, new Map());
    expect(out.numbers.every((n) => n === null)).toBe(true);
    expect(out.ranges).toEqual([]);
  });
});
