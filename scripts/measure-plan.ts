import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createBorders } from '../src/core/region/borders';
import { edgeLine, readRoutePack } from '../src/core/route/format';
import { createRouter, type Router } from '../src/core/route/router';
import { planStops } from '../src/core/plan/plan';
import type { PlanDeps, PlanRequest, StopInput } from '../src/core/plan/types';
import type { LngLat } from '../src/core/geo/cells';
import { createNodeRouteStore } from '../src/node/pack-store';
import { repoRoot, type Measured } from './measure-address';
import { bestByEnumeration } from './plan-oracle';

const packsDir = join(repoRoot, 'dist', 'packs');
export const EXACT_SAMPLES = 2200;
export const EXACT_PLATES = ['34', '10'];

export const seeded = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export type World = { router: Router; deps: PlanDeps; points: () => LngLat; plate: string };

export async function openWorld(plate: string, seed: number): Promise<World> {
  const store = await createNodeRouteStore(packsDir);
  const borders = createBorders(new Uint8Array(readFileSync(join(repoRoot, 'src', 'core', 'region', 'data', 'borders.bin'))));
  const router = createRouter({ store, borders });
  const bytes = await store.read(plate);
  if (!bytes) throw new Error(`${plate}: rota paketi yok`);
  const pack = readRoutePack(bytes);
  const next = seeded(seed);
  const points = (): LngLat => {
    for (;;) {
      const edge = Math.floor(next() * pack.edges.count);
      const line = edgeLine(pack, edge);
      const at = Math.floor(next() * (line.length / 2)) * 2;
      const point: LngLat = [(line[at] as number) / 1e6, (line[at + 1] as number) / 1e6];
      if (borders.provinceAt(point[0], point[1]) === plate) return point;
    }
  };
  const deps: PlanDeps = { matrix: (p, o) => router.matrix(p, o), route: (a, b, o) => router.route(a, b, o), now: () => performance.now() };
  return { router, deps, points, plate };
}

export const stopsOf = (points: LngLat[]): StopInput[] => points.map((point, i) => ({ id: `d${i}`, point }));

