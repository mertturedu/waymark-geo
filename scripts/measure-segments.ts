import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { decodeLayer, decodeTile, decodeValue, featureProperties } from '../pipeline/build/mvt';
import { openPmtiles, zoomOfTileId } from '../pipeline/build/pmtiles-file';
import { PACK_OPTIONS, buildBaseGraph, graphOptionsFor, parseRoadRows } from '../pipeline/build/route-graph';
import { SEGMENT_LAYER, SEGMENT_TILE_ZOOMS, buildTrafficSegments, isSegmentClass, segmentFeature, segmentTileCommand } from '../pipeline/build/traffic-segments';
import { createBorders } from '../src/core/region/borders';
import { ROAD_CLASSES } from '../src/core/route/speeds';

const arg = (name: string, fallback: string): string => {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 && process.argv[at + 1] ? (process.argv[at + 1] as string) : fallback;
};

const work = arg('work', join('dist', 'work', '261028'));
const plate = arg('plate', '34');
const out = join('dist', 'work', 'traffic', 'segments', plate);
mkdirSync(out, { recursive: true });

const borders = createBorders(readFileSync(join('src', 'core', 'region', 'data', 'borders.bin')));
const base = buildBaseGraph(parseRoadRows(readFileSync(join(work, 'roads', plate, 'roads.jsonl'), 'utf8')), graphOptionsFor({ ...PACK_OPTIONS, plate }, borders));
const started = Date.now();
const { segments, edgeSegment, edgeFlip } = buildTrafficSegments(base);
const tookMs = Date.now() - started;

const mainEdges = base.edges.filter((e) => isSegmentClass(e.cls));
const mainLength = mainEdges.reduce((sum, e) => sum + e.lengthM, 0);
const covered = base.edges.reduce((sum, e, index) => sum + (isSegmentClass(e.cls) && (edgeSegment[index] as number) >= 0 ? e.lengthM : 0), 0);
const stray = base.edges.filter((e, index) => !isSegmentClass(e.cls) && (edgeSegment[index] as number) >= 0).length;
const jump = (line: number[], other: number[]): boolean => line[line.length - 2] !== other[0] || line[line.length - 1] !== other[1];
const lineOfEdge = (edge: number, flip: boolean): number[] => {
  const e = base.edges[edge] as { tail: number; head: number; shape: number[] };
  const forward = [base.nodeLon[e.tail] as number, base.nodeLat[e.tail] as number, ...e.shape, base.nodeLon[e.head] as number, base.nodeLat[e.head] as number];
  if (!flip) return forward;
  const back: number[] = [];
  for (let k = forward.length - 2; k >= 0; k -= 2) back.push(forward[k] as number, forward[k + 1] as number);
  return back;
};
const broken = segments.filter((segment) => segment.edges.some((edge, i) => i > 0 && jump(lineOfEdge(segment.edges[i - 1] as number, edgeFlip[segment.edges[i - 1] as number] === 1), lineOfEdge(edge, edgeFlip[edge] === 1)))).length;
const wrongWay = segments.filter((segment) => segment.oneway && segment.edges.some((edge) => (base.edges[edge] as { forward: boolean }).forward === (edgeFlip[edge] === 1))).length;
const lengths = segments.map((segment) => segment.lengthM).sort((a, b) => a - b);
const at = (share: number): number => Math.round(lengths[Math.floor(lengths.length * share)] ?? 0);
console.log(`${plate}: ${base.edges.length} yol parçası, ana sınıf ${mainEdges.length} (${Math.round(mainLength / 1000)} km), trafik parçası ${segments.length}, süre ${tookMs} ms`);
console.log(`ana sınıf uzunluğunun trafik parçasına bağlı payı: ${((covered / mainLength) * 100).toFixed(2)}%; ana sınıf dışı bağlanan: ${stray}; kopuk zincir: ${broken}; ters yönlü tek yön: ${wrongWay}`);
console.log(`parça uzunluğu (m): p10 ${at(0.1)}, ortanca ${at(0.5)}, p90 ${at(0.9)}, en uzun ${at(0.9999)}; ${MIN_NOTE(lengths)}`);
console.log(`anahtar: ${new Set(segments.map((segment) => segment.key)).size} tekil / ${segments.length}`);
const byClass = new Map<number, number>();
for (const segment of segments) byClass.set(segment.cls, (byClass.get(segment.cls) ?? 0) + 1);
console.log([...byClass].sort((a, b) => a[0] - b[0]).map(([cls, count]) => `${ROAD_CLASSES[cls]} ${count}`).join(', '));

function MIN_NOTE(sorted: number[]): string {
  const short = sorted.filter((v) => v < 60);
  return `60 m altı: sayının ${((short.length / sorted.length) * 100).toFixed(1)}%, uzunluğun ${((short.reduce((sum, v) => sum + v, 0) / sorted.reduce((sum, v) => sum + v, 0)) * 100).toFixed(1)}%`;
}

const digestOf = (set: ReturnType<typeof buildTrafficSegments>): string => createHash('sha256').update(JSON.stringify(set.segments)).update(Buffer.from(set.edgeSegment.buffer)).update(set.edgeFlip).digest('hex').slice(0, 16);
const again = buildTrafficSegments(buildBaseGraph(parseRoadRows(readFileSync(join(work, 'roads', plate, 'roads.jsonl'), 'utf8')), graphOptionsFor({ ...PACK_OPTIONS, plate }, borders)));
console.log(`iki derleme aynı: ${digestOf({ segments, edgeSegment, edgeFlip }) === digestOf(again)} (${digestOf(again)})`);

