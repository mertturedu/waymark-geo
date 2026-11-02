import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildBaseGraph, graphOptionsFor, parseRoadRows, type BaseGraph, type PackSettings, type RoadRows } from '../pipeline/build/route-graph';
import { buildRoutePack } from '../pipeline/build/route-pack';
import { applyRestrictions, entryNode } from '../pipeline/build/route-turns';
import { PRIORITY_PLATES } from '../pipeline/build/tiles';
import { createSearcher } from '../src/core/route/ch-query';
import { speedTable } from '../src/core/route/speeds';
import { arcWeight, sameEdgeCost, sourceLabels, targetLabels } from '../src/core/route/labels';
import { FLAG, type RoutePack, edgeLine, readRoutePack } from '../src/core/route/format';
import { UNREACHABLE } from '../src/core/route/matrix';
import { oracleWeights, plainGraph } from '../src/core/route/oracle';
import { createPlanner, type Planner } from '../src/core/route/planner';
import { createRouter } from '../src/core/route/router';
import { project, snapPoint, type Snap } from '../src/core/route/snap';
import { createBorders } from '../src/core/region/borders';
import { createNodeRouteStore } from '../src/node/pack-store';
import { repoRoot, type Measured } from './measure-address';
import { percentile } from './measure-quality';

export type RouteContext = { packsDir: string; workDir: string; plates: string[] };

export const defaultContext = (plates: string[]): RouteContext => ({ packsDir: join(repoRoot, 'dist', 'packs'), workDir: join(repoRoot, 'dist', 'work', '261020'), plates });

export const REFERENCE_PLATES = ['79', '69', '75'];
const REFERENCE_SOURCES = 40;
const REFERENCE_TARGETS = 50;
export const EXACT_PLATES = [...PRIORITY_PLATES, '79'].sort();
const BATCHES = 10;
const SOURCES = 50;
const TARGETS = 40;
const LEG_SOURCES = 2;
const LEG_TARGETS = 10;
const ONEWAY_ROUTES = 20_000;
export const SIZE_ISTANBUL_MAX = 35_000_000;
export const SIZE_PRIORITY_MAX = 200_000_000;
export const MAIN_SHARE_MIN = 0.97;
export const ROUTE_P95_MAX_MS = 5;
export const MATRIX_MAX_MS = 300;
export const HERMES_MATRIX_MAX_MS = 2000;
export const MEMORY_MAX_BYTES = 80_000_000;
const SPEED_ROUTES = 2000;
const MATRIX_SIDE = 50;
const MATRIX_RUNS = 10;

export type Loaded = { plate: string; pack: RoutePack; planner: Planner; rows: RoadRows; graph: BaseGraph };

