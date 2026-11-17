import { deriveFor, deriveNames, evidenceOf, namedIndexOf, sameStreetName, streetOf, validate, type Business, type NamedPart, type Way } from '../../pipeline/build/street-names';

const way = (id: string, line: [number, number][]): Way => ({ id, lines: [line] });
const road: [number, number][] = [[29.0, 41.0], [29.002, 41.0]];
const shop = (id: string, name: string, lon: number, lat: number, addr: string): Business => ({ id, name, brand: null, lon, lat, addr });

const three = [
  shop('a', 'Fırın', 29.0003, 41.00015, 'Papatya Sk. No:5'),
  shop('b', 'Kuaför', 29.0010, 41.00015, 'Papatya Sokak 12'),
  shop('c', 'Market', 29.0017, 41.00015, 'Papatya Sk 20'),
];

describe('streetOf', () => {
  it('reads the street and keeps the spelling that was written', () => {
    expect(streetOf('Hanımeli Sk. No:4')).toMatchObject({ text: 'Hanımeli', number: '4' });
  });

  it('ignores addresses without a house number or with a numbered street', () => {
    expect(streetOf('Papatya Sokak')).toBeNull();
    expect(streetOf('2394. Sk. No:44')).toBeNull();
  });
});

describe('deriveFor', () => {
  it('names an unnamed road when three independent businesses along it write the same street', () => {
    const found = deriveFor(way('w1', road), evidenceOf(three), namedIndexOf([]));
    expect(found).toMatchObject({ name: 'Papatya Sokağı', key: 'papatya', support: 3 });
    expect(found?.evidence).toHaveLength(3);
  });

  it('needs enough independent businesses, not enough rows from one shop', () => {
    const chain = [shop('a', 'Migros', 29.0003, 41.00015, 'Papatya Sk. 5'), shop('b', 'Migros', 29.0010, 41.00015, 'Papatya Sk. 12'), shop('c', 'Migros', 29.0017, 41.00015, 'Papatya Sk. 20')];
    expect(deriveFor(way('w1', road), evidenceOf(chain), namedIndexOf([]))).toBeNull();
    expect(deriveFor(way('w1', road), evidenceOf(three.slice(0, 2)), namedIndexOf([]))).toBeNull();
  });

  it('does not name a road when the same name already belongs to a road close by', () => {
    const named: NamedPart[] = [{ name: 'Papatya Sokağı', lines: [[[29.0, 41.0008], [29.002, 41.0008]]] }];
    expect(deriveFor(way('w1', road), evidenceOf(three), namedIndexOf(named))).toBeNull();
  });

  it('ignores shops that are closer to a named road with another name', () => {
    const named: NamedPart[] = [{ name: 'Menekşe Sokağı', lines: [[[29.0, 41.0002], [29.002, 41.0002]]] }];
    expect(deriveFor(way('w1', road), evidenceOf(three), namedIndexOf(named))).toBeNull();
  });

  it('refuses a road whose businesses disagree', () => {
    const mixed = [...three, shop('d', 'Eczane', 29.0005, 41.0001, 'Lale Sk. 3'), shop('e', 'Kasap', 29.0012, 41.0001, 'Lale Sk. 9'), shop('f', 'Optik', 29.0016, 41.0001, 'Lale Sk. 11')];
    expect(deriveFor(way('w1', road), evidenceOf(mixed), namedIndexOf([]))).toBeNull();
  });

  it('wants the evidence spread along the road, not clustered at one corner', () => {
    const corner = [shop('a', 'Fırın', 29.0003, 41.00015, 'Papatya Sk. 5'), shop('b', 'Kuaför', 29.00031, 41.00015, 'Papatya Sk. 7'), shop('c', 'Market', 29.00032, 41.00015, 'Papatya Sk. 9')];
    expect(deriveFor(way('w1', road), evidenceOf(corner), namedIndexOf([]))).toBeNull();
  });
});

describe('deriveNames and validate', () => {
  it('names only the roads with evidence', () => {
    const far = way('w2', [[29.05, 41.05], [29.052, 41.05]]);
    expect(deriveNames([way('w1', road), far], three, []).map((d) => d.wayId)).toEqual(['w1']);
  });

  it('gets a hidden name back and counts equivalent spellings as right', () => {
    const part: NamedPart = { name: 'Papatya Sokağı', lines: [road] };
    const result = validate([{ part, way: way('w1', road) }], three, [part]);
    expect(result).toMatchObject({ tried: 1, proposed: 1, correct: 1, precision: 1 });
    expect(sameStreetName('Üst Çeşme Sokağı', 'Üstçeşme Sokağı')).toBe(true);
    expect(sameStreetName('Melisa Sokağı', 'Çamlıbel Sokağı')).toBe(false);
  });
});
