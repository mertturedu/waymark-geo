import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createSearch } from '../src/core/address/search';
import type { Place } from '../src/core/address/types';
import { distanceM } from '../src/core/geo/distance';
import { layerKeyOf } from '../src/core/learn/key';
import { createLearning } from '../src/core/learn/learning';
import { memoryStore } from '../src/core/learn/store';
import type { PackStore } from '../src/core/ports';
import { createBorders, type Borders } from '../src/core/region/borders';
import { parseManifest } from '../src/core/region/manifest';
import { createNodePackStore } from '../src/node/pack-store';
import { chooseHidden, hidePack, readDoors, type DoorRow } from '../test/sim/hide';
import { summarize, type Stats } from '../test/sim/metrics';
import { deliveryNoise, forcedOutlier } from '../test/sim/noise';
import { rng, shuffle } from '../test/sim/random';
import { confirmTarget, probe, simStore, targetsOf, type SimTarget } from '../test/sim/replay';

export type Measured = { check: string; pass: boolean; measured: string; report: string };
export type Neighbours = 'trusted' | 'all';
export type Source = { plate: string; file: string; base: PackStore; borders: Borders };
export type Env = { plate: string; hiddenFile: string; store: PackStore; borders: Borders; targets: SimTarget[]; hiddenCount: number };
export type SparseEnv = Env & { learn: SimTarget[] };
export type RunResult = { before: number[]; after: number[]; misses: number; learned: number };

export const PLATES = ['10', '34', '06', '59', '58'];
export const HIDE_SHARE = 0.2;
export const TARGET_LIMIT = 1000;
export const SEED = 2026;
export const LIMITS = { first: 16, third: { median: 10, p90: 22 }, fifth: 8, pin: 6, outlierDiffM: 3, outlierShare: 0.99, sparseMedian: 25, sparseGain: 0.5 };
const NOW = 1_700_000_000;
const SPARSE_KEEP = 0.01;
const SPARSE_MIN_STREET = 10;
const SPARSE_LEARN_SHARE = 0.3;

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const seedOf = (plate: string, salt: number): number => SEED + Number(plate) * 1000 + salt;

export function deliveryVerdict(n: 1 | 3 | 5, stats: Stats): boolean {
  if (stats.n === 0) return false;
  if (n === 1) return stats.median <= LIMITS.first;
  if (n === 3) return stats.median <= LIMITS.third.median && stats.p90 <= LIMITS.third.p90;
  return stats.median <= LIMITS.fifth;
}

export const pinVerdict = (stats: Stats): boolean => stats.n > 0 && stats.median <= LIMITS.pin;

export function outlierVerdict(diffs: readonly number[]): { pass: boolean; share: number } {
  if (diffs.length === 0) return { pass: false, share: 0 };
  const share = diffs.filter((d) => d <= LIMITS.outlierDiffM).length / diffs.length;
  return { pass: share >= LIMITS.outlierShare, share };
}

export function sparseVerdict(after: Stats, before: Stats): { pass: boolean; gain: number } {
  if (after.n === 0 || before.n === 0 || before.median === 0) return { pass: false, gain: 0 };
  const gain = 1 - after.median / before.median;
  return { pass: after.median <= LIMITS.sparseMedian && gain >= LIMITS.sparseGain, gain };
}

export async function prepareEnv(source: Source, work: string, options: { share?: number; limit?: number; salt?: number } = {}): Promise<Env> {
  const doors = readDoors(source.file);
  const hidden = chooseHidden(doors, options.share ?? HIDE_SHARE, rng(seedOf(source.plate, options.salt ?? 1)));
  const hiddenFile = join(work, `${source.plate}-hidden.sqlite`);
  hidePack(source.file, hiddenFile, hidden);
  const targets = targetsOf(hiddenFile, source.plate, doors.filter((d) => hidden.has(d.id)), options.limit ?? TARGET_LIMIT, rng(seedOf(source.plate, 2)));
  return { plate: source.plate, hiddenFile, store: simStore(source.base, source.plate, hiddenFile), borders: source.borders, targets, hiddenCount: hidden.size };
}

