import { projectOnLine } from '../geo/distance';
import { createReader, createWriter, decodeRings, encodeRings, pointInRings, type Polygon } from './geom';

export type Borders = {
  provinceAt(lng: number, lat: number): string | null;
  provinceBounds(plate: string): [number, number, number, number] | null;
  provincePolygons(plate: string): Polygon[];
  plates(): string[];
  nearBorder(lng: number, lat: number, meters: number): string[];
};

export type BorderRow = { plate: string; rings: Polygon[] };

const VERSION = 1;
const M_PER_DEGREE = 111_195;
const SCALE = 1e6;

function plateNumber(plate: string): number {
  const number = /^\d{2}$/.test(plate) ? Number(plate) : 0;
  if (number < 1 || number > 81) throw new Error(`bad plate ${plate}`);
  return number;
}

function boundsOf(polygons: Polygon[]): [number, number, number, number] {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const polygon of polygons) {
    for (const ring of polygon) {
      for (const [x, y] of ring) {
        west = Math.min(west, x);
        south = Math.min(south, y);
        east = Math.max(east, x);
        north = Math.max(north, y);
      }
    }
  }
  return [west, south, east, north];
}

export function encodeBorders(rows: BorderRow[]): Uint8Array {
  const sorted = [...rows].sort((a, b) => plateNumber(a.plate) - plateNumber(b.plate));
  for (let i = 1; i < sorted.length; i++) if (sorted[i]?.plate === sorted[i - 1]?.plate) throw new Error(`plate ${sorted[i]?.plate} twice`);
  const writer = createWriter();
  writer.bytes.push(VERSION);
  writer.varint(sorted.length);
  for (const row of sorted) {
    writer.bytes.push(plateNumber(row.plate));
    const payload = encodeRings(row.rings, SCALE);
    const [west, south, east, north] = boundsOf(row.rings);
    for (const edge of row.rings.length === 0 ? [0, 0, 0, 0] : [west, south, east, north]) writer.signed(Math.round(edge * SCALE));
    writer.varint(payload.length);
    for (const byte of payload) writer.bytes.push(byte);
  }
  return Uint8Array.from(writer.bytes);
}

export function createBorders(bytes: Uint8Array): Borders {
  const reader = createReader(bytes);
  const version = reader.byte();
  if (version !== VERSION) throw new Error(`unknown borders version ${version}`);
  const entries: { plate: string; bounds: [number, number, number, number]; rings: Polygon[] }[] = [];
  const count = reader.varint();
  for (let i = 0; i < count; i++) {
    const number = reader.byte();
    if (number < 1 || number > 81) throw new Error(`bad plate ${number}`);
    if (entries.length > 0 && number <= Number(entries[entries.length - 1]?.plate)) throw new Error('plates not in order');
    const bounds: [number, number, number, number] = [reader.signed() / SCALE, reader.signed() / SCALE, reader.signed() / SCALE, reader.signed() / SCALE];
    const length = reader.varint();
    const payload = new Uint8Array(length);
    for (let j = 0; j < length; j++) payload[j] = reader.byte();
    entries.push({ plate: (number < 10 ? '0' : '') + String(number), bounds, rings: decodeRings(payload) });
  }
  reader.done();
  const provinceAt = (lng: number, lat: number): string | null => {
    for (const entry of entries) {
      const [west, south, east, north] = entry.bounds;
      if (lng < west || lng > east || lat < south || lat > north) continue;
      if (pointInRings([lng, lat], entry.rings)) return entry.plate;
    }
    return null;
  };
  return {
    provinceAt,
    provinceBounds: (plate) => entries.find((e) => e.plate === plate)?.bounds ?? null,
    provincePolygons: (plate) => entries.find((e) => e.plate === plate)?.rings ?? [],
    plates: () => entries.map((e) => e.plate),
    nearBorder(lng, lat, meters) {
      if (!Number.isFinite(lng) || !Number.isFinite(lat) || !Number.isFinite(meters) || meters <= 0) return [];
      const dLat = meters / M_PER_DEGREE;
      const dLng = meters / (M_PER_DEGREE * Math.max(Math.cos((lat * Math.PI) / 180), 1e-6));
      const own = provinceAt(lng, lat);
      const near: string[] = [];
      for (const entry of entries) {
        if (entry.plate === own) continue;
        const [west, south, east, north] = entry.bounds;
        if (lng < west - dLng || lng > east + dLng || lat < south - dLat || lat > north + dLat) continue;
        if (entry.rings.some((polygon) => polygon.some((ring) => projectOnLine([lng, lat], ring).distanceM <= meters))) near.push(entry.plate);
      }
      return near;
    },
  };
}
