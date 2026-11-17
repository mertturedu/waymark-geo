import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { buildStyle, type StyleInput } from '../../src/native/map/style';

const input = (extra: Partial<StyleInput> = {}): StyleInput => ({
  rootUrl: 'file:///var/mobile/Documents/yuksi-geo/',
  baseDir: 'files/base-20261022',
  regions: [{ id: '20', tilesPath: 'files/20/tiles-a.pmtiles' }, { id: '34', tilesPath: 'files/34/tiles-b.pmtiles' }],
  theme: 'light',
  lang: 'tr',
  hoods: [{ name: 'Çarşı', lng: 29.735, lat: 38.3 }],
  ...extra,
});

describe('the generated style is a valid MapLibre style', () => {
  it.each([
    ['light', 'tr'],
    ['dark', 'tr'],
    ['light', 'ar'],
    ['dark', 'el'],
  ] as const)('%s theme, %s labels', (theme, lang) => {
    const errors = validateStyleMin(buildStyle(input({ theme, lang })) as never);
    expect(errors.map((e) => `${e.message}`)).toEqual([]);
  });

  it('is valid with the traffic layer in the rush hour', () => {
    const errors = validateStyleMin(buildStyle(input({ traffic: { at: Date.UTC(2026, 10, 9) + 5 * 3_600_000 } })) as never);
    expect(errors.map((e) => `${e.message}`)).toEqual([]);
  });

  it('is valid with no province installed, with nothing but the background and with many provinces', () => {
    expect(validateStyleMin(buildStyle(input({ regions: [], hoods: [] })) as never).map((e) => e.message)).toEqual([]);
    expect(validateStyleMin(buildStyle(input({ baseDir: null, regions: [] })) as never).map((e) => e.message)).toEqual([]);
    const many = Array.from({ length: 12 }, (_, i) => ({ id: String(i + 1).padStart(2, '0'), tilesPath: `files/${i}/t.pmtiles` }));
    expect(validateStyleMin(buildStyle(input({ regions: many })) as never).map((e) => e.message)).toEqual([]);
  });
});
