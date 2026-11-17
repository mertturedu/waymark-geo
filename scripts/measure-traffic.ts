import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cellOfGeohash, featuresOf } from '../pipeline/build/traffic-features';
import { predictCurve, trainTrafficModel } from '../pipeline/build/traffic-model';
import { predictProfile } from '../pipeline/build/traffic-predict';
import { createProfileBuilder, median, PROFILE_OPTIONS, SLOTS, type CellTable, type SpeedRow } from '../pipeline/build/traffic-profile';
import { createBorders } from '../src/core/region/borders';
import { createRouter, type TrafficSource } from '../src/core/route/router';
import { BAND_FROM, bandOf, localTime, slowdownOf, type TrafficBand } from '../src/core/traffic/model';
import { observedSlowdown, type ObservedProfile } from '../src/core/traffic/observed';
import { createNodeRouteStore } from '../src/node/pack-store';
import { loadGrid } from './traffic-grid';
import { readSpeedRows } from './traffic-rows';

const BANDS: TrafficBand[] = ['smooth', 'busy', 'heavy', 'jam'];
const MONDAY = Date.UTC(2026, 10, 16) - 3 * 3_600_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const DAY_OFFSET = [0, 5, 6];
const HIDDEN_SHARE = 5;
const PEAK_SLOT = 18;
const DAY_KINDS = ['weekday', 'saturday', 'sunday'];

const arg = (name: string, fallback: string): string => {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 && process.argv[at + 1] ? (process.argv[at + 1] as string) : fallback;
};

const slotTime = (slot: number): number => MONDAY + (DAY_OFFSET[Math.floor(slot / 24)] as number) * DAY_MS + (slot % 24) * HOUR_MS;
const ruleOf = (slot: number): number => slowdownOf('motorway', slotTime(slot), 1);
const mean = (list: ReadonlyArray<number>): number => (list.length === 0 ? NaN : list.reduce((sum, v) => sum + v, 0) / list.length);
const fixed = (value: number, digits = 3): string => value.toFixed(digits);
const pct = (value: number): string => `${(value * 100).toFixed(1)}%`;
export const hiddenCell = (cell: string): boolean => [...cell.slice(0, 5)].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % HIDDEN_SHARE === 0;

type Loaded = { train: Map<string, CellTable>; test: Map<string, CellTable>; rows: SpeedRow[]; trainProfile: ObservedProfile; testProfile: ObservedProfile };

async function load(dir: string, testMonth: string): Promise<Loaded> {
  const files = readdirSync(dir).filter((name) => name.endsWith('.csv')).sort().map((name) => join(dir, name));
  const train = createProfileBuilder();
  const test = createProfileBuilder({ ...PROFILE_OPTIONS, minRows: 100 });
  const rows: SpeedRow[] = [];
  await readSpeedRows(files, (row) => {
    if (row.month === testMonth) {
      test.add(row);
      if (row.vehicles >= PROFILE_OPTIONS.minVehicles) rows.push(row);
    } else train.add(row);
  });
  return { train: train.tables(), test: test.tables(), rows, trainProfile: train.profile(), testProfile: test.profile() };
}

function cityCurve(tables: Map<string, CellTable>, keep: (cell: string) => boolean, weighted = false): number[] {
  return Array.from({ length: SLOTS }, (_, slot) => {
    let sum = 0;
    let weights = 0;
    for (const [cell, table] of tables) {
      const value = table.slowdowns[slot];
      if (!keep(cell) || value === null || value === undefined) continue;
      const weight = weighted ? table.vehicles : 1;
      sum += value * weight;
      weights += weight;
    }
    return sum / weights;
  });
}

type Score = { n: number; error: number; same: number; near: number; table: number[][] };
const emptyScore = (): Score => ({ n: 0, error: 0, same: 0, near: 0, table: BANDS.map(() => BANDS.map(() => 0)) });
function score(into: Score, truth: number, guess: number): void {
  const a = BANDS.indexOf(bandOf(truth));
  const b = BANDS.indexOf(bandOf(guess));
  into.n += 1;
  into.error += Math.abs(truth - guess);
  into.same += a === b ? 1 : 0;
  into.near += Math.abs(a - b) <= 1 ? 1 : 0;
  ((into.table[a] as number[])[b] as number) += 1;
}
const line = (name: string, s: Score): string => `${name.padEnd(22)} n=${String(s.n).padStart(7)}  yavaşlama hatası ${fixed(s.error / s.n)}  bant isabeti ${pct(s.same / s.n)}  ±1 bant ${pct(s.near / s.n)}`;