if (process.argv.includes('--tiles')) {
  const source = join(out, 'segments.geojsonl');
  const target = join(out, 'traffic.pmtiles');
  writeFileSync(source, segments.map(segmentFeature).join('\n'));
  execSync(segmentTileCommand(source, target), { stdio: 'inherit' });
  const archive = openPmtiles(target);
  const found = new Set<number>();
  const perZoom = new Map<number, number>();
  for (const entry of archive.entries) {
    const zoom = zoomOfTileId(entry.tileId);
    const raw = archive.read(entry);
    const tile = raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw) : raw;
    perZoom.set(zoom, (perZoom.get(zoom) ?? 0) + entry.length);
    if (zoom !== SEGMENT_TILE_ZOOMS.max) continue;
    for (const bytes of decodeTile(tile).layers) {
      const layer = decodeLayer(bytes);
      if (!layer || layer.name !== SEGMENT_LAYER) continue;
      const values = layer.values.map(decodeValue);
      for (const feature of layer.features) found.add(featureProperties(layer, feature, values).s as number);
    }
  }
  archive.close();
  const seenLength = segments.reduce((sum, segment, index) => sum + (found.has(index) ? segment.lengthM : 0), 0);
  const total = segments.reduce((sum, segment) => sum + segment.lengthM, 0);
  console.log(`karo dosyası ${(statSync(target).size / 1e6).toFixed(2)} MB; z${SEGMENT_TILE_ZOOMS.max} karolarında kimliği bulunan parça ${found.size} / ${segments.length} (uzunluğun ${((seenLength / total) * 100).toFixed(2)}%)`);
  console.log([...perZoom].sort((a, b) => a[0] - b[0]).map(([zoom, bytes]) => `z${zoom} ${(bytes / 1e6).toFixed(2)}`).join(', '));
}

const alignAt = process.argv.indexOf('--align');
if (alignAt >= 0) {
  const { decodeLines } = await import('../pipeline/build/road-cells');
  const { zxyOf } = await import('../pipeline/build/pmtiles-file');
  const CELL_M = 4;
  const kx = (111_195 * Math.cos((41 * Math.PI) / 180)) / CELL_M;
  const ky = 111_195 / CELL_M;
  const keyOf = (lon: number, lat: number): number => Math.round((lon - 25) * kx) * 2_000_000 + Math.round((lat - 35) * ky);
  const drawn = new Set<number>();
  const archive = openPmtiles(process.argv[alignAt + 1] as string);
  const top = archive.header.maxZoom;
  const kinds = new Set(['highway', 'major_road', 'medium_road']);
  for (const entry of archive.entries) {
    const [z, tx, ty] = zxyOf(entry.tileId);
    if (z !== top) continue;
    const raw = archive.read(entry);
    const tile = raw[0] === 0x1f && raw[1] === 0x8b ? gunzipSync(raw) : raw;
    for (const bytes of decodeTile(tile).layers) {
      const layer = decodeLayer(bytes);
      if (!layer || layer.name !== 'roads') continue;
      const values = layer.values.map(decodeValue);
      const size = 2 ** z;
      const lonOf = (px: number): number => ((tx + px / layer.extent) / size) * 360 - 180;
      const latOf = (py: number): number => (Math.atan(Math.sinh(Math.PI * (1 - (2 * (ty + py / layer.extent)) / size))) * 180) / Math.PI;
      for (const feature of layer.features) {
        if (feature.type !== 2 || feature.geometry === null || !kinds.has(String(featureProperties(layer, feature, values).kind))) continue;
        for (const line of decodeLines(feature.geometry)) {
          for (let i = 1; i < line.length; i++) {
            const a = [lonOf((line[i - 1] as [number, number])[0]), latOf((line[i - 1] as [number, number])[1])] as const;
            const b = [lonOf((line[i] as [number, number])[0]), latOf((line[i] as [number, number])[1])] as const;
            const steps = Math.max(1, Math.ceil(Math.hypot((b[0] - a[0]) * kx, (b[1] - a[1]) * ky)));
            for (let k = 0; k <= steps; k++) drawn.add(keyOf(a[0] + ((b[0] - a[0]) * k) / steps, a[1] + ((b[1] - a[1]) * k) / steps));
          }
        }
      }
    }
  }
  archive.close();
  const near = (lon: number, lat: number, reach: number): boolean => {
    const x = Math.round((lon - 25) * kx);
    const y = Math.round((lat - 35) * ky);
    for (let dx = -reach; dx <= reach; dx++) for (let dy = -reach; dy <= reach; dy++) if (drawn.has((x + dx) * 2_000_000 + y + dy)) return true;
    return false;
  };
  let samples = 0;
  let close = 0;
  let loose = 0;
  for (const segment of segments) {
    for (let i = 0; i + 1 < segment.line.length; i += 2) {
      const lon = (segment.line[i] as number) / 1e6;
      const lat = (segment.line[i + 1] as number) / 1e6;
      if (borders.provinceAt(lon, lat) !== plate) continue;
      samples += 1;
      if (near(lon, lat, 2)) close += 1;
      if (near(lon, lat, 5)) loose += 1;
    }
  }
  console.log(`harita yollarıyla hizalama (z${top}, ${samples} nokta): 8 m içinde ${((close / samples) * 100).toFixed(2)}%, 20 m içinde ${((loose / samples) * 100).toFixed(2)}%`);
}