export async function measureExact(samples = EXACT_SAMPLES): Promise<Measured> {
  const lines = ['# Kesin çözücü: 12 durağa kadar kaba kuvvetle karşılaştırma', '', '| İl | Örnek | Kısıtlı | Eşit | Fark | Çelişki doğru | Ort. süre (ms) |', '|---|---|---|---|---|---|---|'];
  let total = 0;
  let equal = 0;
  let constrained = 0;
  let conflictsRight = 0;
  let conflictsSeen = 0;
  const failures: string[] = [];
  for (const plate of EXACT_PLATES) {
    const world = await openWorld(plate, plate === '34' ? 11 : 12);
    const next = seeded(plate === '34' ? 101 : 102);
    let here = 0;
    let same = 0;
    let withRules = 0;
    let spent = 0;
    for (let sample = 0; sample < samples / EXACT_PLATES.length; sample++) {
      const size = 2 + Math.floor(next() * 11);
      const stops = stopsOf(Array.from({ length: size }, world.points));
      const useStart = next() < 0.5;
      const start = useStart ? world.points() : null;
      const request: { -readonly [K in keyof PlanRequest]: PlanRequest[K] } = { stops, ...(start ? { start: { point: start } } : {}) };
      const rules = next() < 0.5;
      const pins: { stopId: string; position: number }[] = [];
      const precedence: { before: string; after: string }[] = [];
      if (rules) {
        if (next() < 0.7) pins.push({ stopId: `d${Math.floor(next() * size)}`, position: Math.floor(next() * size) });
        const pairs = 1 + Math.floor(next() * 2);
        for (let k = 0; k < pairs; k++) {
          const a = Math.floor(next() * size);
          const b = (a + 1 + Math.floor(next() * (size - 1))) % size;
          precedence.push({ before: `d${a}`, after: `d${b}` });
        }
        request.pins = pins;
        request.precedence = precedence;
        withRules++;
      }
      const matrix = await world.router.matrix([...(start ? [start] : []), ...stops.map((s) => s.point)]);
      if (!matrix.ok) continue;
      const base = start ? 1 : 0;
      const usable = stops.every((_, i) => matrix.stops[i + base]?.ok) && (matrix.stops[0]?.ok ?? true);
      if (!usable) continue;
      const cell = (a: number, b: number): number | null => matrix.durationS[a]?.[b] ?? null;
      if (stops.some((_, i) => (start ? cell(0, i + 1) === null || cell(i + 1, 0) === null : false) || stops.some((__, j) => cell(i + base, j + base) === null))) continue;
      const started = performance.now();
      const result = await planStops(request as PlanRequest, world.deps);
      spent += performance.now() - started;
      const oracle = bestByEnumeration({
        from: stops.map((_, i) => (start ? (cell(0, i + 1) as number) : 0)),
        between: stops.map((_, i) => stops.map((__, j) => cell(i + base, j + base) as number)),
        back: null,
        pins: new Map(pins.map((p) => [Number(p.stopId.slice(1)), p.position])),
        before: precedence.map((p) => [Number(p.before.slice(1)), Number(p.after.slice(1))] as const),
      });
      here++;
      if (oracle === null) {
        conflictsSeen++;
        if (!result.ok && result.code === 'CONSTRAINT_CONFLICT') conflictsRight++;
        else failures.push(`${plate}#${sample}: kurallar çelişkili ama sonuç ${result.ok ? 'bulundu' : result.code}`);
        continue;
      }
      if (!result.ok) {
        failures.push(`${plate}#${sample}: çözülebilir ama ${result.code}`);
        continue;
      }
      const index = new Map(stops.map((s, i) => [s.id, i]));
      let cost = start ? (cell(0, (index.get(result.order[0] as string) as number) + 1) as number) : 0;
      for (let k = 1; k < result.order.length; k++) cost += cell((index.get(result.order[k - 1] as string) as number) + base, (index.get(result.order[k] as string) as number) + base) as number;
      if (cost === oracle) same++;
      else failures.push(`${plate}#${sample}: ${size} durak, çözücü ${cost} sn, en iyi ${oracle} sn`);
    }
    total += here;
    equal += same;
    constrained += withRules;
    lines.push(`| ${plate} | ${here} | ${withRules} | ${same} | ${here - same - (conflictsSeen - conflictsRight)} | | ${(spent / Math.max(here, 1)).toFixed(1)} |`);
  }
  const feasible = total - conflictsSeen;
  const pass = feasible > 0 && equal === feasible && conflictsRight === conflictsSeen;
  lines.push('', `Çözülebilir ${feasible} örneğin ${equal} tanesinde sonuç kaba kuvvetle bulunan en iyiye eşit; çelişkili ${conflictsSeen} örneğin ${conflictsRight} tanesi doğru bildirildi.`, ...(failures.length > 0 ? ['', '## Tutmayanlar', '', ...failures.slice(0, 30).map((f) => `- ${f}`)] : []));
  return { check: 'exact', pass, measured: `${total} örnek (${constrained} kısıtlı): ${equal}/${feasible} en iyiye eşit, ${conflictsRight}/${conflictsSeen} çelişki doğru`, report: lines.join('\n') + '\n' };
}


export const REFERENCE_INSTANCES = 300;
export const REFERENCE_MEAN_MAX = 1.5;
export const REFERENCE_WORST_MAX = 5;
export const TIME_50_MAX_MS = 1000;
export const TIME_100_MAX_MS = 3000;
const workDir = join(repoRoot, 'dist', 'work', 'plan');

type Instance = {
  id: number;
  plate: string;
  size: number;
  hasStart: boolean;
  end: 'free' | 'return';
  matrix: number[][];
  pins: { node: number; position: number }[];
  precedence: [number, number][];
};

