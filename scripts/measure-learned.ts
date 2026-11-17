import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildLearned } from '../pipeline/build/learned';
import { encodePatch, zstdPatchTool } from '../pipeline/build/patches';
import { zstdCompress } from '../pipeline/build/manifest';
import type { DeliveryRecord } from '../pipeline/real/records';
import { auditLearned } from '../pipeline/validate/learned-audit';
import { createSearch } from '../src/core/address/search';
import { estimateFloor } from '../src/core/address/floor';
import { unitsPerFloor } from '../src/core/address/unit';
import type { LngLat } from '../src/core/geo/cells';
import { distanceM } from '../src/core/geo/distance';
import { composeKey, layerKeyOf } from '../src/core/learn/key';
import { createLearnedLayer } from '../src/core/learned/layer';
import { floorFromLayout } from '../src/core/learned/layout';
import { openLearned } from '../src/core/learned/pack';
import type { PackStore } from '../src/core/ports';
import { openSqlite } from '../src/node/sqlite';
import { summarize } from '../test/sim/metrics';
import { deliveriesFor, pickCount, SIM_WEEK, type Spot } from '../test/sim/central';
import { forcedOutlier, moveBy, pinNoise } from '../test/sim/noise';
import { deliveryStop } from '../src/core/learned/stops';
import { walkFor, type Tap } from '../test/sim/walks';
import { rng, shuffle } from '../test/sim/random';
import { probe, type SimTarget } from '../test/sim/replay';
import { PLATES, prepareEnv, sources, type Env, type Measured } from './measure-learning';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
export const CHECKS = ['merge', 'conflict', 'floors', 'privacy', 'patch', 'names', 'stops'];
export const LIMITS = { stopGain: 0.3, mergedMedian: 15, mergedP90: 40, floorGain: 0.15, patchShare: 0.2, nameHit: 0.9, nameMetres: 60 };
const SEED = 4242;
const TARGETS = 600;
const BUILDINGS = 2000;
const PATCH_KEYS = 60_000;
const PATCH_GROWTH = Number(process.env.PATCH_GROWTH ?? 0.05);

const percent = (share: number): string => `%${(share * 100).toFixed(1)}`;
const keyOf = (spot: Spot): string => composeKey(layerKeyOf(spot.plate, { district: spot.district, neighbourhood: spot.neighbourhood ?? undefined, street: spot.street, houseNumber: spot.houseNumber }) as never);
const spotOf = (t: SimTarget, plate: string, truth: LngLat = t.truth): Spot => ({ plate, district: t.district, neighbourhood: t.neighbourhood, street: t.street, houseNumber: t.door.number, truth });

function storeWith(env: Env, learnedFile: string | null): { store: PackStore; close: () => Promise<void> } {
  const learned = learnedFile ? openSqlite(learnedFile) : null;
  const store: PackStore = {
    installed: async () => [env.plate],
    open: (region) => env.store.open(region),
    openPart: async (region, kind) => (kind === 'learned' ? learned : env.store.openPart ? env.store.openPart(region, kind) : null),
  };
  return { store, close: async () => {
      await learned?.close();
    },
  };
}

