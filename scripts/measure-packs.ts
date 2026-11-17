import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createBorders, type Borders } from '../src/core/region/borders';
import { defaultKeyDir, ensureDevKey } from '../pipeline/build/manifest';
import { validatePacks } from '../pipeline/validate/validate-packs';
import type { AssignmentCheck } from './check-assignment';
import type { Sources } from './fetch-sources';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

export type BorderRowCheck = { id: string; lon: number; lat: number; plate: string; slack: boolean };
export type BorderComparison = { checked: number; agree: number; slackOutside: number; disagree: number; examples: { id: string; plate: string; got: string | null }[] };

export function compareBorders(borders: Borders, rows: BorderRowCheck[]): BorderComparison {
  const result: BorderComparison = { checked: 0, agree: 0, slackOutside: 0, disagree: 0, examples: [] };
  for (const row of rows) {
    result.checked += 1;
    const got = borders.provinceAt(row.lon, row.lat);
    if (got === row.plate) result.agree += 1;
    else if (row.slack && got === null) result.slackOutside += 1;
    else {
      result.disagree += 1;
      if (result.examples.length < 20) result.examples.push({ id: row.id, plate: row.plate, got });
    }
  }
  return result;
}

async function* readRows(path: string, plate: string): AsyncGenerator<BorderRowCheck> {
  const lines = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  for await (const line of lines) {
    if (line.trim() === '') continue;
    const row = JSON.parse(line) as { id: string; lon: number; lat: number; slack: boolean };
    yield { id: row.id, lon: row.lon, lat: row.lat, plate, slack: row.slack };
  }
}

export async function measureBorders(work: string, plates: string[]): Promise<BorderComparison> {
  const borders = createBorders(readFileSync(join(repoRoot, 'src', 'core', 'region', 'data', 'borders.bin')));
  const total: BorderComparison = { checked: 0, agree: 0, slackOutside: 0, disagree: 0, examples: [] };
  for (const plate of plates) {
    const path = join(work, 'addresses', plate, 'addresses.jsonl');
    if (!existsSync(path)) continue;
    const rows: BorderRowCheck[] = [];
    for await (const row of readRows(path, plate)) rows.push(row);
    const part = compareBorders(borders, rows);
    total.checked += part.checked;
    total.agree += part.agree;
    total.slackOutside += part.slackOutside;
    total.disagree += part.disagree;
    total.examples.push(...part.examples.slice(0, 20 - total.examples.length));
  }
  return total;
}


type Sum = Record<string, number>;
export type Evaluation = { pass: boolean; measured: string; problems: string[] };

const total = (values: Sum | number[]): number => (Array.isArray(values) ? values : Object.values(values)).reduce((a, b) => a + b, 0);
const comma = (n: number | string): string => String(n).replace('.', ',');
const mb = (bytes: number): string => comma((Math.round(bytes / 1e5) / 10).toFixed(1));
const percentText = (part: number, whole: number): string => (whole === 0 ? 'yok' : comma((Math.round((part / whole) * 1000) / 10).toFixed(1)));

export type Accounting = {
  addresses: { filtered: boolean; outside: number; skipped: number; source: number; unlocatable: number; provinces: Record<string, { source: number; accepted: number; rejected: Sum }> };
  streets: { filtered: boolean; ways: number; written: number; rejected: Sum };
  places: { filtered: boolean; source: number; provinces: Record<string, { accepted: number }>; rejected: Sum };
  buildings?: { provinces: Record<string, { source: number; accepted: number; rejected: Sum }> };
};

