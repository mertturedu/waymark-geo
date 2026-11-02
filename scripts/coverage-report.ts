import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';
import adminData from '../src/core/text/data/admin.json';
import { PRIORITY_PLATES } from '../pipeline/build/tiles';
import { addToCheck, emptyCheck, type AddressForCheck, type AssignmentCheck } from './check-assignment';

export type ProvinceCoverage = {
  plate: string;
  name: string;
  doors: number;
  rows: number;
  streets: number;
  neighbourhoods: number;
  places: number;
  packBytes: number;
  tilesBytes: number;
  source: number;
  rejected: Record<string, number>;
};
export type DistrictCoverage = { plate: string; province: string; name: string; doors: number; streets: number; neighbourhoods: number };
export type CoverageInput = {
  osmDate: string;
  tilesBuild: string;
  provinces: ProvinceCoverage[];
  districts: DistrictCoverage[];
  hoodSources: Record<string, Record<string, number>>;
  detail?: string[];
};

export const formatCount = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const comma = (n: number | string): string => String(n).replace('.', ',');
const megabytes = (bytes: number): string => comma((Math.round(bytes / 1e5) / 10).toFixed(1));
const percent = (part: number, whole: number): string => (whole === 0 ? 'yok' : comma((Math.round((part / whole) * 1000) / 10).toFixed(1)));

const byPlate = <T extends { plate: string }>(list: T[]): T[] => [...list].sort((a, b) => (a.plate < b.plate ? -1 : a.plate > b.plate ? 1 : 0));

export function renderCoverage(input: CoverageInput): string {
  const provinces = byPlate(input.provinces);
  const lines: string[] = [
    `# Kapsama raporu`,
    '',
    `Veri: OpenStreetMap ${input.osmDate}, harita karosu derlemesi ${input.tilesBuild}. Kapı sayısı pakete giren kapı numaralı kayıtlardır; reddedilenler ayrı tabloda.`,
    '',
    '## 81 il',
    '',
    '| Plaka | İl | Kapı | Sokak | Mahalle | Yer | Adres paketi MB | Harita MB |',
    '|---|---|---|---|---|---|---|---|',
  ];
  const sum = (pick: (p: ProvinceCoverage) => number): number => provinces.reduce((total, p) => total + pick(p), 0);
  for (const p of provinces) lines.push(`| ${p.plate} | ${p.name} | ${formatCount(p.doors)} | ${formatCount(p.streets)} | ${formatCount(p.neighbourhoods)} | ${formatCount(p.places)} | ${megabytes(p.packBytes)} | ${megabytes(p.tilesBytes)} |`);
  lines.push(`| Toplam | | ${formatCount(sum((p) => p.doors))} | ${formatCount(sum((p) => p.streets))} | ${formatCount(sum((p) => p.neighbourhoods))} | ${formatCount(sum((p) => p.places))} | ${megabytes(sum((p) => p.packBytes))} | ${megabytes(sum((p) => p.tilesBytes))} |`);

  const reasons: Record<string, number> = {};
  for (const p of provinces) for (const [reason, n] of Object.entries(p.rejected)) reasons[reason] = (reasons[reason] ?? 0) + n;
  lines.push('', '## Reddedilenler', '', `Bir ile atanabilen ${formatCount(sum((p) => p.source))} kapı numaralı nesneden ${formatCount(sum((p) => p.rows))} satır pakete girdi. İl dışında kalan ya da konumu çözülemeyen nesneler ayrı sayılır (muhasebe raporu).`, '', '| Neden | Adet |', '|---|---|');
  for (const [reason, n] of Object.entries(reasons).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))) lines.push(`| ${reason} | ${formatCount(n)} |`);

  const names = new Map(provinces.map((p) => [p.plate, p.name]));
  lines.push('', '## Mahalle kaynağı', '', '| İl | Poligon % | Etiket % | Yakın yer noktası % | Yok % |', '|---|---|---|---|---|');
  for (const plate of Object.keys(input.hoodSources).sort()) {
    const s = input.hoodSources[plate] as Record<string, number>;
    const total = (s.polygon ?? 0) + (s.tag ?? 0) + (s.place ?? 0) + (s.none ?? 0);
    lines.push(`| ${names.get(plate) ?? plate} | ${percent(s.polygon ?? 0, total)} | ${percent(s.tag ?? 0, total)} | ${percent(s.place ?? 0, total)} | ${percent(s.none ?? 0, total)} |`);
  }

  lines.push('', '## İlçeler');
  const detail = new Set(input.detail ?? input.districts.map((d) => d.plate));
  for (const plate of [...detail].sort()) {
    const rows = input.districts.filter((d) => d.plate === plate);
    if (rows.length === 0) continue;
    lines.push('', `### ${rows[0]?.province} (${plate})`, '', '| İlçe | Kapı | Sokak | Mahalle |', '|---|---|---|---|');
    for (const d of [...rows].sort((a, b) => b.doors - a.doors || (a.name < b.name ? -1 : 1))) lines.push(`| ${d.name} | ${formatCount(d.doors)} | ${formatCount(d.streets)} | ${formatCount(d.neighbourhoods)} |`);
  }
  const empty = input.districts.filter((d) => d.doors === 0);
  lines.push('', '## Kapı numarası olmayan ilçeler', '', `Toplam ${formatCount(empty.length)} ilçe.`, '');
  for (const d of empty.sort((a, b) => (a.plate + a.name < b.plate + b.name ? -1 : 1))) lines.push(`- ${d.name} (${d.province})`);
  return lines.join('\n') + '\n';
}