async function mergeRun(env: Env, work: string, plate: string) {
  const rand = rng(SEED + Number(plate));
  const records: DeliveryRecord[] = [];
  const spots = new Map<string, Spot>();
  const counts = new Map<string, number>();
  for (const t of shuffle(env.targets, rand).slice(0, TARGETS)) {
    const spot = spotOf(t, plate);
    const made = deliveriesFor(spot, rand, pickCount(rand));
    if (made.length === 0) continue;
    records.push(...made);
    spots.set(keyOf(spot), spot);
    counts.set(keyOf(spot), made.length);
  }
  const file = join(work, `${plate}-learned.sqlite`);
  const stats = await buildLearned({ plate, records, nowWeek: SIM_WEEK, outFile: file });
  const db = openSqlite(file);
  const pack = await openLearned(db);
  const merged: number[] = [];
  const trusted: number[] = [];
  const single: number[] = [];
  const multi: number[] = [];
  for (const [key, spot] of spots) {
    const parts = layerKeyOf(plate, { district: spot.district, neighbourhood: spot.neighbourhood ?? undefined, street: spot.street, houseNumber: spot.houseNumber });
    const hit = parts ? await pack?.lookup(parts) : null;
    if (!hit) continue;
    const error = distanceM(hit.coordinate, spot.truth);
    merged.push(error);
    if (hit.trusted) trusted.push(error);
    (counts.get(key) === 1 ? single : multi).push(error);
  }
  await db.close();
  const before = createSearch({ store: env.store, borders: env.borders });
  const wired = storeWith(env, file);
  const after = createSearch({ store: wired.store, borders: env.borders, layers: [createLearnedLayer(wired.store)] });
  const sdkBefore: number[] = [];
  const sdkAfter: number[] = [];
  let learned = 0;
  const targets = env.targets.filter((t) => spots.has(keyOf(spotOf(t, plate))));
  for (const t of targets) {
    const a = await probe(before, t);
    const b = await probe(after, t);
    if (a) sdkBefore.push(a.errorM);
    if (b) {
      sdkAfter.push(b.errorM);
      if (b.place.source === 'learned') learned++;
    }
  }
  await wired.close();
  return { stats, merged, trusted, single, multi, sdkBefore, sdkAfter, learned, keys: spots.size };
}

async function checkMerge(packsDir: string, plates: string[], work: string): Promise<Measured> {
  const rows: string[] = [];
  const all = { merged: [] as number[], trusted: [] as number[], single: [] as number[], multi: [] as number[], before: [] as number[], after: [] as number[] };
  for (const source of await sources(packsDir, plates)) {
    const env = await prepareEnv(source, work, { limit: TARGETS * 2 });
    const run = await mergeRun(env, work, source.plate);
    all.merged.push(...run.merged);
    all.trusted.push(...run.trusted);
    all.single.push(...run.single);
    all.multi.push(...run.multi);
    all.before.push(...run.sdkBefore);
    all.after.push(...run.sdkAfter);
    const m = summarize(run.merged);
    rows.push(`| ${source.plate} | ${run.keys} | ${run.stats.records} | ${percent(run.stats.trusted / Math.max(1, run.stats.keys))} | ${m.median} | ${m.p90} | ${summarize(run.sdkBefore).median} | ${summarize(run.sdkAfter).median} |`);
  }
  const merged = summarize(all.merged);
  const trusted = summarize(all.trusted);
  const sdkBefore = summarize(all.before);
  const sdkAfter = summarize(all.after);
  const pass = merged.n > 0 && merged.median <= LIMITS.mergedMedian && merged.p90 <= LIMITS.mergedP90;
  const within = (values: number[]): string => percent(values.filter((e) => e <= 30).length / Math.max(1, values.length));
  const measured = `birleşik nokta ortanca ${merged.median} m, p90 ${merged.p90} m (${merged.n} kapı); güvenilir ${percent(trusted.n / Math.max(1, merged.n))} ortanca ${trusted.median} m; tek kayıtlı ${summarize(all.single).median} m, çok kayıtlı ${summarize(all.multi).median} m; SDK sonucu ${sdkBefore.median} → ${sdkAfter.median} m, ≤ 30 m isabet ${within(all.before)} → ${within(all.after)} (${sdkAfter.n} adres)`;
  const report = ['# Merkezi öğrenme: birleşik nokta (benzetim)', '', `Gizlenmiş kapılara kurye ve müşteri iğnesi gürültüsüyle ${TARGETS} adrese kadar teslim kaydı; kayıt sayısı 1-8, %5 uzak GPS, %8 yanlış iğne, ${60} kurye (sık yinelenen).`, '', '| İl | Kapı | Kayıt | Güvenilir | Birleşik ortanca m | p90 m | SDK önce m | SDK sonra m |', '|---|---|---|---|---|---|---|---|', ...rows, '', measured, ''].join('\n');
  return { check: 'merge', pass, measured, report };
}