export function evaluateAccounting(a: Accounting): Evaluation {
  const problems: string[] = [];
  if (a.addresses.filtered || a.streets.filtered || a.places.filtered) problems.push('süzülmüş koşu: muhasebe tüm iller için yapılmamış');
  let inProvinces = 0;
  for (const [plate, p] of Object.entries(a.addresses.provinces)) {
    inProvinces += p.source;
    if (p.source !== p.accepted + total(p.rejected)) problems.push(`adres ${plate}: kaynak ${p.source}, giren ${p.accepted} + reddedilen ${total(p.rejected)}`);
  }
  const addressSum = inProvinces + a.addresses.outside + a.addresses.unlocatable + a.addresses.skipped;
  if (addressSum !== a.addresses.source) problems.push(`adres toplamı: kaynak ${a.addresses.source}, bölüşülen ${addressSum}`);
  const streetSum = a.streets.written + total(a.streets.rejected);
  if (streetSum !== a.streets.ways) problems.push(`sokak: yol ${a.streets.ways}, yazılan ${a.streets.written} + reddedilen ${total(a.streets.rejected)}`);
  const placeSum = total(Object.values(a.places.provinces).map((p) => p.accepted)) + total(a.places.rejected);
  if (placeSum !== a.places.source) problems.push(`yer: kaynak ${a.places.source}, giren + reddedilen ${placeSum}`);
  let buildingSource = 0;
  for (const [plate, p] of Object.entries(a.buildings?.provinces ?? {})) {
    buildingSource += p.source;
    if (p.source !== p.accepted + total(p.rejected)) problems.push(`bina ${plate}: kaynak ${p.source}, giren ${p.accepted} + reddedilen ${total(p.rejected)}`);
  }
  const measured = `adres ${a.addresses.source} = ${inProvinces} + ${a.addresses.outside} + ${a.addresses.unlocatable}; sokak ${a.streets.ways} = ${a.streets.written} + ${total(a.streets.rejected)}; yer ${a.places.source} = ${placeSum - total(a.places.rejected)} + ${total(a.places.rejected)}; bina ${buildingSource}, açık ${problems.length === 0 ? 0 : problems.length}`;
  return { pass: problems.length === 0, measured, problems };
}

export type DoorFixture = { plate: string; name: string; doors: number; tileMB: number };

export function evaluateCounts(accounting: { provinces: Record<string, { source: number }> }, fixture: DoorFixture[], built: { packs: number; errors: number }): Evaluation {
  const problems: string[] = [];
  let worst = 0;
  for (const row of fixture) {
    const found = accounting.provinces[row.plate];
    if (!found) {
      problems.push(`${row.plate} ${row.name}: muhasebede yok`);
      continue;
    }
    worst = Math.max(worst, (Math.abs(found.source - row.doors) / row.doors) * 100);
    if (Math.abs(found.source - row.doors) * 100 > row.doors) problems.push(`${row.plate} ${row.name}: kaynak ${found.source}, Bölüm 3'te ${row.doors}`);
  }
  if (built.packs !== 81) problems.push(`${built.packs} il paketi kurulmuş, 81 olmalı`);
  if (built.errors > 0) problems.push(`doğrulama ${built.errors} hata buldu`);
  return { pass: problems.length === 0, measured: `${built.packs} paket kuruldu, doğrulama hatası ${built.errors}, 12 ilde en büyük sapma yüzde ${comma((Math.round(worst * 10) / 10).toFixed(1))}`, problems };
}

type SizeManifest = { base: { size: number }[]; regions: { id: string; files: { kind: string; size: number }[] }[] };

export function evaluateSizes(manifest: SizeManifest, fixture: DoorFixture[], priority: string[]): Evaluation {
  const problems: string[] = [];
  const base = total(manifest.base.map((f) => f.size));
  if (base > 30_000_000) problems.push(`temel paket ${mb(base)} MB, sınır 30`);
  const sizeOf = (id: string, kind: string): number => total((manifest.regions.find((r) => r.id === id)?.files ?? []).filter((f) => f.kind === kind).map((f) => f.size));
  const has = (id: string, kind: string): boolean => (manifest.regions.find((r) => r.id === id)?.files ?? []).some((f) => f.kind === kind);
  let tiles = 0;
  let addresses = 0;
  for (const plate of priority) {
    if (!manifest.regions.some((r) => r.id === plate)) {
      problems.push(`${plate}: manifestte yok`);
      continue;
    }
    if (!has(plate, 'tiles')) problems.push(`${plate}: harita dosyası yok`);
    if (!has(plate, 'address')) problems.push(`${plate}: adres dosyası yok`);
    const limit = fixture.find((f) => f.plate === plate)?.tileMB;
    const size = sizeOf(plate, 'tiles');
    tiles += size;
    addresses += sizeOf(plate, 'address');
    if (limit === undefined) problems.push(`${plate}: Bölüm 3 tablosunda harita sınırı yok`);
    else if (size > limit * 1e6) problems.push(`${plate}: harita ${mb(size)} MB, sınır ${limit}`);
  }
  if (tiles > 700_000_000) problems.push(`12 il harita toplamı ${mb(tiles)} MB, sınır 700`);
  if (addresses > 60_000_000) problems.push(`12 il adres toplamı ${mb(addresses)} MB, sınır 60`);
  const allAddresses = total(manifest.regions.map((r) => sizeOf(r.id, 'address')));
  return { pass: problems.length === 0, measured: `temel ${mb(base)} MB, 12 il harita ${mb(tiles)} MB (sınır 700), 12 il adres ${mb(addresses)} MB (sınır 60), 81 il adres ${mb(allAddresses)} MB`, problems };
}

