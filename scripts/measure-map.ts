import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildStyle, type MapStyle } from '../src/native/map/style';
import { openSqlite } from '../src/node/sqlite';
import { defaultReportDir } from './device-report';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const FIELDS = ['filter', 'layout.icon-image', 'layout.text-field', 'layout.symbol-sort-key', 'paint.icon-color', 'paint.text-color'] as const;

export const exprNodes = (value: unknown): number => (Array.isArray(value) ? 1 + value.reduce((sum: number, item) => sum + exprNodes(item), 0) : 0);

export type StyleStats = { layers: number; sources: number; bytes: number; largest: { layer: string; field: string; nodes: number } | null; heaviestLayer: { layer: string; bytes: number } | null };

export function styleStats(style: MapStyle): StyleStats {
  let largest: StyleStats['largest'] = null;
  let heaviestLayer: StyleStats['heaviestLayer'] = null;
  for (const layer of style.layers) {
    const bytes = JSON.stringify(layer).length;
    if (!heaviestLayer || bytes > heaviestLayer.bytes) heaviestLayer = { layer: layer.id, bytes };
    for (const field of FIELDS) {
      const [group, key] = field.includes('.') ? (field.split('.') as [string, string]) : [null, field];
      const holder = group ? ((layer as unknown as Record<string, Record<string, unknown> | undefined>)[group] ?? {}) : (layer as unknown as Record<string, unknown>);
      const nodes = exprNodes(holder[key]);
      if (!largest || nodes > largest.nodes) largest = { layer: layer.id, field, nodes };
    }
  }
  return { layers: style.layers.length, sources: Object.keys(style.sources).length, bytes: JSON.stringify(style).length, largest, heaviestLayer };
}

export const syntheticRegions = (count: number) => Array.from({ length: count }, (_, i) => ({ id: String(i + 1).padStart(2, '0'), tilesPath: `files/${i + 1}/tiles.pmtiles`, placesPath: `files/${i + 1}/places.pmtiles` }));

export const styleFor = (count: number, hoods: { name: string; lng: number; lat: number }[] = []): MapStyle =>
  buildStyle({ theme: 'light', lang: 'tr', rootUrl: 'file:///geo/', baseDir: 'files/base', regions: syntheticRegions(count), hoods });

export async function hoodCounts(packsDir: string): Promise<{ total: number; byRegion: Record<string, number> }> {
  const byRegion: Record<string, number> = {};
  let total = 0;
  if (!existsSync(packsDir)) return { total, byRegion };
  for (const id of readdirSync(packsDir).filter((name) => /^\d\d$/.test(name)).sort()) {
    const file = readdirSync(join(packsDir, id)).find((name) => name.startsWith('address-') && name.endsWith('.sqlite'));
    if (!file) continue;
    const db = openSqlite(join(packsDir, id, file));
    try {
      const [row] = await db.all<{ n: number }>('select count(*) as n from neighbourhood');
      byRegion[id] = row?.n ?? 0;
      total += byRegion[id]!;
    } finally {
      await db.close();
    }
  }
  return { total, byRegion };
}

const kb = (bytes: number): string => `${(bytes / 1024).toFixed(0)} KB`;

export function styleTable(counts: number[]): string[] {
  const rows = counts.map((count) => {
    const stats = styleStats(styleFor(count));
    return `| ${count} | ${stats.layers} | ${stats.sources} | ${kb(stats.bytes)} | ${stats.largest ? `${stats.largest.layer} ${stats.largest.field} ${stats.largest.nodes}` : '-'} | ${stats.heaviestLayer ? `${stats.heaviestLayer.layer} ${kb(stats.heaviestLayer.bytes)}` : '-'} |`;
  });
  return ['| İl | Katman | Kaynak | Stil | En büyük ifade (düğüm) | En ağır katman |', '|---|---|---|---|---|---|', ...rows];
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const at = argv.indexOf('--check');
  const check = at >= 0 ? argv[at + 1] : 'all';
  const outAt = argv.indexOf('--out');
  const out = outAt >= 0 ? argv[outAt + 1]! : join(defaultReportDir(), 'fix-0-temel.md');
  const packs = join(repoRoot, 'dist', 'packs');
  const lines = [`# Harita temel ölçümü (${new Date().toISOString().slice(0, 10)})`, ''];
  if (check === 'style' || check === 'expr' || check === 'all') lines.push('## Stil', '', ...styleTable([1, 2, 12, 81]), '');
  if (check === 'hoods' || check === 'all') {
    const hoods = await hoodCounts(packs);
    const withHoods = styleStats(styleFor(81, Array.from({ length: hoods.total }, (_, i) => ({ name: `Mahalle ${i}`, lng: 26 + (i % 1800) / 100, lat: 36 + Math.floor(i / 1800) / 10 }))));
    lines.push('## Mahalle adları', '', `- Toplam: ${hoods.total} (${Object.keys(hoods.byRegion).length} il)`, `- İstanbul: ${hoods.byRegion['34'] ?? 0}`, `- 81 il + mahalle adları stil boyutu: ${kb(withHoods.bytes)}`, '');
  }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, lines.join('\n'));
  console.log(lines.join('\n'));
  console.log(out);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => process.exit(code));
}
