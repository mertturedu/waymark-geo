import { hoodFeatures, hoodLabelLayer } from '../../src/native/map/style';

describe('neighbourhood label data', () => {
  it('drops empty names, bad points and repeats', () => {
    const data = hoodFeatures([
      { name: ' Caferağa ', lng: 29.02, lat: 40.98 },
      { name: 'Caferağa', lng: 29.02, lat: 40.98 },
      { name: '', lng: 29, lat: 41 },
      { name: 'Moda', lng: Number.NaN, lat: 41 },
      { name: 'Osmanağa', lng: 29.03, lat: 40.99 },
    ]);
    expect(data.features.map((f) => f.properties.name)).toEqual(['Caferağa', 'Osmanağa']);
    expect(data.features[0]!.geometry).toEqual({ type: 'Point', coordinates: [29.02, 40.98] });
  });

  it('returns an empty collection for no names', () => {
    expect(hoodFeatures([])).toEqual({ type: 'FeatureCollection', features: [] });
  });

  it('draws the names from zoom 12.5 with theme colours', () => {
    expect(hoodLabelLayer('light')).toMatchObject({ id: 'hood-labels', type: 'symbol', minzoom: 12.5 });
    expect(hoodLabelLayer('dark').paint['text-color']).not.toBe(hoodLabelLayer('light').paint['text-color']);
  });
});
