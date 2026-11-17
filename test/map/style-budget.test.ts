import { buildStyle } from '../../src/native/map/style';
import { MAX_STYLED_REGIONS, regionsForView, type WindowRegion } from '../../src/native/map/region-window';

const ROW = 9;
const regions = (count: number): WindowRegion[] =>
  Array.from({ length: count }, (_, i) => {
    const west = 26 + (i % ROW) * 1.3;
    const south = 36 + Math.floor(i / ROW) * 1.1;
    return { id: String(i + 1).padStart(2, '0'), bbox: [west, south, west + 1.3, south + 1.1] };
  });

const styleOf = (all: WindowRegion[], only: string[] | null) =>
  buildStyle({
    rootUrl: 'file:///geo/',
    baseDir: 'files/base',
    regions: all.filter((region) => !only || only.includes(region.id)).map((region) => ({ id: region.id, tilesPath: `files/${region.id}/tiles.pmtiles`, placesPath: `files/${region.id}/places.pmtiles` })),
    theme: 'light',
    lang: 'tr',
  });

describe('style size with many provinces', () => {
  it.each([12, 81])('keeps the style small with %i provinces installed when only the ones near the view are in it', (count) => {
    const all = regions(count);
    const view = { center: [26.65, 36.55] as [number, number], zoom: 14 };
    const only = regionsForView(view, all, null);
    expect(only.length).toBeLessThanOrEqual(MAX_STYLED_REGIONS);
    expect(only.length).toBeGreaterThan(0);
    const small = styleOf(all, only);
    expect(small.layers.length).toBeLessThanOrEqual(520);
    expect(JSON.stringify(small).length).toBeLessThanOrEqual(900 * 1024);
    expect(Object.keys(small.sources).length).toBeLessThanOrEqual(2 * MAX_STYLED_REGIONS + 1);
  });

  it('is much smaller than the style with every province in it', () => {
    const all = regions(81);
    const everything = styleOf(all, null);
    const near = styleOf(all, regionsForView({ center: [26.65, 36.55], zoom: 14 }, all, null));
    expect(everything.layers.length).toBeGreaterThan(5000);
    expect(near.layers.length).toBeLessThan(everything.layers.length / 10);
    expect(JSON.stringify(near).length).toBeLessThan(JSON.stringify(everything).length / 10);
  });

  it('keeps the same base layers and draws every province under the view', () => {
    const all = regions(12);
    const only = regionsForView({ center: [26.65, 36.55], zoom: 14 }, all, null);
    const style = styleOf(all, only);
    for (const id of only) expect(Object.keys(style.sources)).toContain(`r${id}`);
    expect(style.layers.some((layer) => layer.id === 'earth@base' || layer.id.endsWith('@base'))).toBe(true);
  });
});
