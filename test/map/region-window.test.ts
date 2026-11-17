import { MAX_STYLED_REGIONS, regionsForView, viewBox, WINDOW_FROM_ZOOM, type Bbox, type WindowRegion } from '../../src/native/map/region-window';

const box = (id: string, west: number, south: number, east: number, north: number): WindowRegion => ({ id, bbox: [west, south, east, north] as Bbox });
const ISTANBUL = box('34', 27.97, 40.74, 29.96, 41.67);
const KOCAELI = box('41', 29.32, 40.52, 30.51, 41.42);
const SAKARYA = box('54', 30.0, 40.4, 31.0, 41.2);
const DENIZLI = box('20', 28.57, 36.85, 30.08, 38.47);
const ANKARA = box('06', 31.4, 39.1, 33.2, 40.6);
const ALL = [ISTANBUL, KOCAELI, SAKARYA, DENIZLI, ANKARA];
const KADIKOY: [number, number] = [29.0275, 40.9878];

describe('view box', () => {
  it('shrinks with zoom and grows with the margin', () => {
    const wide = viewBox({ center: KADIKOY, zoom: 9 });
    const close = viewBox({ center: KADIKOY, zoom: 15 });
    expect(wide[2] - wide[0]).toBeGreaterThan((close[2] - close[0]) * 50);
    const padded = viewBox({ center: KADIKOY, zoom: 15 }, 30_000);
    expect(padded[2] - padded[0]).toBeGreaterThan(0.5);
  });

  it('stays centred on the view', () => {
    const [w, s, e, n] = viewBox({ center: KADIKOY, zoom: 12 });
    expect((w + e) / 2).toBeCloseTo(KADIKOY[0], 6);
    expect((s + n) / 2).toBeCloseTo(KADIKOY[1], 6);
  });
});

describe('regionsForView', () => {
  it('keeps everything when the app gives no view (the old behaviour) and sorts by id', () => {
    expect(regionsForView(undefined, ALL, null)).toEqual(['06', '20', '34', '41', '54']);
    expect(regionsForView({ center: [Number.NaN, 1], zoom: 12 }, ALL, null)).toHaveLength(5);
  });

  it('styles only the province under the view and a neighbour within the margin, never a far one', () => {
    expect(regionsForView({ center: [28.4, 41.2], zoom: 15 }, ALL, null)).toEqual(['34']);
    const near = regionsForView({ center: [29.9, 40.95], zoom: 15 }, ALL, null);
    expect(near).toContain('34');
    expect(near).toContain('41');
    expect(near).not.toContain('20');
    expect(near).not.toContain('06');
  });

  it('keeps the same set while the view stays inside it, returning the very same array', () => {
    const first = regionsForView({ center: KADIKOY, zoom: 15 }, ALL, null);
    expect(first).toEqual(['34', '41']);
    const again = regionsForView({ center: [29.05, 41.0], zoom: 16 }, ALL, first);
    expect(again).toBe(first);
  });

  it('switches when the view leaves the set and covers a province that is not in it', () => {
    const first = regionsForView({ center: KADIKOY, zoom: 15 }, ALL, null);
    const denizli = regionsForView({ center: [29.09, 37.78], zoom: 13 }, ALL, first);
    expect(denizli).toEqual(['20']);
    expect(regionsForView({ center: [29.09, 37.78], zoom: 13 }, ALL, denizli)).toBe(denizli);
  });

  it('picks up a province installed later that now lies under the view', () => {
    const before = regionsForView({ center: KADIKOY, zoom: 15 }, [KOCAELI, DENIZLI], null);
    expect(before).toEqual(['41']);
    const after = regionsForView({ center: KADIKOY, zoom: 15 }, ALL, before);
    expect(after).toEqual(['34', '41']);
  });

  it('drops a province that was removed', () => {
    const first = regionsForView({ center: [29.9, 40.95], zoom: 15 }, ALL, null);
    expect(first).toEqual(['34', '41', '54']);
    expect(regionsForView({ center: [29.9, 40.95], zoom: 15 }, [ISTANBUL, DENIZLI], first)).toEqual(['34']);
  });

  it('does not restyle while zoomed far out, so zooming around does not reload the map', () => {
    const first = regionsForView({ center: KADIKOY, zoom: 15 }, ALL, null);
    expect(WINDOW_FROM_ZOOM).toBe(9);
    expect(regionsForView({ center: [32, 39.8], zoom: 6 }, ALL, first)).toBe(first);
    expect(regionsForView({ center: [32, 39.8], zoom: 8.9 }, ALL, first)).toBe(first);
  });

  it('chooses the nearest provinces when the first view is zoomed far out', () => {
    const many = Array.from({ length: 12 }, (_, i) => box(String(i).padStart(2, '0'), 20 + i, 38, 20.9 + i, 39));
    const out = regionsForView({ center: [20.5, 38.5], zoom: 5 }, many, null);
    expect(out).toHaveLength(MAX_STYLED_REGIONS);
    expect(out).toEqual(['00', '01', '02', '03', '04', '05']);
  });

  it('never leaves out a province that is under the view, even above the limit, and fills the rest by distance', () => {
    const row = Array.from({ length: 10 }, (_, i) => box(String(i).padStart(2, '0'), 29 + i * 0.05, 40, 29.04 + i * 0.05, 41));
    const out = regionsForView({ center: [29.2, 40.5], zoom: 9 }, row, null, { max: 3 });
    expect(out.length).toBeGreaterThanOrEqual(3);
    for (const region of row.filter((r) => r.bbox[2] >= viewBox({ center: [29.2, 40.5], zoom: 9 })[0] && r.bbox[0] <= viewBox({ center: [29.2, 40.5], zoom: 9 })[2])) expect(out).toContain(region.id);
  });

  it('returns nothing when no province is installed', () => {
    expect(regionsForView({ center: KADIKOY, zoom: 15 }, [], null)).toEqual([]);
    expect(regionsForView(undefined, [], null)).toEqual([]);
  });

  it('is stable: the same input gives the same set', () => {
    const a = regionsForView({ center: [29.9, 40.95], zoom: 12 }, ALL, null);
    const b = regionsForView({ center: [29.9, 40.95], zoom: 12 }, [...ALL].reverse(), null);
    expect(a).toEqual(b);
  });
});
