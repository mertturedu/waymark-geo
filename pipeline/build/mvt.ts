export type MvtValue = string | number | boolean | null;
export type MvtFeature = { id: Uint8Array | null; tags: number[]; type: number; geometry: Uint8Array | null; order: number[] };
export type MvtLayer = { name: string; version: number; extent: number; keys: string[]; values: Uint8Array[]; features: MvtFeature[]; order: number[] };

const LAYER_FIELDS = [15, 1, 2, 3, 4, 5];
const FEATURE_FIELDS = [1, 2, 3, 4];
const text = new TextDecoder();
const utf8 = new TextEncoder();

function readVarint(bytes: Uint8Array, at: number): [number, number] {
  let value = 0;
  let factor = 1;
  for (let pos = at; ; pos++) {
    if (pos >= bytes.length) throw new Error('mvt: varint yarıda kesildi');
    const byte = bytes[pos] as number;
    value += (byte % 128) * factor;
    if (byte < 128) return [value, pos + 1];
    factor *= 128;
  }
}

function skip(bytes: Uint8Array, at: number, wire: number): number {
  if (wire === 0) return readVarint(bytes, at)[1];
  if (wire === 1) return at + 8;
  if (wire === 5) return at + 4;
  if (wire === 2) {
    const [length, start] = readVarint(bytes, at);
    return start + length;
  }
  throw new Error(`mvt: desteklenmeyen kablo türü ${wire}`);
}

function body(bytes: Uint8Array, at: number): [Uint8Array, number] {
  const [length, start] = readVarint(bytes, at);
  if (start + length > bytes.length) throw new Error('mvt: alan uzunluğu taşıyor');
  return [bytes.subarray(start, start + length), start + length];
}

export function decodeTile(bytes: Uint8Array): { layers: Uint8Array[]; foreign: number } {
  const layers: Uint8Array[] = [];
  let foreign = 0;
  let at = 0;
  while (at < bytes.length) {
    const [key, next] = readVarint(bytes, at);
    if (key === 26) {
      const [layer, end] = body(bytes, next);
      layers.push(layer);
      at = end;
    } else {
      foreign += 1;
      at = skip(bytes, next, key % 8);
    }
  }
  return { layers, foreign };
}

function decodeFeature(bytes: Uint8Array): MvtFeature | null {
  const feature: MvtFeature = { id: null, tags: [], type: 0, geometry: null, order: [] };
  let at = 0;
  while (at < bytes.length) {
    const [key, next] = readVarint(bytes, at);
    const field = Math.floor(key / 8);
    if (feature.order.includes(field)) return null;
    feature.order.push(field);
    if (key === 8) {
      const end = readVarint(bytes, next)[1];
      feature.id = bytes.subarray(next, end);
      at = end;
    } else if (key === 18) {
      const [packed, end] = body(bytes, next);
      for (let pos = 0; pos < packed.length; ) {
        const [tag, after] = readVarint(packed, pos);
        feature.tags.push(tag);
        pos = after;
      }
      at = end;
    } else if (key === 24) {
      [feature.type, at] = readVarint(bytes, next);
    } else if (key === 34) {
      [feature.geometry, at] = body(bytes, next);
    } else {
      return null;
    }
  }
  return feature.tags.length % 2 === 0 ? feature : null;
}

export function decodeLayer(bytes: Uint8Array): MvtLayer | null {
  const layer: MvtLayer = { name: '', version: 1, extent: 4096, keys: [], values: [], features: [], order: [] };
  let at = 0;
  while (at < bytes.length) {
    const [key, next] = readVarint(bytes, at);
    const field = Math.floor(key / 8);
    if (layer.order[layer.order.length - 1] !== field) {
      if (layer.order.includes(field)) return null;
      layer.order.push(field);
    }
    if (key === 120) [layer.version, at] = readVarint(bytes, next);
    else if (key === 40) [layer.extent, at] = readVarint(bytes, next);
    else if (key === 10 || key === 18 || key === 26 || key === 34) {
      const [part, end] = body(bytes, next);
      at = end;
      if (key === 10) layer.name = text.decode(part);
      else if (key === 26) layer.keys.push(text.decode(part));
      else if (key === 34) layer.values.push(part);
      else {
        const feature = decodeFeature(part);
        if (!feature) return null;
        layer.features.push(feature);
      }
    } else return null;
  }
  for (const feature of layer.features) {
    for (let i = 0; i < feature.tags.length; i += 2) if ((feature.tags[i] as number) >= layer.keys.length || (feature.tags[i + 1] as number) >= layer.values.length) return null;
  }
  return layer;
}

export function decodeValue(bytes: Uint8Array): MvtValue {
  const [key, at] = readVarint(bytes, 0);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (key === 10) {
    const [part] = body(bytes, at);
    return text.decode(part);
  }
  if (key === 21) return view.getFloat32(at, true);
  if (key === 25) return view.getFloat64(at, true);
  if (key === 56) return readVarint(bytes, at)[0] !== 0;
  if (key !== 32 && key !== 40 && key !== 48) return null;
  let big = 0n;
  let shift = 0n;
  for (let pos = at; pos < bytes.length; pos++) {
    const byte = BigInt(bytes[pos] as number);
    big |= (byte & 0x7fn) << shift;
    if (byte < 0x80n) break;
    shift += 7n;
  }
  if (key === 32) return Number(BigInt.asIntN(64, big));
  if (key === 40) return Number(BigInt.asUintN(64, big));
  return Number((big >> 1n) ^ -(big & 1n));
}