async function checkConflict(packsDir: string, plates: string[], work: string): Promise<Measured> {
  const rand = rng(SEED + 7);
  const result = { two: { before: [] as number[], after: [] as number[] }, three: { before: [] as number[], after: [] as number[] } };
  for (const source of await sources(packsDir, plates.slice(0, 3))) {
    const base = await prepareEnv(source, work, { limit: 400 });
    for (const sources of [2, 3] as const) {
      const spots: Spot[] = [];
      const osm = new Map<string, LngLat>();
      const records: DeliveryRecord[] = [];
      for (const t of shuffle(base.targets, rand).slice(0, 150)) {
        const truth = moveBy(t.truth, 60, 0);
        const spot = spotOf(t, source.plate, truth);
        spots.push(spot);
        osm.set(keyOf(spot), t.truth);
        for (let i = 0; i < sources; i++) records.push(...deliveriesFor(spot, rand, 1, `x${i}-`).map((r, j) => ({ ...r, src: `s${i}-${j}-${keyOf(spot)}` })));
      }
      const file = join(work, `${source.plate}-conflict${sources}.sqlite`);
      await buildLearned({ plate: source.plate, records, nowWeek: SIM_WEEK, outFile: file, osmPoint: (probeComponents) => osm.get(composeKey(layerKeyOf(source.plate, probeComponents) as never)) ?? null });
      const db = openSqlite(file);
      const pack = await openLearned(db);
      for (const spot of spots) {
        const parts = layerKeyOf(source.plate, { district: spot.district, neighbourhood: spot.neighbourhood ?? undefined, street: spot.street, houseNumber: spot.houseNumber });
        const hit = parts ? await pack?.lookup(parts) : null;
        const bucket = sources === 2 ? result.two : result.three;
        bucket.before.push(distanceM(osm.get(keyOf(spot)) as LngLat, spot.truth));
        if (hit?.trusted) bucket.after.push(distanceM(hit.coordinate, spot.truth));
        else bucket.after.push(distanceM(osm.get(keyOf(spot)) as LngLat, spot.truth));
      }
      await db.close();
    }
  }
  const two = summarize(result.two.after);
  const three = summarize(result.three.after);
  const pass = two.median >= 55 && three.median <= LIMITS.mergedMedian;
  const measured = `OSM 60 m yanlış: 2 kaynakta sonuç ortanca ${two.median} m (OSM kalır), 3 kaynakta ${three.median} m (öğrenilmiş kazanır)`;
  return { check: 'conflict', pass, measured, report: `# OSM çatışması (benzetim)\n\nOSM kapısı gerçek noktadan 60 m uzakta.\n\n${measured}\n` };
}

type Building = { floors: number; per: number; basement: number; area: number };