function holdout(data: Loaded): void {
  const curve = cityCurve(data.train, () => true);
  const speed = { rule: [] as number[], city: [] as number[], profile: [] as number[] };
  const hourly = { n: 0, same: 0, worse: 0, muchWorse: 0 };
  for (const row of data.rows) {
    const table = data.train.get(row.cell);
    const typical = table?.slowdowns[row.slot];
    if (!table || typical === null || typical === undefined) continue;
    speed.rule.push(Math.abs(row.speed - table.free * (1 - ruleOf(row.slot))));
    speed.city.push(Math.abs(row.speed - table.free * (1 - (curve[row.slot] as number))));
    speed.profile.push(Math.abs(row.speed - table.free * (1 - typical)));
    const actual = BANDS.indexOf(bandOf(Math.max(0, 1 - row.speed / table.free)));
    const expected = BANDS.indexOf(bandOf(typical));
    hourly.n += 1;
    hourly.same += actual === expected ? 1 : 0;
    hourly.worse += actual > expected ? 1 : 0;
    hourly.muchWorse += actual > expected + 1 ? 1 : 0;
  }
  console.log(`saatlik satır: ${speed.profile.length}`);
  for (const [name, list] of Object.entries(speed)) console.log(`${name.padEnd(8)} hız hatası: ortalama ${fixed(mean(list), 2)} km/sa, ortanca ${fixed(median(list), 2)} km/sa`);
  console.log(`tek bir saatte gerçek bant = tipik bant: ${pct(hourly.same / hourly.n)}; tipikten kötü: ${pct(hourly.worse / hourly.n)}; iki bant kötü: ${pct(hourly.muchWorse / hourly.n)}`);
}

function bands(data: Loaded): void {
  const curve = cityCurve(data.train, () => true);
  const scores = { rule: emptyScore(), city: emptyScore(), profile: emptyScore() };
  const peak = { n: 0, truth: [0, 0, 0, 0], guess: [0, 0, 0, 0] };
  for (const [cell, truth] of data.test) {
    const table = data.train.get(cell);
    if (!table) continue;
    for (let slot = 0; slot < SLOTS; slot++) {
      const seen = truth.slowdowns[slot];
      const typical = table.slowdowns[slot];
      if (seen === null || seen === undefined || typical === null || typical === undefined) continue;
      const real = Math.max(0, 1 - ((1 - seen) * truth.free) / table.free);
      score(scores.rule, real, ruleOf(slot));
      score(scores.city, real, curve[slot] as number);
      score(scores.profile, real, typical);
      if (slot === PEAK_SLOT) {
        peak.n += 1;
        (peak.truth[BANDS.indexOf(bandOf(real))] as number) += 1;
        (peak.guess[BANDS.indexOf(bandOf(typical))] as number) += 1;
      }
    }
  }
  for (const [name, s] of Object.entries(scores)) console.log(line(name, s));
  console.log(`eşikler: yoğun ${BAND_FROM.busy}, ağır ${BAND_FROM.heavy}, sıkışık ${BAND_FROM.jam}`);
  console.log('hafta içi 18:00 bant payları (gerçek / tahmin):');
  BANDS.forEach((band, i) => console.log(`  ${band.padEnd(7)} ${pct((peak.truth[i] as number) / peak.n)} / ${pct((peak.guess[i] as number) / peak.n)}`));
  console.log('karışıklık tablosu, profil (satır gerçek, sütun tahmin):');
  scores.profile.table.forEach((row, i) => console.log(`  ${(BANDS[i] as string).padEnd(7)} ${row.map((v) => String(v).padStart(7)).join(' ')}`));
}