export async function exportInstances(count = REFERENCE_INSTANCES): Promise<Measured> {
  mkdirSync(workDir, { recursive: true });
  const instances: Instance[] = [];
  const ours: { id: number; cost: number; ms: number; ok: boolean; strategy: string }[] = [];
  const worlds = new Map<string, World>();
  for (const plate of EXACT_PLATES) worlds.set(plate, await openWorld(plate, plate === '34' ? 31 : 32));
  const next = seeded(777);
  let id = 0;
  while (instances.length < count) {
    const plate = EXACT_PLATES[id % EXACT_PLATES.length] as string;
    const world = worlds.get(plate) as World;
    const size = 13 + Math.floor(next() * 88);
    const stops = stopsOf(Array.from({ length: size }, world.points));
    const hasStart = next() < 0.6;
    const start = hasStart ? world.points() : null;
    const matrix = await world.router.matrix([...(start ? [start] : []), ...stops.map((s) => s.point)]);
    id++;
    if (!matrix.ok || !matrix.stops.every((s) => s.ok) || matrix.durationS.some((row) => row.some((v) => v === null))) continue;
    const pairs = instances.length % 3 === 0 ? 1 + Math.floor(next() * Math.min(10, Math.floor(size / 4))) : 0;
    const precedence: [number, number][] = [];
    const used = new Set<number>();
    for (let k = 0; k < pairs; k++) {
      let a = Math.floor(next() * size);
      let b = Math.floor(next() * size);
      while (used.has(a) || a === b || used.has(b)) {
        a = Math.floor(next() * size);
        b = Math.floor(next() * size);
      }
      used.add(a);
      used.add(b);
      precedence.push([a, b]);
    }
    const pins: { node: number; position: number }[] = [];
    const end = hasStart && next() < 0.3 ? 'return' : 'free';
    const request: PlanRequest = {
      stops,
      ...(start ? { start: { point: start } } : {}),
      end: { kind: end },
      precedence: precedence.map(([a, b]) => ({ before: `d${a}`, after: `d${b}` })),
      pins: pins.map((p) => ({ stopId: `d${p.node}`, position: p.position })),
    };
    const base = start ? 1 : 0;
    const started = performance.now();
    const result = await planStops(request, world.deps);
    const ms = performance.now() - started;
    const cell = (a: number, b: number): number => matrix.durationS[a]?.[b] as number;
    let cost = 0;
    if (result.ok) {
      const index = new Map(stops.map((s, i) => [s.id, i]));
      const order = result.order.map((o) => (index.get(o) as number) + base);
      cost = start ? cell(0, order[0] as number) : 0;
      for (let k = 1; k < order.length; k++) cost += cell(order[k - 1] as number, order[k] as number);
      if (end === 'return' && start) cost += cell(order[order.length - 1] as number, 0);
    }
    instances.push({ id: instances.length, plate, size, hasStart, end, matrix: matrix.durationS as number[][], pins, precedence });
    ours.push({ id: instances.length - 1, cost, ms, ok: result.ok, strategy: result.ok ? result.strategy : result.code });
  }
  writeFileSync(join(workDir, 'instances.json'), JSON.stringify(instances));
  writeFileSync(join(workDir, 'ours.json'), JSON.stringify(ours));
  return { check: 'export', pass: ours.every((o) => o.ok), measured: `${instances.length} örnek yazıldı, çözülemeyen ${ours.filter((o) => !o.ok).length}`, report: '' };
}

function nearestNeighbour(instance: Instance): { best: number; input: number } {
  const base = instance.hasStart ? 1 : 0;
  const m = instance.matrix;
  const walk = (first: number | null): number => {
    const left = new Set(Array.from({ length: instance.size }, (_, i) => i));
    let at = first === null ? 0 : first + base;
    let total = first === null ? 0 : 0;
    if (first !== null) left.delete(first);
    while (left.size > 0) {
      let pick = -1;
      for (const j of left) if (pick === -1 || (m[at] as number[])[j + base]! < (m[at] as number[])[pick + base]!) pick = j;
      total += (m[at] as number[])[pick + base] as number;
      at = pick + base;
      left.delete(pick);
    }
    return total;
  };
  if (instance.hasStart) {
    const input = (() => {
      let t = (m[0] as number[])[1] as number;
      for (let i = 1; i < instance.size; i++) t += (m[i] as number[])[i + 1] as number;
      return t;
    })();
    return { best: walk(null), input };
  }
  let best = Infinity;
  for (let i = 0; i < instance.size; i++) best = Math.min(best, walk(i));
  let input = 0;
  for (let i = 1; i < instance.size; i++) input += (m[i - 1] as number[])[i] as number;
  return { best, input };
}