export async function floorsCheck(): Promise<Measured> {
  const rand = rng(SEED + 11);
  const work = mkdtempSync(join(tmpdir(), 'geo-floors-'));
  try {
    const records: DeliveryRecord[] = [];
    const held: { b: number; door: number; truth: number; building: Building }[] = [];
    for (let b = 0; b < BUILDINGS; b++) {
      const per = 2 + Math.floor(rand() * 5);
      const building: Building = { floors: 3 + Math.floor(rand() * 10), per, basement: rand() < 0.3 ? 1 : 0, area: per * 120 * (0.7 + 0.6 * rand()) };
      const doors = (building.floors + building.basement) * per;
      const floorOf = (door: number): number => Math.ceil(door / per) - 1 - building.basement;
      const all = shuffle(Array.from({ length: doors }, (_, i) => i + 1), rand);
      const learn = all.slice(0, Math.min(doors - 1, 4 + Math.floor(rand() * 10)));
      for (const door of learn) {
        const wrong = rand() < 0.1;
        const floor = wrong ? floorOf(door) + (rand() < 0.5 ? -1 : 1) * (1 + Math.floor(rand() * 2)) : floorOf(door);
        records.push({ v: 1, src: `c${Math.floor(rand() * 30)}`, week: SIM_WEEK, region: '34', district: 'Kadıköy', neighbourhood: 'Moda', street: `Sokak ${b}`, houseNumber: '1', floor: String(floor), door: String(door), coordSource: 'gps', gps: { lng: 29, lat: 41, accuracyM: 8 } });
      }
      const target = all[learn.length];
      if (target !== undefined) held.push({ b, door: target, truth: floorOf(target), building });
    }
    const file = join(work, 'floors.sqlite');
    const stats = await buildLearned({ plate: '34', records, nowWeek: SIM_WEEK, outFile: file });
    const db = openSqlite(file);
    const pack = await openLearned(db);
    let learned = 0;
    let model = 0;
    let withLayout = 0;
    let learnedOnLayout = 0;
    let modelOnLayout = 0;
    for (const h of held) {
      const parts = layerKeyOf('34', { district: 'Kadıköy', neighbourhood: 'Moda', street: `Sokak ${h.b}`, houseNumber: '1' });
      const layout = parts ? await pack?.layout(composeKey(parts)) : null;
      const base = estimateFloor(h.door, unitsPerFloor(h.building.area), 0).value;
      const hit = layout ? (floorFromLayout(layout, h.door)?.value ?? base) : base;
      if (hit === h.truth) learned++;
      if (base === h.truth) model++;
      if (layout) {
        withLayout++;
        if (hit === h.truth) learnedOnLayout++;
        if (base === h.truth) modelOnLayout++;
      }
    }
    await db.close();
    const gain = (learned - model) / held.length;
    const measured = `kat tam isabet: tahmin modeli ${percent(model / held.length)} → öğrenilmiş düzenle ${percent(learned / held.length)} (+${(gain * 100).toFixed(1)} puan, ${held.length} bina; düzeni öğrenilen ${withLayout}: ${percent(modelOnLayout / Math.max(1, withLayout))} → ${percent(learnedOnLayout / Math.max(1, withLayout))})`;
    return { check: 'floors', pass: gain >= LIMITS.floorGain, measured, report: `# Kat düzeni öğrenme (benzetim)\n\n${BUILDINGS} sentetik bina (3-12 kat, kat başına 2-6 daire, %30 bodrumlu, taban alanı gerçek daire sayısından %30 sapar); her bina için 4-13 kat/daire beyanı, %10 yanlış kat; sınanan daire öğrenmede yok. Düzen ${stats.layouts} binada öğrenildi.\n\n${measured}\n` };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

async function checkPrivacy(packsDir: string, plates: string[], work: string): Promise<Measured> {
  const rand = rng(SEED + 13);
  const source = (await sources(packsDir, plates.slice(0, 1)))[0];
  if (!source) return { check: 'privacy', pass: false, measured: 'il yok', report: '' };
  const env = await prepareEnv(source, work, { limit: 300 });
  const records: DeliveryRecord[] = [];
  for (const [i, t] of env.targets.entries()) {
    const spot = spotOf(t, source.plate);
    deliveriesFor(spot, rand, 3).forEach((r, j) => {
      const entrance = moveBy(t.truth, 2 + j, 0);
      records.push({ ...r, src: `KURYE-GIZLI-${(i * 3 + j) % 40}`, floor: String(j), door: String(1 + j * 4 + (i % 3)), entrance: { lng: entrance[0], lat: entrance[1] } });
    });
  }
  const file = join(work, 'privacy.sqlite');
  const stats = await buildLearned({ plate: source.plate, records, nowWeek: SIM_WEEK, outFile: file, streetKnown: () => false });
  const audit = auditLearned(file, source.plate);
  const bytes = readFileSync(file);
  const leaked = ['KURYE-GIZLI'].filter((needle) => bytes.includes(Buffer.from(needle)));
  const pass = audit.errors.length === 0 && leaked.length === 0 && stats.layouts > 0 && stats.entrances > 0 && stats.hints > 0;
  const measured = `${stats.keys} kapı, ${stats.layouts} bina düzeni, ${stats.entrances} giriş, ${stats.hints} ad ipucu: şema ve metin denetimi ${audit.errors.length} bulgu, kaynak kimliği sızıntısı ${leaked.length}`;
  return { check: 'privacy', pass, measured, report: `# Kişi ve zaman denetimi\n\n${measured}\n\n${audit.errors.map((e) => `- ${e}`).join('\n')}\n` };
}

async function checkNames(packsDir: string, plates: string[], work: string): Promise<Measured> {
  const rand = rng(SEED + 17);
  let made = 0;
  let hit = 0;
  const errors: number[] = [];
  for (const source of await sources(packsDir, plates.slice(0, 3))) {
    const env = await prepareEnv(source, work, { limit: 300 });
    const groups = shuffle(env.targets, rand).slice(0, 60);
    const records: DeliveryRecord[] = [];
    const expected = new Map<string, LngLat>();
    groups.forEach((t, i) => {
      const name = `Yeni Mahalle Çıkmaz ${i + 1} Sokak`;
      const spot = { ...spotOf(t, source.plate), street: name };
      expected.set(`${t.district.toLocaleLowerCase('tr')}|${name}`, t.truth);
      for (let n = 0; n < 4; n++) records.push(...deliveriesFor({ ...spot, houseNumber: String(n + 1) }, rand, 1));
    });
    const file = join(work, `${source.plate}-names.sqlite`);
    await buildLearned({ plate: source.plate, records, nowWeek: SIM_WEEK, outFile: file, streetKnown: () => false });
    const db = openSqlite(file);
    const rows = await db.all<{ district: string; name: string; lng: number; lat: number }>('SELECT district, name, lng, lat FROM hint');
    for (const row of rows) {
      const truth = [...expected].find(([k]) => k.endsWith(`|${row.name}`))?.[1];
      if (!truth) continue;
      made++;
      const error = distanceM([row.lng / 1e6, row.lat / 1e6], truth);
      errors.push(error);
      if (error <= LIMITS.nameMetres) hit++;
    }
    await db.close();
  }
  const summary = summarize(errors);
  const share = made === 0 ? 0 : hit / made;
  const measured = `4 kayıtlık bilinmeyen sokak adı: ${made} ipucu üretildi, ${percent(share)} ${LIMITS.nameMetres} m içinde (ortanca ${summary.median} m)`;
  return { check: 'names', pass: made > 0 && share >= LIMITS.nameHit, measured, report: `# Ad öğrenme (benzetim)\n\n${measured}\n` };
}

function syntheticKeys(rand: ReturnType<typeof rng>, count: number): { street: number; number: number; lng: number; lat: number }[] {
  return Array.from({ length: count }, (_, i) => ({ street: Math.floor(i / 25) % 3000, number: 1 + (i % 25), lng: 28.6 + rand() * 0.9, lat: 40.8 + rand() * 0.4 }));
}

async function checkPatch(work: string): Promise<Measured> {
  const rand = rng(SEED + 19);
  const keys = syntheticKeys(rand, PATCH_KEYS);
  const make = (spec: { street: number; number: number; lng: number; lat: number }, src: string, jitter: number): DeliveryRecord => ({ v: 1, src, week: SIM_WEEK, region: '34', district: 'Kadıköy', neighbourhood: `Mahalle ${Math.floor(spec.street / 20)}`, street: `Sokak ${spec.street}`, houseNumber: String(spec.number), coordSource: 'gps', gps: { lng: spec.lng + jitter, lat: spec.lat, accuracyM: 8 } });
  const week0: DeliveryRecord[] = [];
  for (const k of keys) for (let i = 0; i < 2; i++) week0.push(make(k, `a${i}${Math.floor(rand() * 50)}`, (rand() - 0.5) * 1e-4));
  const grown: DeliveryRecord[] = [...week0];
  const added = Math.round(week0.length * PATCH_GROWTH);
  const fresh = syntheticKeys(rand, 3000 + added).map((k) => ({ ...k, street: k.street + 3000 }));
  for (let i = 0; i < added; i++) {
    if (i % 2 === 0) grown.push(make(keys[Math.floor(rand() * keys.length)] as never, `n${i % 77}`, (rand() - 0.5) * 1e-4));
    else grown.push(make(fresh[i] as never, `n${i % 77}`, 0));
  }
  const older = join(work, 'week0.sqlite');
  const newer = join(work, 'week1.sqlite');
  await buildLearned({ plate: '34', records: week0, nowWeek: SIM_WEEK, outFile: older });
  await buildLearned({ plate: '34', records: grown, nowWeek: SIM_WEEK, outFile: newer });
  const packed = join(work, 'week1.sqlite.zst');
  zstdCompress(newer, packed);
  const patch = await encodePatch(readFileSync(older), readFileSync(newer), zstdPatchTool, mkdtempSync(join(work, 'p-')));
  const full = statSync(packed).size;
  const share = (patch?.length ?? Infinity) / full;
  const measured = `${PATCH_KEYS} anahtar, haftada %${PATCH_GROWTH * 100} yeni kayıt: tam parça ${(full / 1e6).toFixed(2)} MB (ham ${(statSync(newer).size / 1e6).toFixed(2)} MB), yama ${((patch?.length ?? 0) / 1e6).toFixed(2)} MB = ${percent(share)}`;
  return { check: 'patch', pass: share <= LIMITS.patchShare, measured, report: `# Haftalık yama (benzetim)\n\n${measured}\n` };
}

const WALKS = 1500;
const TAP_MIX: [Tap, number][] = [['door', 0.4], ['after', 0.4], ['car', 0.2]];
const PIN_AGREE_M = 50;

function tapOf(rand: ReturnType<typeof rng>, only?: Tap): Tap {
  if (only) return only;
  let pick = rand();
  for (const [tap, share] of TAP_MIX) {
    if (pick < share) return tap;
    pick -= share;
  }
  return 'door';
}

type WalkRun = { gps: number[]; stop: number[]; found: number; total: number };

function walkRun(seed: number, only?: Tap): WalkRun {
  const rand = rng(seed);
  const run: WalkRun = { gps: [], stop: [], found: 0, total: 0 };
  for (let i = 0; i < WALKS; i++) {
    const truth: LngLat = [29 + rand() * 0.1, 41 + rand() * 0.05];
    const walk = walkFor(rand, { truth, tap: tapOf(rand, only), traffic: rand() < 0.5 });
    const pin = rand() < 0.4 ? pinNoise(rand, truth).point : null;
    if (!pin || distanceM(pin, walk.confirm.point) > PIN_AGREE_M) continue;
    run.total++;
    const stop = deliveryStop(walk.trace, [pin], { lng: walk.confirm.point[0], lat: walk.confirm.point[1] });
    if (!stop) continue;
    run.found++;
    run.gps.push(distanceM(walk.confirm.point, truth));
    run.stop.push(distanceM(stop.point, truth));
  }
  return run;
}

async function mergedRun(work: string, withStops: boolean): Promise<number[]> {
  const rand = rng(SEED + 31);
  const records: DeliveryRecord[] = [];
  const truths = new Map<string, LngLat>();
  for (let i = 0; i < 1500; i++) {
    const truth: LngLat = [29 + rand() * 0.1, 41 + rand() * 0.05];
    const spot: Spot = { plate: '34', district: 'Kadıköy', neighbourhood: 'Moda', street: `Sokak ${Math.floor(i / 20)}`, houseNumber: String(1 + (i % 20)), truth };
    truths.set(keyOf(spot), truth);
    for (let n = 0; n < 1 + Math.floor(rand() * 3); n++) {
      const walk = walkFor(rand, { truth, tap: tapOf(rand), traffic: rand() < 0.5 });
      const wrong = rand() < 0.08;
      const pin = rand() < 0.4 ? (wrong ? forcedOutlier(rand, truth, 40 + 110 * rand()) : pinNoise(rand, truth)).point : null;
      const stop = withStops ? deliveryStop(walk.trace, pin ? [pin] : [], { lng: walk.confirm.point[0], lat: walk.confirm.point[1] }) : null;
      records.push({ v: 1, src: `w${Math.floor(rand() * 60)}`, week: SIM_WEEK, region: '34', district: spot.district, neighbourhood: spot.neighbourhood as string, street: spot.street, houseNumber: spot.houseNumber, coordSource: pin ? 'pin' : 'gps', gps: { lng: walk.confirm.point[0], lat: walk.confirm.point[1], accuracyM: Math.max(1, walk.confirm.accuracyM) }, ...(pin ? { pin: { lng: pin[0], lat: pin[1] } } : {}), ...(stop ? { stop: { lng: stop.point[0], lat: stop.point[1] } } : {}) });
    }
  }
  const file = join(work, `merged-${withStops ? 'v2' : 'v1'}.sqlite`);
  await buildLearned({ plate: '34', records, nowWeek: SIM_WEEK, outFile: file });
  const db = openSqlite(file);
  const pack = await openLearned(db);
  const errors: number[] = [];
  for (const [key, truth] of truths) {
    const [, district, neighbourhood, street, houseNumber] = key.split('|') as [string, string, string, string, string];
    const hit = await pack?.lookup({ region: '34', district, neighbourhood, street, houseNumber });
    if (hit) errors.push(distanceM(hit.coordinate, truth));
  }
  await db.close();
  return errors;
}

async function checkStops(work: string): Promise<Measured> {
  const rows: string[] = [];
  const line = (label: string, run: WalkRun): string => {
    const g = summarize(run.gps);
    const st = summarize(run.stop);
    const within = run.stop.filter((e) => e <= 15).length / Math.max(1, run.stop.length);
    return `| ${label} | ${run.total} | ${percent(run.found / Math.max(1, run.total))} | ${g.median} | ${st.median} | ${percent(1 - st.median / Math.max(0.01, g.median))} | ${g.p90} | ${st.p90} | ${percent(within)} |`;
  };
  const mixed = walkRun(SEED + 41);
  rows.push(line('karışık', mixed));
  for (const tap of ['door', 'after', 'car'] as Tap[]) rows.push(line(tap === 'door' ? 'kapıda tıklar' : tap === 'after' ? 'kapıdan uzaklaşıp tıklar' : 'arabada tıklar', walkRun(SEED + 41, tap)));
  const gps = summarize(mixed.gps);
  const stop = summarize(mixed.stop);
  const gain = 1 - stop.median / gps.median;
  const v1 = summarize(await mergedRun(work, false));
  const v2 = summarize(await mergedRun(work, true));
  const measured = `iğneyle uyuşan ${mixed.total} teslimde durma noktası bulundu ${percent(mixed.found / mixed.total)}; hata ortanca onay GPS'i ${gps.median} m → durma noktası ${stop.median} m (%${(gain * 100).toFixed(0)} daha yakın), p90 ${gps.p90} → ${stop.p90} m; birleşik nokta ortanca kural v1 ${v1.median} m → v2 ${v2.median} m (p90 ${v1.p90} → ${v2.p90})`;
  const report = ['# Durma noktası (yürüyüş benzetimi)', '', `${WALKS} yürüyüş: 70-130 m yaklaşma, kapıda 5-25 sn durma, yarısında yolda trafik duruşu, GPS 4-16 m, iz 3 sn aralıkla son 90 sn. Tablo yalnız iğnesi onay noktasıyla ≤ ${PIN_AGREE_M} m uyuşan teslimleri sayar (%40'ında iğne var).`, '', "| Senaryo | Teslim | Durma bulundu | Onay GPS'i ortanca m | Durma ortanca m | Daha yakın | Onay GPS'i p90 m | Durma p90 m | Durma ≤ 15 m |", '|---|---|---|---|---|---|---|---|---|', ...rows, '', measured, ''].join('\n');
  return { check: 'stops', pass: gain >= LIMITS.stopGain && v2.median <= v1.median, measured, report };
}

export async function runLearnedCheck(check: string, options: { packsDir?: string; plates?: string[] } = {}): Promise<Measured | null> {
  const packs = options.packsDir ?? join(repoRoot, 'dist', 'packs');
  const plates = options.plates ?? PLATES;
  const work = mkdtempSync(join(tmpdir(), 'geo-learned-'));
  try {
    if (check === 'merge') return await checkMerge(packs, plates, work);
    if (check === 'conflict') return await checkConflict(packs, plates, work);
    if (check === 'floors') return await floorsCheck();
    if (check === 'privacy') return await checkPrivacy(packs, plates, work);
    if (check === 'patch') return await checkPatch(work);
    if (check === 'names') return await checkNames(packs, plates, work);
    if (check === 'stops') return await checkStops(work);
    return null;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const at = process.argv.indexOf('--check');
  const check = at >= 0 ? process.argv[at + 1] : undefined;
  (check ? runLearnedCheck(check) : Promise.resolve(null)).then((result) => {
    if (!result) {
      console.error(`kullanım: --check ${CHECKS.join('|')}`);
      process.exit(2);
    }
    const dir = join(homedir(), 'Desktop', 'yuksi-geo-raporlar');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `faz-13-${result.check}.md`), result.report);
    console.log(JSON.stringify({ check: result.check, pass: result.pass, measured: result.measured }));
    process.exit(result.pass ? 0 : 1);
  });
}

