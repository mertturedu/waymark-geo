import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MAX_AREA_POINTS, MAX_STREET_POINTS } from '../src/core/address/geometry';
import { openRegion } from '../src/core/address/pack';
import { createSearch } from '../src/core/address/search';
import type { Place } from '../src/core/address/types';
import type { LngLat } from '../src/core/geo/cells';
import { distanceM } from '../src/core/geo/distance';
import { inBbox } from '../src/core/geo/simplify';
import type { PackStore, SqlDb } from '../src/core/ports';
import { embeddedBorders } from '../src/core/region/embedded';
import { provinceName } from '../src/core/text/admin';
import { openSqlite } from '../src/node/sqlite';
import { FIT_MAX_ZOOM, FIT_MIN_ZOOM, fitBounds } from '../src/native/map/camera';
import { rng, shuffle } from '../test/sim/random';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
export const CHECKS = ['shapes'];
export const PLATES = ['34', '06', '35', '41', '16'];
export const LIMITS = { bboxHit: 0.995, perPlate: 150 };
const WORK = join(repoRoot, 'dist', 'work', '261028', 'packs');
const SEED = 3131;
const LONG_M = 5000;

export type Measured = { check: string; pass: boolean; measured: string; report: string };

const quantile = (values: number[], q: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length === 0 ? 0 : (sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] as number);
};
const kb = (bytes: number): string => (bytes / 1024).toFixed(1);

type Row = { plate: string; streets: number; noParts: number; withShape: number; boxHit: number; multi: number; long: number; capped: number; points: number[]; bytes: number[]; ms: number[]; zoomOk: number; areas: number; areaShape: number; areaBox: number; areaBytes: number[]; withRange: number; local: number; noPolygon: number; notStreet: number };

async function run(plate: string): Promise<Row | null> {
  const dir = join(WORK, plate);
  if (!existsSync(join(dir, 'address.sqlite'))) return null;
  const handles: SqlDb[] = [];
  const address = openSqlite(join(dir, 'address.sqlite'));
  handles.push(address);
  const store: PackStore = { installed: async () => [plate], open: async () => address, openPart: async () => null };
  const search = createSearch({ store, borders: embeddedBorders() });
  const region = await openRegion(address);
  const row: Row = { plate, streets: 0, noParts: 0, withShape: 0, boxHit: 0, multi: 0, long: 0, capped: 0, points: [], bytes: [], ms: [], zoomOk: 0, areas: 0, areaShape: 0, areaBox: 0, areaBytes: [], withRange: 0, local: 0, noPolygon: 0, notStreet: 0 };
  try {
    const rand = rng(SEED + Number(plate));
    const rows = await address.all<{ id: number; name: string; district: string }>('SELECT s.id AS id, s.name AS name, d.name AS district FROM street_name s JOIN street_part p ON p.name_id = s.id JOIN district d ON d.id = p.district_id GROUP BY s.id, p.district_id ORDER BY s.id');
    const all = await address.all<{ id: number }>('SELECT id FROM street_name ORDER BY id');
    const withParts = new Set(rows.map((r) => r.id));
    row.noParts = all.filter((r) => !withParts.has(r.id)).length;
    for (const item of shuffle(rows, rand).slice(0, LIMITS.perPlate)) {
      const started = performance.now();
      const found = await search.resolve(`${item.name} ${item.district} ${provinceName(plate) ?? ''}`, { geometry: true, limit: 8 });
      const list: Place[] = found.status === 'resolved' ? [found.best, ...found.candidates] : found.status === 'ambiguous' ? found.candidates : [];
      if (!list.some((p) => p.precision === 'street')) {
        row.notStreet++;
        continue;
      }
      row.streets++;
      const hit = list.find((p) => p.precision === 'street' && p.geometry?.kind === 'street');
      row.ms.push(performance.now() - started);
      if (process.env.SHAPES_DEBUG && (!hit || hit.geometry?.kind !== 'street')) console.log('NOSTREET', plate, item.name, item.district, found.status, list.slice(0, 3).map((p) => `${p.precision}:${p.id}:${p.geometry ? 'g' : '-'}`).join(' '));
      if (!hit || hit.geometry?.kind !== 'street') continue;
      row.withShape++;
      const g = hit.geometry;
      const bytes = Buffer.byteLength(JSON.stringify({ geometry: g, bbox: hit.bbox }));
      row.bytes.push(bytes);
      row.points.push(g.points);
      if (hit.bbox && inBbox(hit.bbox, hit.coordinate)) row.boxHit++;
      if (g.parts > 1) row.multi++;
      if (g.numbers) row.withRange++;
      if (g.local.length > 0) row.local++;
      if (g.points >= MAX_STREET_POINTS * 0.95) row.capped++;
      if (hit.bbox) {
        const diagonal = distanceM([hit.bbox[0], hit.bbox[1]] as LngLat, [hit.bbox[2], hit.bbox[3]] as LngLat);
        if (diagonal > LONG_M) row.long++;
        const zoom = fitBounds(hit.bbox, { width: 400, height: 800, padding: 48 }).zoom;
        if (zoom >= FIT_MIN_ZOOM && zoom <= FIT_MAX_ZOOM && (diagonal <= LONG_M || zoom < 15)) row.zoomOk++;
      }
    }
    for (const hood of shuffle(region.hoods, rand).slice(0, 40)) {
      if (!(await region.hoodPolygons(hood.districtId)).get(hood.id)) {
        row.noPolygon++;
        continue;
      }
      const found = await search.resolve(`${hood.name} Mahallesi ${region.districts.find((d) => d.id === hood.districtId)?.name ?? ''}`, { geometry: true, limit: 5 });
      const list: Place[] = found.status === 'resolved' ? [found.best, ...found.candidates] : found.status === 'ambiguous' ? found.candidates : [];
      const area = list.find((p) => p.precision === 'neighbourhood' && p.id === `${region.id}:h:${hood.id}`);
      if (!area) continue;
      row.areas++;
      if (process.env.SHAPES_DEBUG && !area.geometry) console.log('NOAREA', plate, area.id, area.label);
      if (area.geometry?.kind === 'area' && area.geometry.points <= MAX_AREA_POINTS) {
        row.areaShape++;
        row.areaBytes.push(Buffer.byteLength(JSON.stringify({ geometry: area.geometry, bbox: area.bbox })));
      }
      if (area.bbox && inBbox(area.bbox, area.coordinate)) row.areaBox++;
    }
    for (const district of region.districts.slice(0, 10)) {
      const found = await search.resolve(`${district.name} ${provinceName(plate) ?? ''}`, { geometry: true, limit: 5 });
      const list: Place[] = found.status === 'resolved' ? [found.best, ...found.candidates] : found.status === 'ambiguous' ? found.candidates : [];
      const area = list.find((p) => p.precision === 'district');
      if (!area) continue;
      row.areas++;
      if (area.geometry?.kind === 'area' && area.geometry.points <= MAX_AREA_POINTS) {
        row.areaShape++;
        row.areaBytes.push(Buffer.byteLength(JSON.stringify({ geometry: area.geometry, bbox: area.bbox })));
      }
      if (area.bbox && inBbox(area.bbox, area.coordinate)) row.areaBox++;
    }
    return row;
  } finally {
    for (const db of handles) await db.close();
  }
}

