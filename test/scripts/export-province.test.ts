import { toCsv, toGeoJson, type ExportRow } from '../../scripts/export-province';

const rows: ExportRow[] = [
  { id: 'D34-n1', name: 'Bahariye Caddesi No:14, "Moda" Mah.', lon: 29.02, lat: 40.98, source: 'osm', confidence: 1 },
  { id: 'B34-x', name: 'No:7', lon: 29.03, lat: 40.99, source: 'predicted', confidence: 0.6 },
];

describe('export', () => {
  it('csv başlık, tırnak ve ondalıklarla yazar', () => {
    const lines = toCsv(rows).trim().split('\n');
    expect(lines[0]).toBe('id,ad,boylam,enlem,kaynak,guven');
    expect(lines[1]).toBe('D34-n1,"Bahariye Caddesi No:14, ""Moda"" Mah.",29.020000,40.980000,osm,1.00');
    expect(lines[2]).toBe('B34-x,No:7,29.030000,40.990000,predicted,0.60');
  });

  it('geojson nokta, kimlik ve özellikleri taşır', () => {
    const collection = JSON.parse(toGeoJson(rows)) as { features: { id: string; geometry: { coordinates: number[] }; properties: { source: string } }[] };
    expect(collection.features).toHaveLength(2);
    expect(collection.features[1]).toMatchObject({ id: 'B34-x', geometry: { coordinates: [29.03, 40.99] }, properties: { source: 'predicted' } });
  });
});
