import { decodeLayer, decodeTile, decodeValue, encodeLayer, encodeTile, featureId, featureProperties, pruneLayer, type MvtLayer } from '../../pipeline/build/mvt';

const utf8 = new TextEncoder();

const varint = (value: number): number[] => {
  const out: number[] = [];
  let rest = value;
  while (rest >= 128) {
    out.push((rest % 128) + 128);
    rest = Math.floor(rest / 128);
  }
  out.push(rest);
  return out;
};
const message = (key: number, body: number[]): number[] => [...varint(key), ...varint(body.length), ...body];
const text = (value: string): number[] => [...utf8.encode(value)];
const stringValue = (value: string): number[] => message(10, text(value));
const intValue = (value: number): number[] => [32, ...varint(value)];

const feature = (id: number | null, tags: number[], type: number, geometry: number[]): number[] => [
  ...(id === null ? [] : [8, ...varint(id)]),
  ...(tags.length > 0 ? message(18, tags.flatMap(varint)) : []),
  24,
  ...varint(type),
  ...message(34, geometry),
];

const layerBytes = (name: string, features: number[][], keys: string[], values: number[][]): Uint8Array =>
  Uint8Array.from([120, 2, ...message(10, text(name)), ...features.flatMap((f) => message(18, f)), ...keys.flatMap((k) => message(26, text(k))), ...values.flatMap((v) => message(34, v)), 40, ...varint(4096)]);

const sample = (): Uint8Array =>
  layerBytes(
    'pois',
    [feature(7, [0, 0, 1, 1], 1, [9, 50, 34]), feature(300, [0, 2, 2, 3], 1, [9, 2, 4]), feature(null, [1, 1], 1, [9, 0, 0])],
    ['kind', 'name', 'sort_rank'],
    [stringValue('cafe'), stringValue('Kahve'), stringValue('park'), intValue(12)],
  );

describe('decodeLayer and encodeLayer', () => {
  it('write a layer back byte for byte', () => {
    const bytes = sample();
    const layer = decodeLayer(bytes) as MvtLayer;
    expect(layer.name).toBe('pois');
    expect(layer.version).toBe(2);
    expect(layer.keys).toEqual(['kind', 'name', 'sort_rank']);
    expect(layer.features).toHaveLength(3);
    expect(Buffer.from(encodeLayer(layer)).equals(Buffer.from(bytes))).toBe(true);
  });

  it('write a whole tile back byte for byte', () => {
    const tile = encodeTile([sample(), sample()]);
    const { layers, foreign } = decodeTile(tile);
    expect(foreign).toBe(0);
    expect(Buffer.from(encodeTile(layers.map((l) => encodeLayer(decodeLayer(l) as MvtLayer)))).equals(Buffer.from(tile))).toBe(true);
  });

  it('count tile fields that are not layers', () => {
    expect(decodeTile(Uint8Array.from([8, 1, ...message(26, [...sample()])])).foreign).toBe(1);
  });

  it('refuse layers it could not write back the same way', () => {
    expect(decodeLayer(Uint8Array.from([...sample(), 48, 1]))).toBeNull();
    expect(decodeLayer(Uint8Array.from([...message(10, text('a')), ...message(26, text('k')), ...message(10, text('b'))]))).toBeNull();
    expect(decodeLayer(layerBytes('x', [feature(1, [0, 5], 1, [9, 0, 0])], ['kind'], [stringValue('a')]))).toBeNull();
    expect(decodeLayer(layerBytes('x', [[...feature(1, [], 1, [9, 0, 0]), 40, 1]], [], []))).toBeNull();
  });

  it('read feature ids and properties', () => {
    const layer = decodeLayer(sample()) as MvtLayer;
    const values = layer.values.map(decodeValue);
    expect(featureId(layer.features[1]!)).toBe(300);
    expect(featureId(layer.features[2]!)).toBeUndefined();
    expect(featureProperties(layer, layer.features[1]!, values)).toEqual({ kind: 'park', sort_rank: 12 });
  });
});

describe('decodeValue', () => {
  const float = (value: number): number[] => {
    const out = Buffer.alloc(4);
    out.writeFloatLE(value);
    return [21, ...out];
  };
  const double = (value: number): number[] => {
    const out = Buffer.alloc(8);
    out.writeDoubleLE(value);
    return [25, ...out];
  };

  it('read every value type', () => {
    expect(decodeValue(Uint8Array.from(stringValue('Bursa')))).toBe('Bursa');
    expect(decodeValue(Uint8Array.from(float(1.5)))).toBe(1.5);
    expect(decodeValue(Uint8Array.from(double(40.25)))).toBe(40.25);
    expect(decodeValue(Uint8Array.from(intValue(150)))).toBe(150);
    expect(decodeValue(Uint8Array.from([32, 255, 255, 255, 255, 255, 255, 255, 255, 255, 1]))).toBe(-1);
    expect(decodeValue(Uint8Array.from([40, ...varint(2 ** 40)]))).toBe(2 ** 40);
    expect(decodeValue(Uint8Array.from([48, 3]))).toBe(-2);
    expect(decodeValue(Uint8Array.from([48, 4]))).toBe(2);
    expect(decodeValue(Uint8Array.from([56, 1]))).toBe(true);
    expect(decodeValue(Uint8Array.from([56, 0]))).toBe(false);
    expect(decodeValue(Uint8Array.from([64, 1]))).toBeNull();
  });
});

describe('pruneLayer', () => {
  it('drop unused keys and values and keep the order of what stays', () => {
    const layer = decodeLayer(sample()) as MvtLayer;
    const lean = pruneLayer(layer, (key) => key === 'kind');
    expect(lean.keys).toEqual(['kind']);
    expect(lean.values.map(decodeValue)).toEqual(['cafe', 'park']);
    expect(lean.features.map((f) => f.tags)).toEqual([[0, 0], [0, 1], []]);
    expect(lean.features.map((f) => featureId(f))).toEqual([7, 300, undefined]);
  });

  it('drop features and the keys only they used', () => {
    const layer = decodeLayer(sample()) as MvtLayer;
    const lean = pruneLayer(layer, () => true, (f) => featureId(f) !== 300);
    expect(lean.features).toHaveLength(2);
    expect(lean.keys).toEqual(['kind', 'name']);
    expect(lean.values.map(decodeValue)).toEqual(['cafe', 'Kahve']);
    const again = decodeLayer(encodeLayer(lean)) as MvtLayer;
    expect(again.features.map((f) => featureProperties(again, f, again.values.map(decodeValue)))).toEqual([{ kind: 'cafe', name: 'Kahve' }, { name: 'Kahve' }]);
  });

  it('change nothing when everything is kept', () => {
    const bytes = sample();
    expect(Buffer.from(encodeLayer(pruneLayer(decodeLayer(bytes) as MvtLayer, () => true))).equals(Buffer.from(bytes))).toBe(true);
  });
});
