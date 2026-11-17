import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assemblePacks } from '../../pipeline/build/manifest';
import type { RoadRows } from '../../pipeline/build/route-graph';
import { buildRoutePack } from '../../pipeline/build/route-pack';
import type { RouteContext } from '../../scripts/measure-route';

const sources = { osmFile: 'turkey-261020.osm.pbf', osmMd5: 'a'.repeat(32), osmTimestamp: '2026-10-20T20:23:47Z', tilesBuild: '20261022', tilesOsmTime: '2026-10-22T04:00:00Z' };

export function serializeRoadRows(rows: RoadRows): string {
  const lines: unknown[] = [];
  for (const w of rows.ways) lines.push({ t: 'w', id: w.id, cls: w.cls, o: w.oneway, ...(w.speed !== null ? { s: w.speed } : {}), ...(w.ferry ? { f: true } : {}), ...(w.duration !== null ? { d: w.duration } : {}), n: w.nodes, c: w.coords });
  for (const id of [...rows.blocked].sort((a, b) => a - b)) lines.push({ t: 'b', id });
  for (const r of rows.rules) lines.push({ t: 'r', id: r.id, kind: r.kind, restriction: r.restriction, from: r.from, to: r.to, via: r.via });
  return lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
}

export async function routeFixture(byPlate: Record<string, RoadRows>): Promise<RouteContext & { root: string }> {
  const root = mkdtempSync(join(tmpdir(), 'route-fixture-'));
  const workDir = join(root, 'work');
  const files: Record<string, string> = {};
  for (const [plate, rows] of Object.entries(byPlate)) {
    mkdirSync(join(workDir, 'roads', plate), { recursive: true });
    mkdirSync(join(workDir, 'packs', plate), { recursive: true });
    writeFileSync(join(workDir, 'roads', plate, 'roads.jsonl'), serializeRoadRows(rows));
    const { bytes, report } = buildRoutePack(rows, { ferries: true, minComponent: 1 });
    writeFileSync(join(workDir, 'packs', plate, 'route.bin'), bytes);
    writeFileSync(join(workDir, 'packs', plate, 'route-stats.json'), JSON.stringify(report));
    files[plate] = join(workDir, 'packs', plate, 'route.bin');
  }
  const packsDir = join(root, 'packs');
  const baseDir = join(root, 'base');
  mkdirSync(baseDir);
  await assemblePacks({
    outDir: packsDir,
    sources,
    baseDir,
    keyDir: join(root, 'keys'),
    minSdk: '0.3.0',
    regions: Object.keys(byPlate).map((id) => ({ id, tier: 'basic' as const, names: { tr: id }, bbox: [27, 39, 31, 42] as [number, number, number, number], stats: { addresses: 0, streets: 0, neighbourhoods: 0 }, files: [{ kind: 'route' as const, source: files[id] as string }] })),
  });
  return { root, packsDir, workDir, plates: Object.keys(byPlate).sort() };
}

export function osmXml(rows: RoadRows): string {
  const nodes = new Map<number, [number, number]>();
  for (const w of rows.ways) w.nodes.forEach((id, i) => nodes.set(id, w.coords[i] as [number, number]));
  const oneway = { f: 'yes', b: '-1', '': 'no' };
  const parts = [...nodes].sort((a, b) => a[0] - b[0]).map(([id, [lon, lat]]) => `<node id="${id}" version="1" timestamp="2026-01-01T00:00:00Z" lat="${lat}" lon="${lon}"/>`);
  for (const w of rows.ways) {
    const tags = [`<tag k="highway" v="${w.cls}"/>`, `<tag k="oneway" v="${oneway[w.oneway]}"/>`, ...(w.speed ? [`<tag k="maxspeed" v="${w.speed}"/>`] : [])];
    parts.push(`<way id="${w.id}" version="1" timestamp="2026-01-01T00:00:00Z">${w.nodes.map((n) => `<nd ref="${n}"/>`).join('')}${tags.join('')}</way>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<osm version="0.6" generator="fixture">\n${parts.join('\n')}\n</osm>\n`;
}