export function evaluateAssignment(check: AssignmentCheck): Evaluation {
  const problems: string[] = [];
  if (check.province.total === 0 || check.district.total === 0) problems.push('karşılaştırılacak etiket bulunamadı');
  if (check.province.agree * 100 < 99 * check.province.total) problems.push('il uyumu yüzde 99 altında');
  if (check.district.agree * 100 < 95 * check.district.total) problems.push('ilçe uyumu yüzde 95 altında');
  const measured = `il yüzde ${percentText(check.province.agree, check.province.total)} (${check.province.agree}/${check.province.total}), ilçe yüzde ${percentText(check.district.agree, check.district.total)} (${check.district.agree}/${check.district.total}), mahalle yüzde ${percentText(check.neighbourhood.agree, check.neighbourhood.total)} (${check.neighbourhood.agree}/${check.neighbourhood.total}, yalnızca rapor)`;
  return { pass: problems.length === 0, measured, problems };
}


const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;

export function validationStamp(root: string): string {
  const manifestPath = join(root, 'manifest-v1.json');
  const text = readFileSync(manifestPath, 'utf8');
  const hash = createHash('sha256').update(text);
  const manifest = JSON.parse(text) as { base: { path: string }[]; regions: { files: { path: string }[] }[] };
  for (const { path } of [...manifest.base, ...manifest.regions.flatMap((r) => r.files)]) {
    const full = join(root, path);
    hash.update(existsSync(full) ? `${path}:${statSync(full).size}:${statSync(full).mtimeMs}\n` : `${path}:yok\n`);
  }
  return hash.digest('hex');
}

type Validated = { stamp: string; errors: string[]; warnings: number; files: number; regions: number; hoodShare: number };

async function validateCached(packs: string, work: string): Promise<Validated> {
  const stamp = validationStamp(packs);
  const cache = join(work, 'validation.json');
  if (existsSync(cache)) {
    const saved = readJson<Validated>(cache);
    if (saved.stamp === stamp) return saved;
  }
  const { createBorders: open } = await import('../src/core/region/borders');
  const borders = open(readFileSync(join(repoRoot, 'src', 'core', 'region', 'data', 'borders.bin')));
  const publicKeyPem = ensureDevKey(defaultKeyDir()).publicKeyPem;
  const result = await validatePacks(packs, { work, borders, publicKeyPem });
  const value: Validated = {
    stamp,
    errors: result.findings.filter((f) => f.level === 'error').map((f) => `${f.where}: ${f.message}`),
    warnings: result.findings.filter((f) => f.level === 'warn').length,
    files: result.summary.files ?? 0,
    regions: result.summary.regions ?? 0,
    hoodShare: result.summary.addressInHoodPolygon ?? 1,
  };
  writeFileSync(cache, JSON.stringify(value));
  return value;
}