export async function runShapesCheck(): Promise<Measured> {
  const rows: Row[] = [];
  for (const plate of PLATES) {
    const r = await run(plate);
    if (r) rows.push(r);
  }
  const sum = (key: keyof Pick<Row, 'streets' | 'noParts' | 'withShape' | 'boxHit' | 'multi' | 'long' | 'capped' | 'zoomOk' | 'areas' | 'areaShape' | 'areaBox' | 'withRange' | 'local' | 'noPolygon' | 'notStreet'>): number => rows.reduce((t, r) => t + r[key], 0);
  const points = rows.flatMap((r) => r.points);
  const bytes = rows.flatMap((r) => r.bytes);
  const areaBytes = rows.flatMap((r) => r.areaBytes);
  const ms = rows.flatMap((r) => r.ms);
  const share = (a: number, b: number): number => (b === 0 ? 0 : a / b);
  const table = rows.map((r) => `| ${r.plate} | ${r.streets} | ${r.withShape} | ${r.boxHit} | ${r.multi} | ${r.long} | ${r.capped} | ${quantile(r.points, 0.5)} | ${Math.max(0, ...r.points)} | ${kb(quantile(r.bytes, 0.95))} | ${r.areas} | ${r.areaShape} | ${r.areaBox} |`);
  const measured = `5 il, 750 sokak adı sorgusu (${sum('notStreet')}'i sokak olarak çözülmedi: site, otoyol, yer adı): ${sum('streets')} sokak sonucunun ${sum('withShape')}'inde çizgi var (%${(share(sum('withShape'), sum('streets')) * 100).toFixed(1)}), bbox sonuç noktasını içeriyor %${(share(sum('boxHit'), sum('withShape')) * 100).toFixed(1)}; parçalı sokak ${sum('multi')}, 5 km'den uzun ${sum('long')}, nokta üst sınırına dayanan ${sum('capped')}; nokta p50 ${quantile(points, 0.5)}, p95 ${quantile(points, 0.95)}, en çok ${Math.max(0, ...points)}; boyut p50 ${kb(quantile(bytes, 0.5))} KB, p95 ${kb(quantile(bytes, 0.95))} KB; sokak aralığı (No a-b) ${sum('withRange')}; örneklenen mahallelerden sınırı paketsiz ${sum('noPolygon')}; sınırı olan mahalle ve ilçe: ${sum('areas')} sonucun ${sum('areaShape')}'inde sınır (boyut p95 ${kb(quantile(areaBytes, 0.95))} KB), bbox içeriyor ${sum('areaBox')}; geometri süresi p50 ${quantile(ms, 0.5).toFixed(1)} ms, p95 ${quantile(ms, 0.95).toFixed(1)} ms; sokak satırı olup çizgisi paketsiz ${sum('noParts')}`;
  const report = ['# Sokak ve alan geometrisi (gerçek il paketleri)', '', `Her ilde en çok ${LIMITS.perPlate} sokak (ad + ilçe), 40 mahalle, 10 ilçe. Sokak: çizgi var mı, bbox sonuç noktasını içeriyor mu, parça ve nokta sayısı, JSON boyutu. Kamera: 400x800 ekranda sığdırma (en çok yakınlaştırma ${FIT_MAX_ZOOM}).`, '', '| İl | Sokak | Çizgili | Bbox içerir | Parçalı | > 5 km | Üst sınıra yakın | Nokta p50 | Nokta en çok | Boyut p95 KB | Alan | Sınırlı | Bbox içerir |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|', ...table, '', measured, ''].join('\n');
  const pass = sum('streets') > 0 && sum('withShape') === sum('streets') && share(sum('boxHit'), sum('withShape')) >= LIMITS.bboxHit && sum('areaShape') === sum('areas') && sum('areaBox') === sum('areas') && Math.max(0, ...points) <= MAX_STREET_POINTS;
  return { check: 'shapes', pass, measured, report };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runShapesCheck().then((result) => {
    const dir = join(homedir(), 'Desktop', 'yuksi-geo-raporlar');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'faz-16a-geometri.md'), result.report);
    console.log(JSON.stringify({ check: result.check, pass: result.pass, measured: result.measured }));
    process.exit(result.pass ? 0 : 1);
  });
}