function spatial(data: Loaded): void {
  const curve = cityCurve(data.train, (cell) => !hiddenCell(cell));
  const scores = { rule: emptyScore(), city: emptyScore() };
  let hidden = 0;
  for (const [cell, truth] of data.test) {
    const table = data.train.get(cell);
    if (!hiddenCell(cell) || !table) continue;
    hidden += 1;
    for (let slot = 0; slot < SLOTS; slot++) {
      const seen = truth.slowdowns[slot];
      if (seen === null || seen === undefined) continue;
      const real = Math.max(0, 1 - ((1 - seen) * truth.free) / table.free);
      score(scores.rule, real, ruleOf(slot));
      score(scores.city, real, curve[slot] as number);
    }
  }
  console.log(`gizlenen hücre: ${hidden} / ${data.test.size}`);
  for (const [name, s] of Object.entries(scores)) console.log(line(name, s));
  console.log(`T2 hedefi (şehir eğrisinden %30 iyi): yavaşlama hatası ≤ ${fixed((scores.city.error / scores.city.n) * 0.7)}`);
}

function model(data: Loaded, work: string): void {
  const grid = loadGrid(work, '34');
  const visible = [...data.train].filter(([cell]) => !hiddenCell(cell));
  const started = Date.now();
  const trained = trainTrafficModel(visible.map(([cell]) => featuresOf(grid, ...cellOfGeohash(cell))), visible.map(([, table]) => table.slowdowns));
  const curve = cityCurve(data.train, (cell) => !hiddenCell(cell));
  const scores = { city: emptyScore(), model: emptyScore() };
  const peak = { n: 0, truth: [0, 0, 0, 0], guess: [0, 0, 0, 0] };
  for (const [cell, truth] of data.test) {
    const table = data.train.get(cell);
    if (!hiddenCell(cell) || !table) continue;
    const guess = predictCurve(trained, featuresOf(grid, ...cellOfGeohash(cell)));
    for (let slot = 0; slot < SLOTS; slot++) {
      const seen = truth.slowdowns[slot];
      if (seen === null || seen === undefined) continue;
      const real = Math.max(0, 1 - ((1 - seen) * truth.free) / table.free);
      score(scores.city, real, curve[slot] as number);
      score(scores.model, real, guess[slot] as number);
      if (slot === PEAK_SLOT) {
        peak.n += 1;
        (peak.truth[BANDS.indexOf(bandOf(real))] as number) += 1;
        (peak.guess[BANDS.indexOf(bandOf(guess[slot] as number))] as number) += 1;
      }
    }
  }
  console.log(`eğitim: ${visible.length} hücre, ${Date.now() - started} ms`);
  for (const [name, s] of Object.entries(scores)) console.log(line(name, s));
  console.log(`şehir eğrisine göre hata: ${pct(scores.model.error / scores.city.error - 1)}`);
  console.log('hafta içi 18:00 bant payları, gizli hücreler (gerçek / model):');
  BANDS.forEach((band, i) => console.log(`  ${band.padEnd(7)} ${pct((peak.truth[i] as number) / peak.n)} / ${pct((peak.guess[i] as number) / peak.n)}`));
  console.log('karışıklık tablosu, model (satır gerçek, sütun tahmin):');
  scores.model.table.forEach((row, i) => console.log(`  ${(BANDS[i] as string).padEnd(7)} ${row.map((v) => String(v).padStart(7)).join(' ')}`));
}

function cellCentre(cell: string): [number, number] {
  const alphabet = '0123456789bcdefghjkmnpqrstuvwxyz';
  const lat: [number, number] = [-90, 90];
  const lng: [number, number] = [-180, 180];
  let even = true;
  for (const ch of cell) {
    const value = alphabet.indexOf(ch);
    for (let bit = 4; bit >= 0; bit--) {
      const side = (value >> bit) & 1;
      const range = even ? lng : lat;
      const mid = (range[0] + range[1]) / 2;
      if (side) range[0] = mid;
      else range[1] = mid;
      even = !even;
    }
  }
  return [(lng[0] + lng[1]) / 2, (lat[0] + lat[1]) / 2];
}