async function learnerFor(env: Env, neighbours: Neighbours) {
  const learning = await createLearning({ store: memoryStore(), now: () => NOW, neighbours });
  return { learning, search: createSearch({ store: env.store, borders: env.borders, layers: [learning.layer] }) };
}

async function found(search: Awaited<ReturnType<typeof learnerFor>>['search'], targets: SimTarget[]): Promise<{ target: SimTarget; place: Place; errorM: number }[]> {
  const out: { target: SimTarget; place: Place; errorM: number }[] = [];
  for (const target of targets) {
    const p = await probe(search, target);
    if (p) out.push({ target, place: p.place, errorM: p.errorM });
  }
  return out;
}

export async function confirmRun(env: Env, kind: 'delivery' | 'pin', confirmations: number, neighbours: Neighbours = 'all'): Promise<RunResult> {
  const { learning, search } = await learnerFor(env, neighbours);
  const first = await found(search, env.targets);
  const rand = rng(seedOf(env.plate, 3));
  for (const f of first) await confirmTarget(learning, f.place, f.target, kind, rand, confirmations);
  const before: number[] = [];
  const after: number[] = [];
  let learned = 0;
  for (const f of first) {
    const p = await probe(search, f.target);
    if (!p) continue;
    before.push(f.errorM);
    after.push(p.errorM);
    if (p.place.source === 'learned') learned++;
  }
  return { before, after, misses: env.targets.length - after.length, learned };
}

export async function outlierRun(env: Env): Promise<number[]> {
  const plain = createSearch({ store: env.store, borders: env.borders });
  const rand = rng(seedOf(env.plate, 4));
  const diffs: number[] = [];
  for (const f of await found(plain, env.targets)) {
    const key = layerKeyOf(f.place.region, { ...f.place.components, houseNumber: f.target.door.number });
    if (!key) continue;
    const clean = await createLearning({ store: memoryStore(), now: () => NOW });
    const dirty = await createLearning({ store: memoryStore(), now: () => NOW });
    for (const noisy of [deliveryNoise(rand, f.target.truth, { outliers: false }), deliveryNoise(rand, f.target.truth, { outliers: false })]) {
      for (const who of [clean, dirty]) await who.confirm({ place: f.place, houseNumber: f.target.door.number, point: noisy.point, source: 'delivery', accuracyM: noisy.accuracyM });
    }
    const far = forcedOutlier(rand, f.target.truth, 300);
    await dirty.confirm({ place: f.place, houseNumber: f.target.door.number, point: far.point, source: 'delivery', accuracyM: far.accuracyM });
    const a = await clean.layer.lookup(key);
    const b = await dirty.layer.lookup(key);
    if (a && b) diffs.push(distanceM(a.coordinate, b.coordinate));
  }
  return diffs;
}

export async function prepareSparse(source: Source, work: string, options: { limit?: number } = {}): Promise<SparseEnv> {
  const doors = readDoors(source.file);
  const groups = new Map<string, DoorRow[]>();
  for (const d of doors) {
    if (d.num === null) continue;
    const key = `${d.streetId}:${d.districtId}:${d.hoodId ?? 0}`;
    groups.set(key, [...(groups.get(key) ?? []), d]);
  }
  const rand = rng(seedOf(source.plate, 5));
  const learnDoors: DoorRow[] = [];
  const evalDoors: DoorRow[] = [];
  const limit = options.limit ?? TARGET_LIMIT;
  const eligible = [...groups.keys()].sort().filter((k) => (groups.get(k) as DoorRow[]).length >= SPARSE_MIN_STREET);
  for (const key of shuffle(eligible, rand)) {
    if (evalDoors.length >= limit) break;
    const group = shuffle(groups.get(key) as DoorRow[], rand);
    const cut = Math.max(2, Math.round(group.length * SPARSE_LEARN_SHARE));
    const learned = group.slice(0, cut);
    const between = group.slice(cut).filter((d) => learned.some((l) => (l.num as number) < (d.num as number) && l.parity === d.parity) && learned.some((l) => (l.num as number) > (d.num as number) && l.parity === d.parity));
    if (between.length === 0) continue;
    learnDoors.push(...learned);
    evalDoors.push(...between);
  }
  const hidden = chooseHidden(doors, 1 - SPARSE_KEEP, rand);
  for (const d of [...learnDoors, ...evalDoors]) hidden.add(d.id);
  const hiddenFile = join(work, `${source.plate}-sparse.sqlite`);
  hidePack(source.file, hiddenFile, hidden);
  const all = targetsOf(hiddenFile, source.plate, [...learnDoors, ...evalDoors], Infinity, rng(seedOf(source.plate, 6)));
  const evalIds = new Set(evalDoors.map((d) => d.id));
  return {
    plate: source.plate,
    hiddenFile,
    store: simStore(source.base, source.plate, hiddenFile),
    borders: source.borders,
    targets: all.filter((t) => evalIds.has(t.door.id)),
    learn: all.filter((t) => !evalIds.has(t.door.id)),
    hiddenCount: hidden.size,
  };
}