export function randomOf(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

export async function loadPlate(ctx: RouteContext, plate: string): Promise<Loaded> {
  const store = await createNodeRouteStore(ctx.packsDir);
  const bytes = await store.read(plate);
  if (bytes === null) throw new Error(`${plate}: rota paketi yok`);
  const pack = readRoutePack(bytes);
  const rows = parseRoadRows(readFileSync(join(ctx.workDir, 'roads', plate, 'roads.jsonl'), 'utf8'));
  const stats = JSON.parse(readFileSync(join(ctx.workDir, 'packs', plate, 'route-stats.json'), 'utf8')) as { options: PackSettings };
  const borders = createBorders(new Uint8Array(readFileSync(join(repoRoot, 'src', 'core', 'region', 'data', 'borders.bin'))));
  return { plate, pack, planner: createPlanner(pack), rows, graph: buildBaseGraph(rows, graphOptionsFor(stats.options, borders)) };
}

export function randomSnap(pack: RoutePack, rnd: () => number): Snap {
  const edge = Math.floor(rnd() * pack.edges.count);
  return { edge, offsetM: rnd() * (pack.edges.length[edge] as number), distanceM: 0, point: [0, 0] };
}

const tailOf = (pack: RoutePack, pa: number): number => (((pa & 1) === 0 ? pack.edges.tail : pack.edges.head)[pa >> 1] as number);
const headOf = (pack: RoutePack, pa: number): number => tailOf(pack, pa ^ 1);

export function legWeight(pack: RoutePack, from: Snap, to: Snap, arcs: number[]): number | null {
  if (arcs.length === 1) {
    const direct = sameEdgeCost(pack, from, to);
    return direct && direct.pa === arcs[0] ? direct.w : null;
  }
  const first = sourceLabels(pack, from).find((l) => l.pa === arcs[0]);
  const last = targetLabels(pack, to).find((l) => l.pa === arcs[arcs.length - 1]);
  if (!first || !last) return null;
  let total = first.w + last.w;
  for (let i = 1; i + 1 < arcs.length; i++) total += arcWeight(pack, arcs[i] as number);
  for (let i = 0; i + 1 < arcs.length; i++) if (headOf(pack, arcs[i] as number) !== tailOf(pack, arcs[i + 1] as number)) return null;
  return total;
}

export type ExactCounts = { pairs: number; wrong: number; unreachable: number; legs: number; badLegs: number };

export function checkExact(loaded: Loaded, seed: number): ExactCounts {
  const { pack, planner } = loaded;
  const rnd = randomOf(seed);
  const graph = plainGraph(pack.hierarchy);
  const counts: ExactCounts = { pairs: 0, wrong: 0, unreachable: 0, legs: 0, badLegs: 0 };
  for (let b = 0; b < BATCHES; b++) {
    const from = Array.from({ length: SOURCES }, () => randomSnap(pack, rnd));
    const to = Array.from({ length: TARGETS }, () => randomSnap(pack, rnd));
    const table = planner.matrix(from, to);
    const truth = oracleWeights(graph, from.map((s) => sourceLabels(pack, s)), to.map((s) => targetLabels(pack, s)));
    from.forEach((a, i) => {
      to.forEach((c, j) => {
        const at = i * TARGETS + j;
        const direct = sameEdgeCost(pack, a, c);
        const expected = Math.min(truth[at] as number, direct ? direct.w : UNREACHABLE);
        counts.pairs++;
        if (expected === UNREACHABLE) counts.unreachable++;
        if (table.w[at] !== expected) counts.wrong++;
        if (i < LEG_SOURCES && j < LEG_TARGETS) {
          const leg = planner.route(a, c);
          counts.legs++;
          const weight = leg === null ? UNREACHABLE : legWeight(pack, a, c, leg.arcs);
          if (weight !== expected || (leg !== null && leg.durationDs !== expected)) counts.badLegs++;
        }
      });
    });
  }
  return counts;
}

export async function measureExact(ctx: RouteContext): Promise<Measured> {
  const lines = ['# Hızlandırılmış arama ile düz Dijkstra', '', `Her ilde ${BATCHES} grup, grup başına ${SOURCES} kaynak x ${TARGETS} hedef (yol üzerinde rastgele noktalar), toplam ${BATCHES * SOURCES * TARGETS} çift. Beklenen süre düz Dijkstra ile bulunur (aynı yol üstü çiftlerde doğrudan yol dahil), matris ve tek sorgu bununla birebir aynı olmalıdır.`, '', '| İl | Çift | Ulaşılamaz | Fark | Yol çizimi | Tutmayan yol |', '|---|---|---|---|---|---|'];
  let pairs = 0;
  let wrong = 0;
  let badLegs = 0;
  for (const plate of ctx.plates) {
    const c = checkExact(await loadPlate(ctx, plate), Number(plate) * 7919);
    lines.push(`| ${plate} | ${c.pairs} | ${c.unreachable} | ${c.wrong} | ${c.legs} | ${c.badLegs} |`);
    pairs += c.pairs;
    wrong += c.wrong;
    badLegs += c.badLegs;
  }
  lines.push('', `Toplam ${pairs} çift, ${wrong} fark, ${badLegs} tutmayan yol çizimi.`);
  return { check: 'exact', pass: pairs > 0 && wrong === 0 && badLegs === 0, measured: `${pairs} çift, ${wrong} fark, ${badLegs} tutmayan yol`, report: lines.join('\n') + '\n' };
}

export type OnewayCounts = { routes: number; found: number; arcs: number; against: number };

export function checkOneway(loaded: Loaded, seed: number, routes: number): OnewayCounts {
  const { pack, planner, graph, rows } = loaded;
  const rnd = randomOf(seed);
  const raw = new Map(rows.ways.map((w) => [w.id, w.oneway]));
  const counts: OnewayCounts = { routes, found: 0, arcs: 0, against: 0 };
  for (let i = 0; i < routes * 3 && counts.found < routes; i++) {
    const leg = planner.route(randomSnap(pack, rnd), randomSnap(pack, rnd));
    if (leg === null) continue;
    counts.found++;
    for (const pa of leg.arcs) {
      counts.arcs++;
      const oneway = raw.get((graph.edges[pa >> 1] as { way: number }).way);
      if (((pa & 1) === 0 && oneway === 'b') || ((pa & 1) === 1 && oneway === 'f')) counts.against++;
    }
  }
  return counts;
}

export async function measureOneway(ctx: RouteContext): Promise<Measured> {
  const per = Math.ceil(ONEWAY_ROUTES / ctx.plates.length);
  const lines = ['# Tek yön denetimi', '', 'Rastgele noktalar arasında çizilen yolların her yol parçası, ham OSM verisindeki tek yön etiketiyle (paketten bağımsız) karşılaştırılır.', '', '| İl | Yol | Bulunan | Parça | Ters yönde |', '|---|---|---|---|---|'];
  let routes = 0;
  let against = 0;
  for (const plate of ctx.plates) {
    const c = checkOneway(await loadPlate(ctx, plate), Number(plate) * 104729, per);
    lines.push(`| ${plate} | ${c.routes} | ${c.found} | ${c.arcs} | ${c.against} |`);
    routes += c.found;
    against += c.against;
  }
  lines.push('', `${routes} yol, ters yönde geçen parça: ${against}.`);
  return { check: 'oneway', pass: routes > 0 && against === 0, measured: `${routes} yol, ters yönde ${against} parça`, report: lines.join('\n') + '\n' };
}

export async function measureSizes(ctx: RouteContext): Promise<Measured> {
  const manifest = JSON.parse(readFileSync(join(ctx.packsDir, 'manifest-v1.json'), 'utf8')) as { regions: { id: string; files: { kind: string; path: string }[] }[] };
  const size = (plate: string): number => {
    const path = manifest.regions.find((r) => r.id === plate)?.files.find((f) => f.kind === 'route')?.path;
    return path ? statSync(join(ctx.packsDir, path)).size : 0;
  };
  const mb = (n: number): string => (n / 1e6).toFixed(1);
  const istanbul = size('34');
  const priority = PRIORITY_PLATES.reduce((sum, plate) => sum + size(plate), 0);
  const all = manifest.regions.reduce((sum, r) => sum + size(r.id), 0);
  const lines = ['# Rota paketi boyutları', '', '| İl | MB |', '|---|---|', ...manifest.regions.map((r) => `| ${r.id} | ${mb(size(r.id))} |`), '', `İstanbul ${mb(istanbul)} MB (sınır ${SIZE_ISTANBUL_MAX / 1e6}), 12 il ${mb(priority)} MB (sınır ${SIZE_PRIORITY_MAX / 1e6}), 81 il ${mb(all)} MB.`];
  return { check: 'sizes', pass: istanbul > 0 && istanbul <= SIZE_ISTANBUL_MAX && priority <= SIZE_PRIORITY_MAX, measured: `İstanbul ${mb(istanbul)} MB, 12 il ${mb(priority)} MB, 81 il ${mb(all)} MB`, report: lines.join('\n') + '\n' };
}

export async function measureConnectivity(ctx: RouteContext): Promise<Measured> {
  const lines = ['# Bağlılık', '', `Her ilin rota ağında en büyük güçlü bağlı bileşenin düğümlere oranı; eşik en az yüzde ${MAIN_SHARE_MIN * 100}.`, '', '| İl | Düğüm | Oran (yüzde) |', '|---|---|---|'];
  const low: string[] = [];
  let worst = 100;
  for (const plate of ctx.plates) {
    const stats = JSON.parse(readFileSync(join(ctx.workDir, 'packs', plate, 'route-stats.json'), 'utf8')) as { graphNodes: number; mainShare: number };
    const percent = stats.mainShare * 100;
    worst = Math.min(worst, percent);
    lines.push(`| ${plate} | ${stats.graphNodes} | ${percent.toFixed(2)} |`);
    if (stats.mainShare < MAIN_SHARE_MIN) low.push(`${plate} (${percent.toFixed(1)})`);
  }
  lines.push('', low.length === 0 ? 'Hepsi eşiğin üstünde.' : `Eşiğin altında: ${low.join(', ')}.`);
  return { check: 'connectivity', pass: low.length === 0, measured: `en düşük yüzde ${worst.toFixed(2)}${low.length > 0 ? `; altında ${low.length} il: ${low.slice(0, 6).join(', ')}` : ''}`, report: lines.join('\n') + '\n' };
}


export type ReferenceOptions = { clipFile?: (plate: string) => string; python?: string };

export type ReferenceRow = { plate: string; pairs: number; unreachable: number; outside: number; worst: number };

function ensureClips(ctx: RouteContext, plates: string[]): void {
  const missing = plates.filter((plate) => !existsSync(join(ctx.workDir, 'clips', `${plate}.osm.pbf`)));
  if (missing.length === 0) return;
  execFileSync(join(repoRoot, 'pipeline', '.venv', 'bin', 'python'), [join(repoRoot, 'pipeline', 'extract', 'extract_roads.py'), join(repoRoot, 'pipeline', 'data', 'turkey-261020.osm.pbf'), join(ctx.workDir, 'admin-full.jsonl'), join(ctx.workDir, 'roads'), '--provinces', missing.join(','), '--keep-clips', join(ctx.workDir, 'clips')], { stdio: 'pipe' });
}

export function compareReference(ctx: RouteContext, plate: string, options: ReferenceOptions = {}): { row: ReferenceRow; outside: string[] } {
  const rows = parseRoadRows(readFileSync(join(ctx.workDir, 'roads', plate, 'roads.jsonl'), 'utf8'));
  const settings = { ferries: false, comparison: true };
  const built = buildRoutePack(rows, settings);
  const pack = readRoutePack(built.bytes);
  const graph = buildBaseGraph(rows, settings);
  const searcher = createSearcher(pack.hierarchy);
  const rnd = randomOf(Number(plate) * 15485863);
  const real = graph.nodeOsm.map((osm, index) => (osm >= 0 ? index : -1)).filter((index) => index >= 0);
  const origins = Array.from({ length: REFERENCE_SOURCES }, () => real[Math.floor(rnd() * real.length)] as number);
  const picks: [number, number][] = origins.flatMap((a) => Array.from({ length: REFERENCE_TARGETS }, (): [number, number] => [a, real[Math.floor(rnd() * real.length)] as number]));
  const tmp = mkdtempSync(join(tmpdir(), 'route-ref-'));
  writeFileSync(join(tmp, 'pairs.json'), JSON.stringify(picks.map(([a, b]) => [graph.nodeOsm[a], graph.nodeOsm[b]])));
  writeFileSync(join(tmp, 'speeds.json'), JSON.stringify(speedTable()));
  const clip = options.clipFile ? options.clipFile(plate) : join(ctx.workDir, 'clips', `${plate}.osm.pbf`);
  execFileSync(options.python ?? join(repoRoot, 'pipeline', '.venv', 'bin', 'python'), [join(repoRoot, 'test', 'reference', 'route_reference.py'), clip, join(tmp, 'pairs.json'), join(tmp, 'out.json'), join(tmp, 'speeds.json')], { stdio: 'pipe' });
  const answers = JSON.parse(readFileSync(join(tmp, 'out.json'), 'utf8')) as ({ seconds: number; edges: number } | null)[];
  const row: ReferenceRow = { plate, pairs: picks.length, unreachable: 0, outside: 0, worst: 0 };
  const outside: string[] = [];
  picks.forEach(([a, b], i) => {
    const want = answers[i] ?? null;
    const got = searcher.path([{ node: pack.base.node[a] as number, w: 0, len: 0 }], [{ node: pack.base.node[b] as number, w: 0, len: 0 }]);
    if (want === null || got === null) {
      if ((want === null) !== (got === null)) {
        row.outside++;
        if (outside.length < 20) outside.push(`${plate}: ${graph.nodeOsm[a]} → ${graph.nodeOsm[b]}: SDK ${got ? got.weight / 10 : 'yok'} sn, referans ${want ? want.seconds.toFixed(1) : 'yok'} sn`);
      } else row.unreachable++;
      return;
    }
    const diff = Math.abs(got.weight - want.seconds * 10);
    const allowed = 0.5 * (got.arcs.length + want.edges) + 1e-6;
    row.worst = Math.max(row.worst, diff / allowed);
    if (diff > allowed) {
      row.outside++;
      if (outside.length < 20) outside.push(`${plate}: ${graph.nodeOsm[a]} → ${graph.nodeOsm[b]}: SDK ${got.weight / 10} sn, referans ${want.seconds.toFixed(1)} sn, pay ${(allowed / 10).toFixed(2)} sn`);
    }
  });
  return { row, outside };
}

export async function measureReference(ctx: RouteContext, options: ReferenceOptions = {}): Promise<Measured> {
  if (!options.clipFile) ensureClips(ctx, ctx.plates);
  const lines = ['# Bağımsız referans (Python, networkx)', '', 'Ham OSM kesitinden ayrı bir grafik kurulur (kavşak sıkıştırması yok, dönüş yasağı ve ceza yok, kent yavaşlatması yok, feribot yok); iki taraf da aynı hız tablosunu kullanır. Süre farkı yol parçası başına yarım desisaniye yuvarlama payını aşamaz.', '', '| İl | Çift | İkisinde de ulaşılamaz | Aşan | En kötü fark / pay |', '|---|---|---|---|---|'];
  let pairs = 0;
  let outsideTotal = 0;
  const details: string[] = [];
  for (const plate of ctx.plates) {
    const { row, outside } = compareReference(ctx, plate, options);
    lines.push(`| ${plate} | ${row.pairs} | ${row.unreachable} | ${row.outside} | ${row.worst.toFixed(2)} |`);
    pairs += row.pairs;
    outsideTotal += row.outside;
    details.push(...outside);
  }
  lines.push('', `Toplam ${pairs} çift, payı aşan ya da bir tarafta olmayan ${outsideTotal}.`, '', ...(details.length > 0 ? ['## Aşanlar (ilk 20)', '', ...details.map((d) => `- ${d}`)] : []));
  return { check: 'reference', pass: pairs > 0 && outsideTotal === 0, measured: `${pairs} çift, payı aşan ${outsideTotal}`, report: lines.join('\n') + '\n' };
}

export type SpeedNumbers = { routeP95: number; routeMedian: number; matrixWorst: number; matrixMedian: number };

export function timeQueries(loaded: Loaded, seed: number, routes = SPEED_ROUTES): SpeedNumbers {
  const { pack, planner } = loaded;
  const rnd = randomOf(seed);
  const spans: number[] = [];
  for (let i = 0; i < routes; i++) {
    const a = randomSnap(pack, rnd);
    const b = randomSnap(pack, rnd);
    const started = performance.now();
    planner.route(a, b);
    spans.push(performance.now() - started);
  }
  const tables: number[] = [];
  for (let run = 0; run < MATRIX_RUNS; run++) {
    const from = Array.from({ length: MATRIX_SIDE }, () => randomSnap(pack, rnd));
    const to = Array.from({ length: MATRIX_SIDE }, () => randomSnap(pack, rnd));
    const started = performance.now();
    planner.matrix(from, to);
    tables.push(performance.now() - started);
  }
  spans.sort((x, y) => x - y);
  tables.sort((x, y) => x - y);
  return { routeP95: percentile(spans, 0.95), routeMedian: percentile(spans, 0.5), matrixWorst: tables[tables.length - 1] as number, matrixMedian: percentile(tables, 0.5) };
}

export async function measureSpeed(ctx: RouteContext): Promise<Measured> {
  const lines = ['# Rota hızı (Node, bu Mac)', '', `Tek sorgu: iki rastgele yol noktası arası ${SPEED_ROUTES} rota (arama, açma ve çizgi dahil), yüzde 95lik dilim en çok ${ROUTE_P95_MAX_MS} ms. Matris: ${MATRIX_SIDE} x ${MATRIX_SIDE}, ${MATRIX_RUNS} koşunun en kötüsü en çok ${MATRIX_MAX_MS} ms.`, '', '| İl | Tek sorgu p95 (ms) | Tek sorgu ortanca (ms) | Matris en kötü (ms) | Matris ortanca (ms) |', '|---|---|---|---|---|'];
  let pass = true;
  const notes: string[] = [];
  for (const plate of ctx.plates) {
    const n = timeQueries(await loadPlate(ctx, plate), Number(plate) * 31337);
    lines.push(`| ${plate} | ${n.routeP95.toFixed(2)} | ${n.routeMedian.toFixed(2)} | ${n.matrixWorst.toFixed(0)} | ${n.matrixMedian.toFixed(0)} |`);
    if (n.routeP95 > ROUTE_P95_MAX_MS || n.matrixWorst > MATRIX_MAX_MS) pass = false;
    notes.push(`${plate}: ${n.routeP95.toFixed(2)} ms, matris ${n.matrixWorst.toFixed(0)} ms`);
  }
  return { check: 'speed', pass, measured: notes.join('; '), report: lines.join('\n') + '\n' };
}

export function runHermes(packFile: string): { loadMs: number; matrixMs: number[]; routeP95Ms: number; edges: number } {
  const dir = mkdtempSync(join(tmpdir(), 'route-hermes-'));
  const bundle = join(dir, 'route.js');
  const built = spawnSync(join(repoRoot, 'node_modules', '.bin', 'esbuild'), [join(repoRoot, 'scripts', 'hermes-route-entry.ts'), '--bundle', '--format=iife', '--platform=neutral', '--target=es2019', `--outfile=${bundle}`], { encoding: 'utf8', cwd: repoRoot });
  if (built.status !== 0) throw new Error(`bundle failed: ${built.stderr.slice(-300)}`);
  const full = join(dir, 'route-data.js');
  writeFileSync(full, `var PACK_B64 = "${readFileSync(packFile).toString('base64')}";\n${readFileSync(bundle, 'utf8')}`);
  const ran = spawnSync(join(repoRoot, 'pipeline', 'bin', 'hermes', 'hermes'), [full], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (ran.status !== 0) throw new Error(`hermes failed: ${(ran.stderr || ran.stdout).slice(-300)}`);
  return JSON.parse(ran.stdout.trim().split('\n').pop() as string);
}

export async function measureHermes(ctx: RouteContext, plate = '34'): Promise<Measured> {
  const manifest = JSON.parse(readFileSync(join(ctx.packsDir, 'manifest-v1.json'), 'utf8')) as { regions: { id: string; files: { kind: string; path: string }[] }[] };
  const path = manifest.regions.find((r) => r.id === plate)?.files.find((f) => f.kind === 'route')?.path;
  if (!path) throw new Error(`${plate}: rota paketi yok`);
  const got = runHermes(join(ctx.packsDir, path));
  const worst = Math.max(...got.matrixMs);
  const lines = ['# Rota hızı (Hermes, yorumlayıcı)', '', `${plate} paketi (${got.edges} yol parçası) Hermes CLI içinde okunur; ${MATRIX_SIDE} x ${MATRIX_SIDE} matris 3 kez koşar, en kötüsü en çok ${HERMES_MATRIX_MAX_MS} ms olmalı.`, '', `- Paketi okuma ve kurma: ${got.loadMs} ms`, `- Matris süreleri (ms): ${got.matrixMs.join(', ')}`, `- Tek rota p95: ${got.routeP95Ms} ms`];
  return { check: 'hermes', pass: worst <= HERMES_MATRIX_MAX_MS, measured: `matris ${MATRIX_SIDE}x${MATRIX_SIDE} en kötü ${worst} ms (sınır ${HERMES_MATRIX_MAX_MS}), okuma ${got.loadMs} ms, tek rota p95 ${got.routeP95Ms} ms`, report: lines.join('\n') + '\n' };
}

export function memoryChild(ctx: RouteContext, plate: string): { deltaBytes: number } {
  const gc = (globalThis as { gc?: () => void }).gc;
  if (!gc) throw new Error('--expose-gc gerekli');
  const used = (): number => process.memoryUsage().heapUsed + process.memoryUsage().arrayBuffers;
  gc();
  const before = used();
  const store = JSON.parse(readFileSync(join(ctx.packsDir, 'manifest-v1.json'), 'utf8')) as { regions: { id: string; files: { kind: string; path: string }[] }[] };
  const path = store.regions.find((r) => r.id === plate)?.files.find((f) => f.kind === 'route')?.path as string;
  const pack = readRoutePack(new Uint8Array(readFileSync(join(ctx.packsDir, path))));
  const planner = createPlanner(pack);
  const rnd = randomOf(5);
  const from = Array.from({ length: MATRIX_SIDE }, () => randomSnap(pack, rnd));
  planner.matrix(from, from);
  planner.route(from[0] as Snap, from[1] as Snap);
  gc();
  return { deltaBytes: used() - before };
}

export async function measureMemory(ctx: RouteContext, plate = '34'): Promise<Measured> {
  const ran = spawnSync(process.execPath, ['--expose-gc', '--import', 'tsx', join(repoRoot, 'scripts', 'measure-route.ts'), '--memory-child', plate, '--packs', ctx.packsDir], { encoding: 'utf8', cwd: repoRoot });
  if (ran.status !== 0) throw new Error(`bellek ölçümü kırıldı: ${(ran.stderr || ran.stdout).slice(-300)}`);
  const { deltaBytes } = JSON.parse(ran.stdout.trim().split('\n').pop() as string) as { deltaBytes: number };
  const mb = (deltaBytes / 1e6).toFixed(1);
  return { check: 'memory', pass: deltaBytes <= MEMORY_MAX_BYTES, measured: `${plate} paketi yüklüyken artış ${mb} MB (sınır ${MEMORY_MAX_BYTES / 1e6})`, report: `# Rota paketi belleği\n\n${plate} paketi okunup arama kurulduğunda ve bir matris ile bir rota koşulduğunda Node'da heapUsed + arrayBuffers artışı ${mb} MB. Sınır ${MEMORY_MAX_BYTES / 1e6} MB.\n` };
}

export type TurnCounts = { rules: number; tested: number; moot: number; sameEdge: number; reversed: number; ambiguous: number; unreachable: number; violations: number; examples: string[] };

function graphTools(loaded: Loaded) {
  const { graph, pack } = loaded;
  const usable = (pa: number): boolean => (pa & 1) === 0 ? (graph.edges[pa >> 1] as { forward: boolean }).forward : (graph.edges[pa >> 1] as { backward: boolean }).backward;
  const tail = (pa: number): number => (pa & 1) === 0 ? (graph.edges[pa >> 1] as { tail: number }).tail : (graph.edges[pa >> 1] as { head: number }).head;
  const head = (pa: number): number => tail(pa ^ 1);
  const osm = (node: number): number => graph.nodeOsm[node] as number;
  const wayOf = (pa: number): number => (graph.edges[pa >> 1] as { way: number }).way;
  const arcsOf = (way: number): number[] => (graph.wayEdges.get(way) ?? []).flatMap((e) => [2 * e, 2 * e + 1]).filter(usable);
  const into = (way: number, node: number): number[] => arcsOf(way).filter((pa) => osm(head(pa)) === node);
  const from = (way: number, node: number): number[] => arcsOf(way).filter((pa) => osm(tail(pa)) === node);
  const ends = (way: number): Set<number> => new Set((graph.wayEdges.get(way) ?? []).flatMap((e) => [osm((graph.edges[e] as { tail: number }).tail), osm((graph.edges[e] as { head: number }).head)]).filter((id) => id >= 0));
  const snapAt = (pa: number, fraction: number): Snap => {
    const edge = pa >> 1;
    return { edge, offsetM: (pack.edges.length[edge] as number) * ((pa & 1) === 0 ? fraction : 1 - fraction), distanceM: 0, point: [0, 0] };
  };
  let leavingIndex: Map<number, number[]> | null = null;
  const leaving = (node: number): number[] => {
    if (leavingIndex === null) {
      leavingIndex = new Map();
      for (let pa = 0; pa < graph.edges.length * 2; pa++) {
        if (!usable(pa)) continue;
        const key = osm(tail(pa));
        const list = leavingIndex.get(key);
        if (list) list.push(pa);
        else leavingIndex.set(key, [pa]);
      }
    }
    return leavingIndex.get(node) ?? [];
  };
  const runs = (arcs: number[]): number[] => arcs.map(wayOf).filter((w, i, all) => i === 0 || w !== all[i - 1]);
  return { usable, tail, head, osm, wayOf, arcsOf, into, from, leaving, ends, snapAt, runs };
}

const contains = (haystack: number[], needle: number[]): number => {
  for (let i = 0; i + needle.length <= haystack.length; i++) if (needle.every((w, k) => haystack[i + k] === w)) return i;
  return -1;
};

export function checkTurns(loaded: Loaded, cap = Infinity, expand: typeof applyRestrictions = applyRestrictions): TurnCounts {
  const t = graphTools(loaded);
  const { planner } = loaded;
  const counts: TurnCounts = { rules: 0, tested: 0, moot: 0, sameEdge: 0, reversed: 0, ambiguous: 0, unreachable: 0, violations: 0, examples: [] };
  const sameEdge: { rule: { id: number; kind: string; restriction: string }; arrive: number }[] = [];
  const verdict = (rule: { id: number; kind: string; restriction: string }, a: number, b: number, bad: (arcs: number[]) => boolean): void => {
    if (a >> 1 === b >> 1) {
      counts.sameEdge++;
      sameEdge.push({ rule, arrive: a });
      return;
    }
    const leg = planner.route(t.snapAt(a, 0.9), t.snapAt(b, 0.1));
    counts.tested++;
    if (leg === null) counts.unreachable++;
    else if (bad(leg.arcs)) {
      counts.violations++;
      if (counts.examples.length < 20) counts.examples.push(`kural ${rule.id} (${rule.kind} ${rule.restriction})`);
    }
  };
  for (const rule of loaded.rows.rules.slice(0, cap)) {
    counts.rules++;
    const first = rule.via[0];
    if (first && 'n' in first && rule.via.length === 1) {
      const ins = t.into(rule.from, first.n);
      const turning = rule.restriction.endsWith('u_turn') && rule.from === rule.to;
      const outs = t.from(rule.to, first.n).filter((pa) => !turning || ins.includes(pa ^ 1));
      if (ins.length === 0 || outs.length === 0) {
        counts.moot++;
        continue;
      }
      if (ins.length > 1 || (rule.kind === 'no' && outs.length > 1)) {
        counts.ambiguous++;
        continue;
      }
      const a = ins[0] as number;
      const arrives = (x: number): boolean => t.wayOf(x) === rule.from && t.osm(t.head(x)) === first.n;
      if (rule.kind === 'no') {
        const b = outs[0] as number;
        verdict(rule, a, b, (arcs) => arcs.some((x, i) => i + 1 < arcs.length && arrives(x) && t.wayOf(arcs[i + 1] as number) === rule.to && t.osm(t.tail(arcs[i + 1] as number)) === first.n));
      } else {
        const others = t.leaving(first.n).filter((pa) => t.wayOf(pa) !== rule.to).slice(0, 6);
        for (const b of others) verdict(rule, a, b, (arcs) => arcs.some((x, i) => i + 1 < arcs.length && arrives(x) && t.wayOf(arcs[i + 1] as number) !== rule.to && t.osm(t.tail(arcs[i + 1] as number)) === first.n));
      }
      continue;
    }
    const chain = [rule.from, ...rule.via.map((v) => ('w' in v ? v.w : -1)), rule.to];
    if (chain.includes(-1)) {
      counts.moot++;
      continue;
    }
    const joins = chain.slice(0, -1).map((w, i) => [...t.ends(w)].filter((n) => t.ends(chain[i + 1] as number).has(n)));
    if (joins.some((j) => j.length === 0)) {
      counts.moot++;
      continue;
    }
    if (joins.some((j) => j.length > 1)) {
      counts.ambiguous++;
      continue;
    }
    const ins = t.into(rule.from, joins[0]![0] as number);
    const outs = t.from(rule.to, joins[joins.length - 1]![0] as number);
    if (ins.length !== 1 || outs.length !== 1) {
      counts.moot += ins.length === 0 || outs.length === 0 ? 1 : 0;
      counts.ambiguous += ins.length > 1 || outs.length > 1 ? 1 : 0;
      continue;
    }
    const sequence = chain.slice(0, -1);
    verdict(rule, ins[0] as number, outs[0] as number, (arcs) => {
      const runs = t.runs(arcs);
      const at = contains(runs, sequence);
      if (at < 0) return false;
      return rule.kind === 'no' ? runs[at + sequence.length] === rule.to : runs[at + sequence.length] !== undefined && runs[at + sequence.length] !== rule.to;
    });
  }
  if (sameEdge.length > 0) {
    const expanded = expand(loaded.graph, loaded.rows.rules.slice(0, cap));
    for (const { rule, arrive } of sameEdge) {
      const copy = entryNode(expanded, arrive);
      const reverse = arrive ^ 1;
      counts.reversed++;
      const back = expanded.arcTail.some((tail, i) => tail === copy && expanded.arcPa[i] === reverse);
      if (back || copy < loaded.graph.nodeLon.length) {
        counts.violations++;
        if (counts.examples.length < 20) counts.examples.push(`kural ${rule.id} (${rule.kind} ${rule.restriction}): U dönüşü yayı kaldı`);
      }
    }
  }
  return counts;
}

export async function measureTurns(ctx: RouteContext): Promise<Measured> {
  const lines = ['# Dönüş yasakları', '', 'Her yasak kaydı için o dönüşü zorlayan sorgu üretilir: gelen yolun ucundan, gidilen yolun başına. Bulunan rotada yasak dönüş (ham OSM yol kimlikleriyle, paketten bağımsız denetlenir) olmamalıdır. `only_*` için gidilen yol dışındaki her çıkış sorgulanır.', '', '| İl | Kayıt | Sorgu | Dönüş yok (moot) | U dönüşü yapı denetimi | Belirsiz | Rota yok | İhlal |', '|---|---|---|---|---|---|---|---|'];
  const total: TurnCounts = { rules: 0, tested: 0, moot: 0, sameEdge: 0, reversed: 0, ambiguous: 0, unreachable: 0, violations: 0, examples: [] };
  for (const plate of ctx.plates) {
    const c = checkTurns(await loadPlate(ctx, plate));
    lines.push(`| ${plate} | ${c.rules} | ${c.tested} | ${c.moot} | ${c.reversed} | ${c.ambiguous} | ${c.unreachable} | ${c.violations} |`);
    for (const key of ['rules', 'tested', 'moot', 'sameEdge', 'reversed', 'ambiguous', 'unreachable', 'violations'] as const) total[key] += c[key];
    total.examples.push(...c.examples.map((e) => `${plate}: ${e}`));
  }
  lines.push('', `Toplam ${total.rules} kayıt, ${total.tested} sorgu, ${total.violations} ihlal. Dönüşün grafikte hiç olmadığı (moot) ${total.moot}; gelen ve giden aynı yol parçası olduğu için sorguyla zorlanamayan U dönüşü ${total.sameEdge} (bunların ${total.reversed} tanesinde, kopya düğümden ters yayın kalkmış olması yapı olarak denetlendi); birden çok eşleşme olduğu için elle bakılacak (belirsiz) ${total.ambiguous}.`, ...(total.examples.length > 0 ? ['', '## İhlaller', '', ...total.examples.map((e) => `- ${e}`)] : []));
  return { check: 'turns', pass: total.tested > 0 && total.violations === 0, measured: `${total.rules} kayıt, ${total.tested} sorgu, ${total.violations} ihlal (moot ${total.moot}, U dönüşü yapı denetimi ${total.reversed}, belirsiz ${total.ambiguous})`, report: lines.join('\n') + '\n' };
}

const HEAVY_CLASSES = 4;
const AVOID_M = 200;

export type SnapFinding = { name: string; ok: boolean; detail: string };

export function heavyAvoidance(loaded: Loaded, samples = 300): { tried: number; avoidable: number; kept: number; wrong: string[] } {
  const { pack } = loaded;
  const heavy: number[] = [];
  for (let e = 0; e < pack.edges.count; e++) if (((pack.edges.flags[e] as number) >> FLAG.classShift) < HEAVY_CLASSES && (pack.edges.length[e] as number) > 150) heavy.push(e);
  const out = { tried: 0, avoidable: 0, kept: 0, wrong: [] as string[] };
  const rnd = randomOf(99);
  const mLat = 111_195 / 1e6;
  for (let i = 0; i < samples && heavy.length > 0; i++) {
    const e = heavy[Math.floor(rnd() * heavy.length)] as number;
    const line = edgeLine(pack, e);
    const mid = Math.floor(line.length / 4) * 2;
    const px = line[mid] as number;
    const py = (line[mid + 1] as number) + 40 / mLat;
    const got = snapPoint(pack, px / 1e6, py / 1e6);
    out.tried++;
    if (!got.ok) continue;
    const heavyChosen = ((pack.edges.flags[got.snap.edge] as number) >> FLAG.classShift) < HEAVY_CLASSES;
    if (!heavyChosen) continue;
    const mLon = mLat * Math.cos((py / 1e6) * (Math.PI / 180));
    let other = false;
    const g = pack.grid;
    const cx = Math.floor((px - g.originLon) / g.cell);
    const cy = Math.floor((py - g.originLat) / g.cell);
    for (let dx = -1; dx <= 1 && !other; dx++) {
      for (let dy = -1; dy <= 1 && !other; dy++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= g.cols || y >= g.rows) continue;
        const cell = y * g.cols + x;
        for (let k = g.first[cell] as number; k < (g.first[cell + 1] as number); k++) {
          const edge = g.edges[k] as number;
          if (((pack.edges.flags[edge] as number) >> FLAG.classShift) < HEAVY_CLASSES) continue;
          if (project(edgeLine(pack, edge), px, py, mLon, mLat).distanceM <= AVOID_M) {
            other = true;
            break;
          }
        }
      }
    }
    if (other) {
      out.avoidable++;
      out.wrong.push(`kenar ${e} yanı ${(py / 1e6).toFixed(5)},${(px / 1e6).toFixed(5)}`);
    } else out.kept++;
  }
  return out;
}

export async function measureSnapping(ctx: RouteContext): Promise<Measured> {
  const store = await createNodeRouteStore(ctx.packsDir);
  const borders = createBorders(new Uint8Array(readFileSync(join(repoRoot, 'src', 'core', 'region', 'data', 'borders.bin'))));
  const router = createRouter({ store, borders });
  const findings: SnapFinding[] = [];
  const kadikoy: [number, number] = [29.0272, 40.9903];
  const island = await router.route(kadikoy, [29.1293, 40.8587]);
  findings.push({ name: 'Adalar: Büyükada’daki durak, Kadıköy başlangıç', ok: !island.ok && island.code === 'disconnected', detail: island.ok ? `rota bulundu (${(island.distanceM / 1000).toFixed(1)} km)` : island.code });
  const sea = await router.route(kadikoy, [28.9, 40.8]);
  findings.push({ name: 'Marmara ortasında bir durak', ok: !sea.ok && sea.code === 'no_road', detail: sea.ok ? 'rota bulundu' : sea.code });
  const loaded = await loadPlate(ctx, '34');
  const heavy = heavyAvoidance(loaded);
  findings.push({ name: 'Otoyol kenarındaki noktalar yanındaki sokağa oturur', ok: heavy.avoidable === 0 && heavy.tried > 0, detail: `${heavy.tried} nokta, otoyola oturan ${heavy.kept + heavy.avoidable}, bunların ${heavy.avoidable} tanesinde 200 m içinde başka yol vardı` });
  const lines = ['# Oturtma kuralları', '', ...findings.map((f) => `- ${f.ok ? 'Geçti' : 'Tutmadı'}: ${f.name}: ${f.detail}`), ...(heavy.wrong.length > 0 ? ['', '## Otoyola oturup başka yol varken', '', ...heavy.wrong.slice(0, 20).map((w) => `- ${w}`)] : [])];
  return { check: 'snapping', pass: findings.every((f) => f.ok), measured: findings.map((f) => `${f.ok ? 'tamam' : 'HATA'}: ${f.detail}`).join('; '), report: lines.join('\n') + '\n' };
}

export async function runCheck(check: string, ctx: RouteContext = defaultContext(EXACT_PLATES)): Promise<Measured | null> {
  if (check === 'exact') return measureExact(ctx);
  if (check === 'oneway') return measureOneway(ctx);
  if (check === 'sizes') return measureSizes(ctx);
  if (check === 'connectivity') return measureConnectivity({ ...ctx, plates: allPlates(ctx) });
  if (check === 'reference') return measureReference({ ...ctx, plates: REFERENCE_PLATES });
  if (check === 'snapping') return measureSnapping(ctx);
  if (check === 'turns') return measureTurns(ctx);
  if (check === 'speed') return measureSpeed({ ...ctx, plates: ['34', '06', '35'] });
  if (check === 'hermes') return measureHermes(ctx);
  if (check === 'memory') return measureMemory(ctx);
  return null;
}

function allPlates(ctx: RouteContext): string[] {
  const manifest = JSON.parse(readFileSync(join(ctx.packsDir, 'manifest-v1.json'), 'utf8')) as { regions: { id: string }[] };
  return manifest.regions.map((r) => r.id).sort();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href && process.argv.includes('--memory-child')) {
  const plate = process.argv[process.argv.indexOf('--memory-child') + 1] as string;
  const packs = process.argv[process.argv.indexOf('--packs') + 1] as string;
  console.log(JSON.stringify(memoryChild({ ...defaultContext([plate]), packsDir: packs }, plate)));
} else if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const at = process.argv.indexOf('--check');
  const check = at >= 0 ? process.argv[at + 1] : undefined;
  (check ? runCheck(check) : Promise.resolve(null)).then((result) => {
    if (!result) {
      console.error('kullanım: --check exact|oneway|sizes|connectivity|snapping|reference|turns|speed|hermes|memory');
      process.exit(2);
    }
    const dir = join(homedir(), 'Desktop', 'yuksi-geo-raporlar');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `faz-6-rota-${result.check}.md`), result.report);
    console.log(JSON.stringify({ check: result.check, pass: result.pass, measured: result.measured }));
    process.exit(result.pass ? 0 : 1);
  });
}