export function renderAssignment(check: AssignmentCheck, limits: { provinceMin: number; districtMin: number }): string {
  const row = (label: string, tally: { agree: number; total: number }, min: number | null): string => {
    const verdict = min === null ? '' : tally.agree * 100 >= min * tally.total ? 'geçti' : 'kaldı';
    return `| ${label} | ${formatCount(tally.agree)} / ${formatCount(tally.total)} | ${percent(tally.agree, tally.total)} | ${min === null ? 'yalnızca rapor' : `en az yüzde ${min}`} | ${verdict} |`;
  };
  const lines = [
    '# Faz 2 atama denetimi',
    '',
    'Çıkarımdaki il, ilçe ve mahalle ataması poligonlarla yapıldı. Burada OSM kaydının kendi adres etiketleri (addr:province, addr:city, addr:district, addr:neighbourhood, addr:suburb) ile karşılaştırılıyor.',
    '',
    '| Ölçü | Uyan / Toplam | Oran % | Eşik | Sonuç |',
    '|---|---|---|---|---|',
    row('İl uyumu', check.province, limits.provinceMin),
    row('İlçe uyumu', check.district, limits.districtMin),
    row('Mahalle uyumu', check.neighbourhood, null),
    '',
    `Etiketi çözülemediği için ölçüme girmeyenler: il ${formatCount(check.skipped.province)}, ilçe ${formatCount(check.skipped.district)}. Resmi listede olmayan bir ilçeye atananlar: ${formatCount(check.unofficialDistrict)}.`,
    '',
    '## Mahalle nasıl bulundu',
    '',
    '| Yol | Adet |',
    '|---|---|',
    ...Object.entries(check.hoodSources).sort().map(([source, n]) => `| ${source} | ${formatCount(n)} |`),
  ];
  for (const [level, label] of [['province', 'İl'], ['district', 'İlçe'], ['neighbourhood', 'Mahalle']] as const) {
    const list = check.mismatches[level];
    lines.push('', `## ${label} uyuşmazlık örnekleri`, '');
    if (list.length === 0) lines.push('Yok.');
    else {
      lines.push('| OSM | Etiket | Atanan | Konum |', '|---|---|---|---|');
      for (const m of list) lines.push(`| ${m.id} | ${m.tag} | ${m.assigned} | ${m.lat}, ${m.lon} |`);
    }
  }
  return lines.join('\n') + '\n';
}

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
type DistrictRow = { id: string; level: number; parent: string | null; names: Record<string, string> };

function readJson<T>(path: string): T[] {
  return readFileSync(path, 'utf8').split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l) as T);
}

async function* streamRows<T>(path: string): AsyncGenerator<T> {
  for await (const line of createInterface({ input: createReadStream(path), crlfDelay: Infinity })) if (line.trim() !== '') yield JSON.parse(line) as T;
}