export async function sparseRun(env: SparseEnv, neighbours: Neighbours): Promise<RunResult> {
  const { learning, search } = await learnerFor(env, neighbours);
  const first = await found(search, env.targets);
  const rand = rng(seedOf(env.plate, 7));
  let learnedNumbers = 0;
  for (const f of await found(search, env.learn)) learnedNumbers += (await confirmTarget(learning, f.place, f.target, 'delivery', rand, 3)) > 0 ? 1 : 0;
  const before: number[] = [];
  const after: number[] = [];
  for (const f of first) {
    const p = await probe(search, f.target);
    if (!p) continue;
    before.push(f.errorM);
    after.push(p.errorM);
  }
  return { before, after, misses: env.targets.length - after.length, learned: learnedNumbers };
}

export function pooled(runs: RunResult[], pick: 'before' | 'after'): Stats {
  return summarize(runs.flatMap((r) => r[pick]));
}

const cell = (s: Stats): string => `${s.n} | ${s.median} | ${s.p90}`;

export function tableOf(plates: string[], runs: RunResult[]): string {
  const rows = runs.map((r, i) => `| ${plates[i]} | ${cell(summarize(r.before))} | ${cell(summarize(r.after))} | ${r.misses} | ${r.learned} |`);
  const all = `| toplam | ${cell(pooled(runs, 'before'))} | ${cell(pooled(runs, 'after'))} | ${runs.reduce((s, r) => s + r.misses, 0)} | ${runs.reduce((s, r) => s + r.learned, 0)} |`;
  return ['| İl | Önce adet | Önce ortanca m | Önce p90 m | Sonra adet | Sonra ortanca m | Sonra p90 m | Bulunamayan | Öğrenilmiş sonuç |', '|---|---|---|---|---|---|---|---|---|', ...rows, all].join('\n');
}

async function sources(packsDir: string, plates: string[]): Promise<Source[]> {
  const manifest = parseManifest(readFileSync(join(packsDir, 'manifest-v1.json'), 'utf8'));
  const base = await createNodePackStore(packsDir);
  const borders = createBorders(readFileSync(join(repoRoot, 'src', 'core', 'region', 'data', 'borders.bin')));
  return plates.map((plate) => {
    const path = manifest.regions.find((r) => r.id === plate)?.files.find((f) => f.kind === 'address')?.path;
    if (!path) throw new Error(`${plate} için adres paketi yok`);
    return { plate, file: join(packsDir, path), base, borders };
  });
}

export type CheckOptions = { packsDir?: string; plates?: string[]; neighbours?: Neighbours };

