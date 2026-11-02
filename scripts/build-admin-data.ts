import { createReadStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { nameKey } from '../src/core/text/fold';
import type { AdminData, AdminDistrict, AdminNames, AdminProvince, Lang } from '../src/core/text/types';

export type AdminRow = {
  id: string;
  level: 4 | 6 | 8;
  iso: string | null;
  names: AdminNames;
  alt: string[];
  bbox: number[];
  wkt: string;
  parent: string | null;
};

export type AdminReport = {
  districtCount: number;
  expectedDistricts: number;
  districtDelta: number;
  droppedDistricts: { id: string; name: string; reason: string }[];
  corrections: { plate: string; from: string; to: string }[];
  missingPlates: string[];
  languageGaps: Record<Exclude<Lang, 'tr'>, number>;
  provinceCount: number;
};

export type External = Record<string, { plaka: number; ilceler: Record<string, unknown> }>;

export type CrossCheck = { externalCount: number; onlyExternal: { plate: string; name: string }[]; onlyOsm: { plate: string; name: string }[]; missingProvinces: string[] };

const ISO = /^TR-(\d{2})$/;
const MERKEZ = / Merkez$/;
const FIXES: Record<string, { name: string } | null> = {
  '04/Panos': { name: 'Patnos' },
  '45/Yunus Emre': { name: 'Yunusemre' },
  '62/Nazmiye': { name: 'Nazımiye' },
  '66/Sarıkaya Deresi': { name: 'Sarıkaya' },
  '71/Balışıh': { name: 'Balışeyh' },
  '48/Kara Ada': null,
};

export const PROVINCE_ALIASES: Record<string, string[]> = { '03': ['Afyon'], '27': ['Antep'], '33': ['İçel'], '46': ['Maraş'], '63': ['Urfa'] };

const DROP_ALT: Record<string, string[]> = { Şarkikaraağaç: ['Karaağaç'], Payas: ['Yakacık'] };

const GAP_LANGS = ['en', 'de', 'ru', 'el', 'ar'] as const;
const plateOf = (n: number): string => String(n).padStart(2, '0');

export function officialDistrict(plate: string, tr: string, provinceTr: string): { name: string; alt: string[] } | null {
  const key = `${plate}/${tr}`;
  if (key in FIXES) {
    const fix = FIXES[key];
    return fix ? { name: fix.name, alt: [tr] } : null;
  }
  if (MERKEZ.test(tr) || nameKey(tr) === nameKey(provinceTr)) return { name: 'Merkez', alt: [tr] };
  return { name: tr, alt: [] };
}

export function buildAdminData(rows: AdminRow[], expectedDistricts: number): { data: AdminData; report: AdminReport } {
  const provinceRows = rows.filter((row) => row.level === 4 && ISO.test(row.iso ?? ''));
  const plateById = new Map(provinceRows.map((row) => [row.id, (ISO.exec(row.iso as string) as RegExpExecArray)[1] as string]));
  const provinces: AdminProvince[] = provinceRows
    .map((row) => {
      const plate = plateById.get(row.id) as string;
      const have = new Set(row.alt.map(nameKey));
      return { plate, names: row.names, alt: [...row.alt, ...(PROVINCE_ALIASES[plate] ?? []).filter((alias) => !have.has(nameKey(alias)))] };
    })
    .sort((a, b) => a.plate.localeCompare(b.plate));

  const districts: AdminDistrict[] = [];
  const dropped: AdminReport['droppedDistricts'] = [];
  const corrections: AdminReport['corrections'] = [];
  const provinceNames = new Map(provinces.map((p) => [p.plate, p.names.tr]));
  for (const row of rows.filter((r) => r.level === 6)) {
    const plate = row.parent ? plateById.get(row.parent) : undefined;
    if (plate === undefined) {
      dropped.push({ id: row.id, name: row.names.tr, reason: 'Türkiye dışında' });
      continue;
    }
    const tr = row.names.tr;
    const official = officialDistrict(plate, tr, provinceNames.get(plate) ?? '');
    if (official === null) {
      dropped.push({ id: row.id, name: tr, reason: 'resmi listede yok' });
      continue;
    }
    const names = { ...row.names, tr: official.name } as AdminNames;
    delete names.de;
    const alt = official.name === tr ? row.alt : [...official.alt, ...row.alt];
    if (official.name !== tr) corrections.push({ plate, from: tr, to: official.name });
    districts.push({ province: plate, names, alt });
  }
  const districtKeys = new Set(districts.map((d) => nameKey(d.names.tr)));
  for (const d of districts) d.alt = d.alt.filter((a) => !(DROP_ALT[d.names.tr] ?? []).includes(a) && !(nameKey(a) !== nameKey(d.names.tr) && districtKeys.has(nameKey(a))));
  districts.sort((a, b) => a.province.localeCompare(b.province) || a.names.tr.localeCompare(b.names.tr, 'tr'));
  dropped.sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }));

  const have = new Set(provinces.map((p) => p.plate));
  const languageGaps = Object.fromEntries(GAP_LANGS.map((lang) => [lang, provinces.filter((p) => !p.names[lang]).length])) as AdminReport['languageGaps'];
  return {
    data: { provinces, districts },
    report: {
      districtCount: districts.length,
      expectedDistricts,
      districtDelta: districts.length - expectedDistricts,
      droppedDistricts: dropped,
      corrections: corrections.sort((a, b) => a.plate.localeCompare(b.plate) || a.from.localeCompare(b.from, 'tr')),
      missingPlates: Array.from({ length: 81 }, (_, i) => plateOf(i + 1)).filter((plate) => !have.has(plate)),
      languageGaps,
      provinceCount: provinces.length,
    },
  };
}