export async function runCheck(check: string): Promise<{ check: string; pass: boolean; measured: string; problems?: string[] } | null> {
  const sources = readJson<Sources>(join(repoRoot, 'pipeline', 'data', 'sources.json'));
  const work = join(repoRoot, 'dist', 'work', sources.osmFile.slice(7, 13));
  const packs = join(repoRoot, 'dist', 'packs');
  const fixture = readJson<DoorFixture[]>(join(repoRoot, 'fixtures', 'section3-door-counts.json'));
  const priority = fixture.map((f) => f.plate);
  const done = (e: Evaluation) => ({ check, pass: e.pass, measured: e.measured, problems: e.problems });
  switch (check) {
    case 'borders': {
      const plates = Array.from({ length: 81 }, (_, i) => String(i + 1).padStart(2, '0'));
      const r = await measureBorders(work, plates);
      const size = readFileSync(join(repoRoot, 'src', 'core', 'region', 'data', 'borders.bin')).length;
      return { check, pass: size < 600_000, measured: `${size} bayt (sınır 600000), adres ${r.agree}/${r.checked} aynı il, kıyı payı dışarıda ${r.slackOutside}, ayrışan ${r.disagree}` };
    }
    case 'accounting': {
      const buildings = join(work, 'buildings', 'buildings-accounting.json');
      return done(evaluateAccounting({
        addresses: readJson(join(work, 'addresses', 'accounting.json')),
        streets: readJson(join(work, 'streets', 'streets-accounting.json')),
        places: readJson(join(work, 'places', 'places-accounting.json')),
        buildings: existsSync(buildings) ? readJson(buildings) : undefined,
      }));
    }
    case 'counts': {
      const accounting = readJson<{ provinces: Record<string, { source: number }> }>(join(work, 'addresses', 'accounting.json'));
      const validated = await validateCached(packs, work);
      return done(evaluateCounts(accounting, fixture, { packs: validated.regions, errors: validated.errors.length }));
    }
    case 'sizes':
      return done(evaluateSizes(readJson(join(packs, 'manifest-v1.json')), fixture, priority));
    case 'tiles': {
      const validated = await validateCached(packs, work);
      const tileProblems = validated.errors.filter((e) => /tiles-|overview|\.pmtiles/.test(e));
      return { check, pass: validated.errors.length === 0, measured: `${validated.regions} il, ${validated.files} dosya, hata ${validated.errors.length} (karo ${tileProblems.length}), uyarı ${validated.warnings}, adreslerin yüzde ${percentText(Math.round(validated.hoodShare * 100000), 100000)}'i mahalle poligonunun içinde`, problems: validated.errors.slice(0, 10) };
    }
    case 'assignment':
    case 'hoods': {
      const { gather } = await import('./coverage-report');
      const { coverage, check: result } = await gather(work, packs, sources);
      const twelve = priority.map((p) => coverage.hoodSources[p]).filter((s): s is Record<string, number> => !!s);
      const sum = (key: string): number => twelve.reduce((a, s) => a + (s[key] ?? 0), 0);
      const all = sum('polygon') + sum('tag') + sum('place') + sum('none');
      const hoods = `12 il mahalle kaynağı: poligon ${percentText(sum('polygon'), all)}, etiket ${percentText(sum('tag'), all)}, yakın yer noktası ${percentText(sum('place'), all)}, yok ${percentText(sum('none'), all)}`;
      if (check === 'hoods') return { check, pass: true, measured: hoods };
      const e = evaluateAssignment(result);
      return { check, pass: e.pass, measured: e.measured, problems: e.problems };
    }
    case 'determinism': {
      const { runDeterminism } = await import('./determinism-run');
      const r = await runDeterminism(sources, (line) => console.error(line));
      const same = r.differing.length === 0 && r.onlyA.length === 0 && r.onlyB.length === 0 && r.bordersEqual && r.manifestsEqual;
      return { check, pass: same, measured: `${r.equal}/${r.compared} dosya bayt bayt aynı (${r.tilesCompared} ilin karosu dahil), gömülü sınırlar ${r.bordersEqual ? 'aynı' : 'farklı'}, manifest ${r.manifestsEqual ? 'aynı' : 'farklı'}`, problems: [...r.differing.map((d) => `farklı: ${d}`), ...r.onlyA.map((d) => `yalnız ilkinde: ${d}`), ...r.onlyB.map((d) => `yalnız ikincisinde: ${d}`)].slice(0, 20) };
    }
    case 'determinism-adres': {
      const { runAddressDeterminism } = await import('./determinism-run');
      const r = await runAddressDeterminism(sources, (line) => console.error(line));
      return { check, pass: r.differing.length === 0 && r.onlyA.length === 0 && r.onlyB.length === 0 && r.compared > 0, measured: `${r.equal}/${r.compared} adres, bina ve ara dosya bayt bayt aynı`, problems: [...r.differing.map((d) => `farklı: ${d}`), ...r.onlyA.map((d) => `yalnız ilkinde: ${d}`), ...r.onlyB.map((d) => `yalnız ikincisinde: ${d}`)].slice(0, 20) };
    }
    default:
      return null;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const at = process.argv.indexOf('--check');
  const check = at >= 0 ? process.argv[at + 1] : undefined;
  (check ? runCheck(check) : Promise.resolve(null)).then((result) => {
    if (!result) {
      console.error('kullanım: --check borders|accounting|assignment|counts|sizes|tiles|determinism|determinism-adres');
      process.exit(2);
    }
    console.log(JSON.stringify(result));
    process.exit(result.pass ? 0 : 1);
  });
}