export async function runCheck(check: string, options: CheckOptions = {}): Promise<Measured | null> {
  const plates = options.plates ?? PLATES;
  const neighbours = options.neighbours ?? 'all';
  const work = mkdtempSync(join(tmpdir(), 'geo-learn-'));
  try {
    const confirm = /^delivery([135])$/.exec(check);
    if (confirm || check === 'pin') {
      const n = confirm ? (Number(confirm[1]) as 1 | 3 | 5) : 1;
      const kind = confirm ? 'delivery' : 'pin';
      const runs: RunResult[] = [];
      for (const s of await sources(options.packsDir ?? join(repoRoot, 'dist', 'packs'), plates)) runs.push(await confirmRun(await prepareEnv(s, work), kind, n, neighbours));
      const after = pooled(runs, 'after');
      const pass = confirm ? deliveryVerdict(n, after) : pinVerdict(after);
      const limit = confirm ? (n === 1 ? `ortanca en çok ${LIMITS.first}` : n === 3 ? `ortanca en çok ${LIMITS.third.median}, p90 en çok ${LIMITS.third.p90}` : `ortanca en çok ${LIMITS.fifth}`) : `ortanca en çok ${LIMITS.pin}`;
      const what = confirm ? `${n} teslimat onayı` : '1 pin onayı';
      return { check, pass, measured: `${what} sonrası ortanca ${after.median} m, p90 ${after.p90} m (${after.n} adres, ${runs.reduce((s, r) => s + r.misses, 0)} bulunamayan)`, report: `# ${what}\n\nEşik: ${limit}. Önce, öğrenmeden önceki tahmin hatası.\n\n${tableOf(plates, runs)}\n` };
    }
    if (check === 'outlier') {
      const diffs: number[] = [];
      for (const s of await sources(options.packsDir ?? join(repoRoot, 'dist', 'packs'), plates)) diffs.push(...(await outlierRun(await prepareEnv(s, work))));
      const verdict = outlierVerdict(diffs);
      const summary = summarize(diffs);
      return { check, pass: verdict.pass, measured: `${diffs.length} vakada fark en çok ${LIMITS.outlierDiffM} m olan pay yüzde ${(verdict.share * 100).toFixed(2)} (ortanca ${summary.median} m, p90 ${summary.p90} m)`, report: `# Aykırı değer dayanıklılığı\n\nİki temiz teslimat onayı ve bir 300 m aykırı onay, yalnızca iki temiz onayla karşılaştırıldı. Eşik: vakaların en az yüzde 99'unda fark en çok ${LIMITS.outlierDiffM} m.\n\n${diffs.length} vaka, en çok ${LIMITS.outlierDiffM} m olan pay yüzde ${(verdict.share * 100).toFixed(2)}, ortanca ${summary.median} m, p90 ${summary.p90} m, ortalama ${summary.mean} m.\n` };
    }
    if (check === 'sparse') {
      const runs: RunResult[] = [];
      for (const s of await sources(options.packsDir ?? join(repoRoot, 'dist', 'packs'), plates)) runs.push(await sparseRun(await prepareSparse(s, work), neighbours));
      const after = pooled(runs, 'after');
      const before = pooled(runs, 'before');
      const verdict = sparseVerdict(after, before);
      return { check, pass: verdict.pass, measured: `seyrek il: öğrenmeden önce ortanca ${before.median} m, sonra ${after.median} m (iyileşme yüzde ${(verdict.gain * 100).toFixed(1)}, ${after.n} adres, komşu: ${neighbours})`, report: `# Seyrek il simülasyonu\n\nAdreslerin yüzde 99'u silindi, sokaktaki numaraların yüzde 30'u üç teslimat onayıyla öğrenildi, iki yanında öğrenilmiş komşusu olan öteki numaralar ölçüldü. Eşik: ortanca en çok ${LIMITS.sparseMedian} m ve sokak düzeyi yedeğe göre en az yüzde ${LIMITS.sparseGain * 100} iyileşme. Komşu noktalar: ${neighbours}.\n\n${tableOf(plates, runs)}\n` };
    }
    return null;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const arg = (name: string): string | undefined => {
    const at = process.argv.indexOf(name);
    return at >= 0 ? process.argv[at + 1] : undefined;
  };
  const check = arg('--check');
  const neighbours = arg('--neighbours') === 'trusted' ? 'trusted' : 'all';
  (check ? runCheck(check, { neighbours }) : Promise.resolve(null)).then((result) => {
    if (!result) {
      console.error('kullanım: --check delivery1|delivery3|delivery5|pin|outlier|sparse [--neighbours trusted|all]');
      process.exit(2);
    }
    const dir = join(homedir(), 'Desktop', 'yuksi-geo-raporlar');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `faz-4-dogruluk-${result.check}.md`), result.report);
    console.log(JSON.stringify({ check: result.check, pass: result.pass, measured: result.measured }));
    process.exit(result.pass ? 0 : 1);
  });
}