export async function gather(work: string, packsDir: string, sources: { osmTimestamp: string; tilesBuild: string }): Promise<{ coverage: CoverageInput; check: AssignmentCheck }> {
  const accounting = JSON.parse(readFileSync(join(work, 'addresses', 'accounting.json'), 'utf8')) as { provinces: Record<string, { source: number; accepted: number; rows: number; rejected: Record<string, number> }> };
  const manifest = JSON.parse(readFileSync(join(packsDir, 'manifest-v1.json'), 'utf8')) as { regions: { id: string; files: { kind: string; size: number }[] }[] };
  const sizeOf = (id: string, kind: string): number => manifest.regions.find((r) => r.id === id)?.files.find((f) => f.kind === kind)?.size ?? 0;
  const provinceNames = new Map(adminData.provinces.map((p) => [p.plate, p.names.tr as string]));
  const provinces: ProvinceCoverage[] = [];
  const districts: DistrictCoverage[] = [];
  const hoodSources: Record<string, Record<string, number>> = {};
  const check = emptyCheck();
  for (const plate of Object.keys(accounting.provinces).sort()) {
    const entry = accounting.provinces[plate] as (typeof accounting.provinces)[string];
    const stats = existsSync(join(work, 'packs', plate, 'stats.json')) ? (JSON.parse(readFileSync(join(work, 'packs', plate, 'stats.json'), 'utf8')) as { rows: number; streets: number; neighbourhoods: number; places: number }) : { rows: 0, streets: 0, neighbourhoods: 0, places: 0 };
    provinces.push({ plate, name: provinceNames.get(plate) ?? plate, doors: stats.rows, rows: stats.rows, streets: stats.streets, neighbourhoods: stats.neighbourhoods, places: stats.places, packBytes: sizeOf(plate, 'address'), tilesBytes: sizeOf(plate, 'tiles'), source: entry.source, rejected: entry.rejected });
    const admin = readJson<DistrictRow>(join(work, 'admin-pack', `${plate}.jsonl`));
    const districtName = new Map(admin.filter((r) => r.level === 6).map((r) => [r.id, r.names.tr ?? r.id]));
    const hoodName = new Map(admin.filter((r) => r.level === 8).map((r) => [r.id, r.names.tr ?? r.id]));
    const doors = new Map<string, number>();
    const hoods = new Map<string, number>();
    for (const r of admin) if (r.level === 8 && r.parent) hoods.set(r.parent, (hoods.get(r.parent) ?? 0) + 1);
    const streets = new Map<string, number>();
    const sources_: Record<string, number> = {};
    const names = { district: (id: string) => districtName.get(id) ?? null, hood: (id: string) => hoodName.get(id) ?? null };
    for await (const row of streamRows<AddressForCheck & { district: string; hoodSource: string }>(join(work, 'addresses', plate, 'addresses.jsonl'))) {
      doors.set(row.district, (doors.get(row.district) ?? 0) + 1);
      sources_[row.hoodSource] = (sources_[row.hoodSource] ?? 0) + 1;
      addToCheck(check, { ...row, plate }, names);
    }
    for await (const row of streamRows<{ district: string }>(join(work, 'streets', plate, 'streets.jsonl'))) streets.set(row.district, (streets.get(row.district) ?? 0) + 1);
    hoodSources[plate] = sources_;
    for (const [id, name] of districtName) districts.push({ plate, province: provinceNames.get(plate) ?? plate, name, doors: doors.get(id) ?? 0, streets: streets.get(id) ?? 0, neighbourhoods: hoods.get(id) ?? 0 });
  }
  return { coverage: { osmDate: sources.osmTimestamp.slice(0, 10), tilesBuild: sources.tilesBuild, provinces, districts, hoodSources, detail: [...PRIORITY_PLATES].sort() }, check };
}

async function main(): Promise<void> {
  const sources = JSON.parse(readFileSync(join(repoRoot, 'pipeline', 'data', 'sources.json'), 'utf8')) as { osmFile: string; osmTimestamp: string; tilesBuild: string };
  const work = join(repoRoot, 'dist', 'work', sources.osmFile.slice(7, 13));
  const { coverage, check } = await gather(work, join(repoRoot, 'dist', 'packs'), sources);
  const dir = join(homedir(), 'Desktop', 'yuksi-geo-raporlar');
  mkdirSync(dir, { recursive: true });
  const reportPath = join(dir, `kapsama-${coverage.osmDate}.md`);
  writeFileSync(reportPath, renderCoverage(coverage));
  writeFileSync(join(dir, 'faz-2-atama-denetimi.md'), renderAssignment(check, { provinceMin: 99, districtMin: 95 }));
  console.log(reportPath);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(String(error));
    process.exit(1);
  });
}