export function compareReference(): Measured {
  const ours = JSON.parse(readFileSync(join(workDir, 'ours.json'), 'utf8')) as { id: number; cost: number; ms: number; ok: boolean }[];
  const reference = JSON.parse(readFileSync(join(workDir, 'ortools.json'), 'utf8')) as { id: number; cost: number | null }[];
  const instances = JSON.parse(readFileSync(join(workDir, 'instances.json'), 'utf8')) as Instance[];
  const gaps: number[] = [];
  const rows: string[] = [];
  let nnWorse = 0;
  let nnChecked = 0;
  const gains: number[] = [];
  let worstTime50 = 0;
  let worstTime100 = 0;
  for (const mine of ours) {
    const theirs = reference.find((r) => r.id === mine.id);
    const instance = instances[mine.id] as Instance;
    const size = instance.size;
    if (mine.ok && instance.pins.length === 0 && instance.precedence.length === 0 && instance.end === 'free') {
      const nn = nearestNeighbour(instance);
      nnChecked++;
      if (mine.cost > nn.best) nnWorse++;
      gains.push(((nn.input - mine.cost) / nn.input) * 100);
    }
    if (size <= 50) worstTime50 = Math.max(worstTime50, mine.ms);
    else worstTime100 = Math.max(worstTime100, mine.ms);
    if (!mine.ok || !theirs || theirs.cost === null || theirs.cost === 0) continue;
    const gap = ((mine.cost - theirs.cost) / theirs.cost) * 100;
    gaps.push(gap);
    if (gap > 3) rows.push(`- örnek ${mine.id} (${size} durak): bizim ${mine.cost}, OR-Tools ${theirs.cost}, fark %${gap.toFixed(2)}`);
  }
  const mean = gaps.reduce((a, b) => a + b, 0) / Math.max(gaps.length, 1);
  const worst = Math.max(...gaps);
  const better = gaps.filter((g) => g < 0).length;
  const pass = nnWorse === 0 && gaps.length >= 0.95 * REFERENCE_INSTANCES && mean <= REFERENCE_MEAN_MAX && worst <= REFERENCE_WORST_MAX && worstTime50 <= TIME_50_MAX_MS && worstTime100 <= TIME_100_MAX_MS;
  const gain = gains.reduce((a, b) => a + b, 0) / Math.max(gains.length, 1);
  const lines = ['# Sezgisel çözücü: OR-Tools karşılaştırması', '', `En yakın komşu karşılaştırması: kısıtsız ${nnChecked} örnekte bizim sonuç ${nnWorse} örnekte daha kötü (eşik 0); giriş sırasına göre ortalama kazanç %${gain.toFixed(1)}.`, '', `${gaps.length} örnek: ortalama fark %${mean.toFixed(2)} (eşik %${REFERENCE_MEAN_MAX}), en kötü %${worst.toFixed(2)} (eşik %${REFERENCE_WORST_MAX}), bizim çözümün daha iyi olduğu ${better}.`, `Süre: 13-50 durakta en çok ${worstTime50.toFixed(0)} ms (eşik ${TIME_50_MAX_MS}), 51-100 durakta en çok ${worstTime100.toFixed(0)} ms (eşik ${TIME_100_MAX_MS}).`, '', ...(rows.length > 0 ? ['## Farkı %3 üstü olanlar', '', ...rows] : [])];
  return { check: 'reference', pass, measured: `${gaps.length} örnek, en yakın komşudan kötü ${nnWorse}/${nnChecked}, ortalama fark %${mean.toFixed(2)}, en kötü %${worst.toFixed(2)}, süre ${worstTime50.toFixed(0)}/${worstTime100.toFixed(0)} ms`, report: lines.join('\n') + '\n' };
}