export function crossCheck(data: AdminData, external: External): CrossCheck {
  const ours = new Map<string, Map<string, string>>();
  for (const district of data.districts) {
    const map = ours.get(district.province) ?? new Map<string, string>();
    map.set(nameKey(district.names.tr), district.names.tr);
    ours.set(district.province, map);
  }
  const onlyExternal: CrossCheck['onlyExternal'] = [];
  const onlyOsm: CrossCheck['onlyOsm'] = [];
  const seen = new Set<string>();
  let externalCount = 0;
  for (const entry of Object.values(external)) {
    const plate = plateOf(entry.plaka);
    seen.add(plate);
    const mine = ours.get(plate) ?? new Map<string, string>();
    const theirs = new Map(Object.keys(entry.ilceler).map((name) => [nameKey(name), name]));
    externalCount += theirs.size;
    for (const [key, name] of theirs) if (!mine.has(key)) onlyExternal.push({ plate, name });
    for (const [key, name] of mine) if (!theirs.has(key)) onlyOsm.push({ plate, name });
  }
  const order = (a: { plate: string; name: string }, b: { plate: string; name: string }) => a.plate.localeCompare(b.plate) || a.name.localeCompare(b.name, 'tr');
  return {
    externalCount,
    onlyExternal: onlyExternal.sort(order),
    onlyOsm: onlyOsm.sort(order),
    missingProvinces: [...ours.keys()].filter((plate) => !seen.has(plate)).sort(),
  };
}

export function renderReport(report: AdminReport, check: CrossCheck | null): string {
  const lines = [
    '# Faz 1: il ve ilçe listesi raporu',
    '',
    `- İl sayısı: ${report.provinceCount} (eksik plaka: ${report.missingPlates.length === 0 ? 'yok' : report.missingPlates.join(', ')})`,
    `- İlçe sayısı (OpenStreetMap, Türkiye içinde): ${report.districtCount}; beklenen resmi sayı ${report.expectedDistricts}; fark ${report.districtDelta >= 0 ? '+' : ''}${report.districtDelta}`,
    `- Dil boşlukları (il adı olmayan il sayısı): ${Object.entries(report.languageGaps).map(([lang, n]) => `${lang} ${n}`).join(', ')}`,
    '',
    `## Alınmayan ilçe poligonları (${report.droppedDistricts.length})`,
    '',
    ...(report.droppedDistricts.length === 0 ? ['Yok.'] : report.droppedDistricts.map((d) => `- ${d.name || '(adsız)'} (${d.id}): ${d.reason}`)),
    '',
    `## Ad düzeltmeleri (${report.corrections.length})`,
    '',
    ...report.corrections.map((c) => `- ${c.plate} ${c.from} -> ${c.to}`),
    '',
    '## Bağımsız listeyle karşılaştırma',
    '',
  ];
  if (!check) lines.push('karşılaştırılmadı (GEO_ADMIN_CROSSCHECK verilmedi).');
  else {
    lines.push(`Dış listede ${check.externalCount} ilçe var.`, '', `### Yalnızca dış listede olan (${check.onlyExternal.length}): OpenStreetMap'te poligonu ya da adı yok`, '');
    lines.push(...(check.onlyExternal.length === 0 ? ['Yok.'] : check.onlyExternal.map((d) => `- ${d.plate} ${d.name}`)));
    lines.push('', `### Yalnızca OpenStreetMap'te olan (${check.onlyOsm.length}): dış listede adı farklı ya da yok`, '');
    lines.push(...(check.onlyOsm.length === 0 ? ['Yok.'] : check.onlyOsm.map((d) => `- ${d.plate} ${d.name}`)));
    if (check.missingProvinces.length > 0) lines.push('', `Dış listede olmayan iller: ${check.missingProvinces.join(', ')}`);
  }
  return lines.join('\n') + '\n';
}

async function readRows(path: string): Promise<AdminRow[]> {
  const rows: AdminRow[] = [];
  for await (const line of createInterface({ input: createReadStream(path, 'utf8') })) if (line.trim() !== '') rows.push(JSON.parse(line) as AdminRow);
  return rows;
}

async function main(): Promise<void> {
  const source = process.argv[2] ?? 'dist/work/admin.jsonl';
  const rows = await readRows(source);
  const { data, report } = buildAdminData(rows, 973);
  writeFileSync('src/core/text/data/admin.json', JSON.stringify(data) + '\n');
  const crossPath = process.env.GEO_ADMIN_CROSSCHECK;
  const check = crossPath ? crossCheck(data, JSON.parse(readFileSync(crossPath, 'utf8')) as External) : null;
  const dir = process.env.GEO_REPORT_DIR ?? join(homedir(), 'Desktop', 'yuksi-geo-raporlar');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'faz-1-ilce-raporu.md'), renderReport(report, check));
  console.log(`${report.provinceCount} il, ${report.districtCount} ilçe, fark ${report.districtDelta}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(String(error));
    process.exit(1);
  });
}
