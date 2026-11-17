import { fitBounds, FIT_MAX_ZOOM, FIT_MIN_ZOOM } from '../../src/native/map/camera';
import { geometryView, numbersText, placeName } from '../../src/native/logic/geometry-view';
import type { PlaceGeometry } from '../../src/core/address/types';

const street: PlaceGeometry = { kind: 'street', lines: [[[29, 41], [29.001, 41], [29.002, 41.001]], [[29.01, 41], [29.011, 41]]], local: [1], numbers: [1, 84], parts: 2, points: 5 };

describe('numbersText', () => {
  it('writes a range, one number or nothing', () => {
    expect(numbersText([1, 84])).toBe('No 1-84');
    expect(numbersText([7, 7])).toBe('No 7');
    expect(numbersText(null)).toBe('');
  });
});

describe('geometryView', () => {
  it('marks the lines in the written neighbourhood and puts the name and range on its middle', () => {
    const view = geometryView(street, 'Bağdat Caddesi');
    expect(view.lines.features.map((f) => f.properties.local)).toEqual([0, 1]);
    expect(view.areas.features).toEqual([]);
    expect(view.label.features[0]).toMatchObject({ properties: { text: 'Bağdat Caddesi · No 1-84' }, geometry: { type: 'Point', coordinates: [29.011, 41] } });
  });

  it('uses the longest line when none is marked, and has no label without text', () => {
    const none = geometryView({ ...street, local: [], numbers: null }, 'Moda');
    expect(none.label.features[0]?.properties.text).toBe('Moda');
    expect(none.label.features[0]?.geometry).toMatchObject({ coordinates: [29.001, 41] });
    expect(geometryView({ ...street, numbers: null }, '').label.features).toEqual([]);
    expect(geometryView({ ...street, lines: [] }, 'x').label.features).toEqual([]);
  });

  it('turns an area into polygons and gives nothing for no geometry', () => {
    const ring: [number, number][] = [[29, 41], [29.1, 41], [29.1, 41.1], [29, 41]];
    const view = geometryView({ kind: 'area', level: 'district', polygons: [[ring], [ring, ring]], points: 12 });
    expect(view.areas.features).toHaveLength(2);
    expect(view.areas.features[1]).toMatchObject({ properties: { level: 'district' }, geometry: { type: 'Polygon' } });
    expect(view.lines.features).toEqual([]);
    expect(geometryView(null).lines.features).toEqual([]);
    expect(geometryView(undefined).areas.features).toEqual([]);
  });

  it('names a place by its street, neighbourhood or district', () => {
    expect(placeName({ components: { street: 'A', neighbourhood: 'B' } })).toBe('A');
    expect(placeName({ components: { neighbourhood: 'B', district: 'C' } })).toBe('B');
    expect(placeName({ components: { district: 'C' } })).toBe('C');
    expect(placeName({ components: {} })).toBe('');
  });
});

describe('fitBounds', () => {
  const view = { width: 400, height: 800, padding: 20 };

  it('centres the box and zooms in on a short street up to the limit', () => {
    const got = fitBounds([29, 41, 29.0005, 41.0003], view);
    expect(got.center[0]).toBeCloseTo(29.00025, 6);
    expect(got.center[1]).toBeCloseTo(41.00015, 6);
    expect(got.zoom).toBe(FIT_MAX_ZOOM);
    expect(fitBounds([29, 41, 29.0005, 41.0003], view, { maxZoom: 15 }).zoom).toBe(15);
  });

  it('shows the whole of a long street or area', () => {
    const street = fitBounds([29.037, 40.953, 29.096, 40.989], view);
    expect(street.zoom).toBeGreaterThan(11);
    expect(street.zoom).toBeLessThan(15);
    const wide = fitBounds([26, 36, 45, 42], view);
    expect(wide.zoom).toBeLessThan(6);
    expect(wide.zoom).toBeGreaterThanOrEqual(FIT_MIN_ZOOM);
    expect(fitBounds([26, 36, 45, 42], view, { minZoom: 1 }).zoom).toBeLessThan(wide.zoom + 1e-9);
  });

  it('is limited by the tighter side of the screen, copes with a point and a tiny screen', () => {
    const tall = fitBounds([29, 41, 29.01, 41.05], { width: 800, height: 400 });
    const flat = fitBounds([29, 41, 29.05, 41.01], { width: 800, height: 400 });
    expect(tall.zoom).toBeLessThan(flat.zoom);
    expect(fitBounds([29, 41, 29, 41], view).zoom).toBe(FIT_MAX_ZOOM);
    expect(fitBounds([29, 41, 29.01, 41.01], { width: 10, height: 10, padding: 50 }).zoom).toBeGreaterThanOrEqual(FIT_MIN_ZOOM);
    expect(fitBounds([29, 90, 29.01, 91], view).zoom).toBeLessThanOrEqual(FIT_MAX_ZOOM);
  });
});