async function eta(data: Loaded, packs: string, pairs: number, work: string): Promise<void> {
  const grid = loadGrid(work, '34');
  const visible = [...data.train].filter(([cell]) => !hiddenCell(cell));
  const guessed = predictProfile(trainTrafficModel(visible.map(([cell]) => featuresOf(grid, ...cellOfGeohash(cell))), visible.map(([, table]) => table.slowdowns)), grid);
  const borders = createBorders(readFileSync(join(process.cwd(), 'src', 'core', 'region', 'data', 'borders.bin')));
  const store = await createNodeRouteStore(packs);
  const source = (profile: ObservedProfile): TrafficSource => (region, at) => (region === '34' ? (lat, lng) => observedSlowdown(profile, lat, lng, at) : null);
  const routers = { model: createRouter({ store, borders, traffic: source(guessed) }), truth: createRouter({ store, borders, traffic: source(data.testProfile) }), profile: createRouter({ store, borders, traffic: source(data.trainProfile) }), rule: createRouter({ store, borders, traffic: () => null }), city: createRouter({ store, borders, traffic: (region, at) => (region === '34' ? () => curve[DAY_KINDS.indexOf(localTime(at).day) * 24 + Math.floor(localTime(at).hour)] as number : null) }) };
  const curve = cityCurve(data.train, () => true, true);
  const cells = [...data.train.keys()].filter((cell) => data.test.has(cell)).sort();
  let seed = 20261115;
  const random = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const hours = [8, 13, 18, 22];
  const errors: Record<string, Record<number, number[]>> = { profile: {}, rule: {}, city: {}, model: {} };
  const delays: Record<number, number[]> = {};
  const bias: Record<number, number[]> = {};
  let done = 0;
  let tries = 0;
  while (done < pairs && tries < pairs * 20) {
    tries += 1;
    const from = cellCentre(cells[Math.floor(random() * cells.length)] as string);
    const to = cellCentre(cells[Math.floor(random() * cells.length)] as string);
    const km = Math.hypot((from[0] - to[0]) * 84, (from[1] - to[1]) * 111);
    if (km < 4 || km > 30) continue;
    const free = await routers.rule.route(from, to);
    if (!free.ok || free.distanceM < 3000) continue;
    done += 1;
    for (const hour of hours) {
      const at = MONDAY + DAY_MS + hour * HOUR_MS;
      const truth = await routers.truth.route(from, to, { at });
      if (!truth.ok) continue;
      (delays[hour] ??= []).push(truth.durationS / free.durationS - 1);
      for (const name of ['profile', 'rule', 'city', 'model'] as const) {
        const got = await routers[name].route(from, to, { at });
        if (got.ok) ((errors[name] as Record<number, number[]>)[hour] ??= []).push(Math.abs(got.durationS - truth.durationS) / truth.durationS);
        if (got.ok && name === 'city') (bias[hour] ??= []).push((got.durationS - truth.durationS) / truth.durationS);
      }
    }
  }
  console.log(`rota çifti: ${done}`);
  for (const hour of hours) {
    const show = (name: string): string => {
      const list = (errors[name] as Record<number, number[]>)[hour] ?? [];
      return `${name} ortanca ${pct(median(list))}, p90 ${pct([...list].sort((a, b) => a - b)[Math.floor(list.length * 0.9)] ?? NaN)}`;
    };
    console.log(`  ${String(hour).padStart(2)}:00  gerçek gecikme ortanca +${pct(median(delays[hour] ?? []))}  süre hatası: ${show('profile')}; ${show('model')}; ${show('city')}; ${show('rule')}; şehir yanlılık ${pct(median(bias[hour] ?? []))}`);
  }
}

function curve(data: Loaded): void {
  const weighted = cityCurve(data.train, () => true, true);
  const peak = Math.max(...weighted);
  console.log(`tepe yavaşlama ${fixed(peak)}`);
  DAY_KINDS.forEach((day, d) => console.log(`${day}: [${weighted.slice(d * 24, d * 24 + 24).map((v) => fixed(v / peak, 2)).join(', ')}]`));
}

const check = arg('check', 'all');
const data = await load(arg('data', join('dist', 'work', 'traffic', 'ibb')), arg('test', '2025-01'));
console.log(`eğitim hücresi ${data.train.size}, sınama hücresi ${data.test.size}, sınama satırı ${data.rows.length}`);
if (check === 'curve') curve(data);
if (check === 'holdout' || check === 'all') holdout(data);
if (check === 'bands' || check === 'all') bands(data);
if (check === 'spatial' || check === 'all') spatial(data);
if (check === 'model') model(data, arg('work', join('dist', 'work', '261028')));
if (check === 'eta' || check === 'all') await eta(data, arg('packs', join('dist', 'packs')), Number(arg('pairs', '200')), arg('work', join('dist', 'work', '261028')));
