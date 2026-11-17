import { pathToFileURL } from 'node:url';
import { createTypeSession } from '../src/core/address/typeahead';
import { distanceM } from '../src/core/geo/distance';
import { nameKey } from '../src/core/text';
import { provinceName } from '../src/core/text/admin';
import { streetKey } from '../src/core/text/street';
import { recordMeasure } from '../tools/compare/measures';
import { openSearch, stats } from './addr-eval';
import { readSet, type TextRecord } from './addr-sets';

const PLATES = ['34', '06', '35', '16'];
const HIT_M = 50;
const MIN_TYPED = 2;
const NEAR_OFFSET = Number(process.env.NEAR_OFFSET ?? 0.01);

type Suggestion = { street: string | null; district: string | null; point: [number, number] | null; door: boolean };
type Session = import('../src/core/address/typeahead').TypeSession;
type Engine = { name: string; suggest(prefix: string, near: [number, number] | null, session?: Session): Promise<Suggestion[]> };

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length === 0 ? 0 : (sorted[Math.floor(sorted.length / 2)] as number);
};
const quantile = (values: number[], q: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length === 0 ? 0 : (sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] as number);
};

async function sdkEngine(options: { near: boolean; recent?: boolean }): Promise<Engine> {
  const search = await openSearch();
  return {
    name: options.near ? 'sdk-near' : 'sdk',
    async suggest(prefix, near, session) {
      const list = await search.autocomplete(prefix, { limit: 3, ...(options.near && near ? { near } : {}), ...(session ? { session } : {}) });
      return list.map((p) => ({ street: p.components.street ?? null, district: p.components.district ?? null, point: p.coordinate, door: p.precision === 'address' || p.precision === 'interpolated' }));
    },
  };
}

function photonEngine(): Engine {
  return {
    name: 'photon',
    async suggest(prefix, near) {
      const params = new URLSearchParams({ q: prefix, limit: '3', lang: 'default' });
      if (near) {
        params.set('lon', String(near[0]));
        params.set('lat', String(near[1]));
      }
      try {
        const response = await fetch(`http://127.0.0.1:2322/api?${params}`);
        if (!response.ok) return [];
        const features = ((await response.json()) as { features: { geometry: { coordinates: [number, number] }; properties: Record<string, string> }[] }).features;
        return features.map((f) => ({ street: f.properties.street ?? (f.properties.type === 'street' ? (f.properties.name ?? null) : null), district: f.properties.city ?? f.properties.county ?? null, point: f.geometry.coordinates, door: Boolean(f.properties.housenumber) }));
      } catch {
        return [];
      }
    },
  };
}

export type Typing = { texts: number; streetMedian: number; doorMedian: number; streetReached: number; doorReached: number; textLengthMedian: number; keyMsP95: number; keyMsMedian: number };

export type Style = 'written' | 'street';

const typedOf = (r: TextRecord, style: Style): string => (style === 'street' ? `${r.street} ${r.number} ${r.district}` : r.text);