function createBuffer(initial = 1024) {
  let buffer = new Uint8Array(initial);
  let length = 0;
  const ensure = (extra: number): void => {
    if (length + extra <= buffer.length) return;
    const next = new Uint8Array(Math.max(buffer.length * 2, length + extra));
    next.set(buffer.subarray(0, length));
    buffer = next;
  };
  const varint = (value: number): void => {
    ensure(10);
    let rest = value;
    while (rest >= 128) {
      buffer[length++] = (rest % 128) + 128;
      rest = Math.floor(rest / 128);
    }
    buffer[length++] = rest;
  };
  const raw = (part: Uint8Array): void => {
    ensure(part.length);
    buffer.set(part, length);
    length += part.length;
  };
  const message = (key: number, part: Uint8Array): void => {
    varint(key);
    varint(part.length);
    raw(part);
  };
  return { varint, raw, message, done: (): Uint8Array => buffer.slice(0, length) };
}

const ordered = (order: number[], all: number[]): number[] => [...order, ...all.filter((field) => !order.includes(field))];

function encodeFeature(feature: MvtFeature): Uint8Array {
  const out = createBuffer(64 + (feature.geometry?.length ?? 0));
  const order = ordered(feature.order, FEATURE_FIELDS);
  for (const field of order) {
    if (field === 1 && feature.id) {
      out.varint(8);
      out.raw(feature.id);
    } else if (field === 2 && feature.tags.length > 0) {
      const tags = createBuffer(feature.tags.length * 2);
      for (const tag of feature.tags) tags.varint(tag);
      out.message(18, tags.done());
    } else if (field === 3 && feature.order.includes(3)) {
      out.varint(24);
      out.varint(feature.type);
    } else if (field === 4 && feature.geometry) out.message(34, feature.geometry);
  }
  return out.done();
}

export function encodeLayer(layer: MvtLayer): Uint8Array {
  const out = createBuffer(4096);
  for (const field of ordered(layer.order, LAYER_FIELDS)) {
    if (field === 15) {
      out.varint(120);
      out.varint(layer.version);
    } else if (field === 1) out.message(10, utf8.encode(layer.name));
    else if (field === 2) for (const feature of layer.features) out.message(18, encodeFeature(feature));
    else if (field === 3) for (const key of layer.keys) out.message(26, utf8.encode(key));
    else if (field === 4) for (const value of layer.values) out.message(34, value);
    else if (field === 5) {
      out.varint(40);
      out.varint(layer.extent);
    }
  }
  return out.done();
}

export function encodeTile(layers: Uint8Array[]): Uint8Array {
  const out = createBuffer(layers.reduce((sum, layer) => sum + layer.length + 6, 0));
  for (const layer of layers) out.message(26, layer);
  return out.done();
}

export function pruneLayer(layer: MvtLayer, keepKey: (key: string) => boolean, keepFeature: (feature: MvtFeature) => boolean = () => true): MvtLayer {
  const usedKeys = new Set<number>();
  const usedValues = new Set<number>();
  const kept: MvtFeature[] = [];
  for (const feature of layer.features) {
    if (!keepFeature(feature)) continue;
    const tags: number[] = [];
    for (let i = 0; i < feature.tags.length; i += 2) {
      const key = feature.tags[i] as number;
      const value = feature.tags[i + 1] as number;
      if (!keepKey(layer.keys[key] as string)) continue;
      usedKeys.add(key);
      usedValues.add(value);
      tags.push(key, value);
    }
    kept.push({ ...feature, tags });
  }
  const keyIndex = new Map<number, number>();
  const valueIndex = new Map<number, number>();
  const keys: string[] = [];
  const values: Uint8Array[] = [];
  layer.keys.forEach((key, i) => {
    if (!usedKeys.has(i)) return;
    keyIndex.set(i, keys.length);
    keys.push(key);
  });
  layer.values.forEach((value, i) => {
    if (!usedValues.has(i)) return;
    valueIndex.set(i, values.length);
    values.push(value);
  });
  const features = kept.map((feature) => ({ ...feature, tags: feature.tags.map((tag, i) => (i % 2 === 0 ? keyIndex.get(tag) : valueIndex.get(tag)) as number) }));
  return { ...layer, keys, values, features };
}

export function featureProperties(layer: MvtLayer, feature: MvtFeature, values: MvtValue[]): Record<string, MvtValue> {
  const properties: Record<string, MvtValue> = {};
  for (let i = 0; i < feature.tags.length; i += 2) properties[layer.keys[feature.tags[i] as number] as string] = values[feature.tags[i + 1] as number] as MvtValue;
  return properties;
}

export function featureId(feature: MvtFeature): number | undefined {
  return feature.id ? readVarint(feature.id, 0)[0] : undefined;
}