export async function measureLegs(count = 120): Promise<Measured> {
  const lines = ['# Bacak sürekliliği ve determinizm', ''];
  let gapMax = 0;
  let legsSeen = 0;
  let plans = 0;
  let breaks = 0;
  let invariantWorst = 0;
  let sameOrder = 0;
  const next = seeded(909);
  for (const plate of EXACT_PLATES) {
    const world = await openWorld(plate, plate === '34' ? 51 : 52);
    for (let k = 0; k < count / EXACT_PLATES.length; k++) {
      const size = 5 + Math.floor(next() * 30);
      const stops = stopsOf(Array.from({ length: size }, world.points));
      const start = world.points();
      const request: PlanRequest = { stops, start: { point: start }, budgetMs: 300 };
      const result = await planStops(request, world.deps);
      if (!result.ok) continue;
      plans++;
      for (let i = 1; i < result.legs.length; i++) {
        const before = (result.legs[i - 1] as { geometry: LngLat[] }).geometry;
        const now = (result.legs[i] as { geometry: LngLat[] }).geometry;
        const a = before[before.length - 1] as LngLat;
        const b = now[0] as LngLat;
        const gap = Math.hypot((a[0] - b[0]) * 111320 * Math.cos((a[1] * Math.PI) / 180), (a[1] - b[1]) * 110540);
        gapMax = Math.max(gapMax, gap);
        if (gap > 1) breaks++;
        legsSeen++;
      }
      const again = await planStops(request, world.deps);
      if (again.ok && JSON.stringify(again.order) === JSON.stringify(result.order)) sameOrder++;
      const reversed = await planStops({ ...request, stops: [...stops].reverse() }, world.deps);
      if (reversed.ok) invariantWorst = Math.max(invariantWorst, Math.abs(reversed.totalDurationS - result.totalDurationS) / Math.max(result.totalDurationS, 1));
    }
  }
  lines.push(`${plans} plan, ${legsSeen} bacak bitişi: en büyük kopukluk ${gapMax.toFixed(2)} m, 1 m üstü ${breaks}.`, `Aynı girdi: ${sameOrder}/${plans} aynı sıra. Giriş sırası ters çevrilince toplam süre farkı en çok %${(invariantWorst * 100).toFixed(2)}.`);
  const pass = plans > 0 && breaks === 0 && sameOrder === plans && invariantWorst <= 0.0001;
  return { check: 'legs', pass, measured: `${plans} plan: bacak kopukluğu en çok ${gapMax.toFixed(2)} m, aynı girdi ${sameOrder}/${plans} aynı, ters girişte süre farkı %${(invariantWorst * 100).toFixed(3)}`, report: lines.join('\n') + '\n' };
}

export async function runCheck(check: string, samples?: number): Promise<Measured | null> {
  if (check === 'exact') return measureExact(samples);
  if (check === 'legs') return measureLegs(samples);
  if (check === 'export') return exportInstances(samples);
  if (check === 'reference') return existsSync(join(workDir, 'ortools.json')) ? compareReference() : null;
  return null;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const at = process.argv.indexOf('--check');
  const check = at >= 0 ? process.argv[at + 1] : undefined;
  const sampleAt = process.argv.indexOf('--samples');
  const samples = sampleAt >= 0 ? Number(process.argv[sampleAt + 1]) : undefined;
  (check ? runCheck(check, samples) : Promise.resolve(null)).then((result) => {
    if (!result) {
      console.error('kullanım: --check exact|legs|export|reference');
      process.exit(2);
    }
    console.log(JSON.stringify({ check: result.check, pass: result.pass, measured: result.measured }));
    const dir = join(homedir(), 'Desktop', 'yuksi-geo-raporlar');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `faz-7-plan-${result.check}.md`), result.report ?? '');
    process.exit(result.pass ? 0 : 1);
  });
}