export async function typeAll(engine: Engine, perPlate: number, nearHint: boolean, style: Style = 'written', useSession = false): Promise<Typing> {
  const street: number[] = [];
  const door: number[] = [];
  const lengths: number[] = [];
  const times: number[] = [];
  let streetReached = 0;
  let doorReached = 0;
  let texts = 0;
  for (const plate of PLATES) {
    for (const r of readSet<TextRecord>('g1s', plate).slice(0, perPlate)) {
      texts++;
      const typed = typedOf(r, style);
      lengths.push(typed.length);
      const wantStreet = streetKey(r.street).key;
      const wantDistrict = nameKey(r.district);
      let streetAt = 0;
      let doorAt = 0;
      const session = useSession ? createTypeSession() : undefined;
      const near: [number, number] | null = nearHint ? [r.lng + NEAR_OFFSET, r.lat + NEAR_OFFSET * 0.6] : null;
      for (let k = MIN_TYPED; k <= typed.length && (streetAt === 0 || doorAt === 0); k++) {
        const started = performance.now();
        const list = await engine.suggest(typed.slice(0, k), near, session);
        times.push(performance.now() - started);
        if (streetAt === 0 && list.some((s) => s.street !== null && streetKey(s.street).key === wantStreet && (s.district === null || nameKey(s.district) === wantDistrict))) streetAt = k;
        if (doorAt === 0 && list.some((s) => s.door && s.point !== null && distanceM(s.point, [r.lng, r.lat]) <= HIT_M)) doorAt = k;
      }
      if (streetAt > 0) streetReached++;
      if (doorAt > 0) doorReached++;
      street.push(streetAt > 0 ? streetAt : typed.length + 1);
      door.push(doorAt > 0 ? doorAt : typed.length + 1);
    }
    if ('invalidate' in engine) void 0;
  }
  return { texts, streetMedian: median(street), doorMedian: median(door), streetReached: Number(((100 * streetReached) / texts).toFixed(1)), doorReached: Number(((100 * doorReached) / texts).toFixed(1)), textLengthMedian: median(lengths), keyMsP95: Number(quantile(times, 0.95).toFixed(1)), keyMsMedian: Number(median(times).toFixed(2)) };
}

async function checkLabels(perPlate: number): Promise<void> {
  const search = await openSearch();
  let n = 0;
  let provinceOk = 0;
  let districtOk = 0;
  let both = 0;
  const bad: string[] = [];
  for (const plate of PLATES) {
    for (const r of readSet<TextRecord>('g1s', plate).slice(0, perPlate)) {
      for (const k of [3, 6, 10, 15, 20, 30]) {
        if (k > r.text.length) continue;
        for (const p of await search.autocomplete(r.text.slice(0, k), { limit: 5 })) {
          const here = await search.coverage(p.coordinate);
          if (!here || !p.components.district) continue;
          n++;
          const province = p.components.province !== undefined && nameKey(p.components.province) === nameKey(provinceName(here.region) ?? '');
          const district = nameKey(p.components.district) === nameKey(here.district);
          if (province) provinceOk++;
          if (district) districtOk++;
          if (province && district) both++;
          else if (bad.length < Number(process.env.SHOW ?? 0)) bad.push(`${r.text.slice(0, k)} → ${p.label} [${p.precision}] polygon ${here.district}/${here.region}`);
        }
      }
    }
    search.invalidate(plate);
  }
  for (const line of bad) console.log('  yanlış etiket:', line);
  const result = { n, province: Number(((100 * provinceOk) / n).toFixed(2)), district: Number(((100 * districtOk) / n).toFixed(2)), both: Number(((100 * both) / n).toFixed(2)) };
  console.log(`öneri etiketleri: ${n} öneri, il %${result.province}, ilçe %${result.district}, ikisi %${result.both}`);
  recordMeasure('a11_labels', result);
}

async function main(): Promise<void> {
  if (process.argv[2] === 'labels') return checkLabels(Number(process.argv[3] ?? 60));
  const which = process.argv[2] ?? 'sdk';
  const perPlate = Number(process.argv[3] ?? 150);
  const near = process.argv.includes('--near');
  const style: Style = process.argv.includes('--street') ? 'street' : 'written';
  const key = process.env.TYPE_KEY ?? `a11_${which}${near ? '_near' : ''}${style === 'street' ? '_street' : ''}${process.argv.includes('--session') ? '_session' : ''}`;
  const engine = which === 'photon' ? photonEngine() : await sdkEngine({ near });
  const session = process.argv.includes('--session');
  const result = await typeAll(engine, perPlate, near, style, session);
  console.log(`${engine.name}${near ? ' (yakın konumla)' : ''}${style === 'street' ? ' [sokak önde]' : ''}:`, JSON.stringify(result));
  recordMeasure(key, result);
}

void stats;
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
