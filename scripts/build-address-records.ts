import { createReadStream, mkdirSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { officialDistrict } from './build-admin-data';
import type { AdminNames } from '../src/core/text/types';

export type RawRecord = {
  province: string;
  provinceName: string;
  district: string;
  districtNames: AdminNames;
  neighbourhood: string | null;
  neighbourhoodNames: Partial<AdminNames>;
  street: string;
  houseNumber: string;
  lon: number;
  lat: number;
};

export type { AddressRecord } from '../test/text/helpers/types';
import type { AddressRecord } from '../test/text/helpers/types';

export type SampleStat = { province: string; name: string; available: number; taken: number };

const EMBEDDED = new Set(['mah', 'mh', 'mahallesi', 'mahalle', 'cad', 'cd', 'sok', 'sk', 'blv', 'bulv', 'apt', 'blok']);

export function isCleanStreet(name: string): boolean {
  if (name.length < 3 || !/\p{L}/u.test(name) || /[,:;]|\.\d|\s-\s/.test(name)) return false;
  const tokens = name.toLowerCase().split(/[\s.]+/).filter(Boolean);
  if (tokens.slice(0, -1).some((token) => EMBEDDED.has(token)) || tokens.some((token) => /\d[\p{L}]{4,}/u.test(token))) return false;
  const kindWords = tokens.filter((token) => ['cadde', 'caddesi', 'sokak', 'sokağı', 'bulvarı'].includes(token));
  return kindWords.length <= 1;
}

export const NUMBER = /^\d{1,6}([A-Za-z]|[/-][A-Za-z0-9]{1,4})?$/;

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const order = (a: AddressRecord, b: AddressRecord) =>
  a.province.localeCompare(b.province) ||
  a.district.localeCompare(b.district, 'tr') ||
  (a.neighbourhood ?? '').localeCompare(b.neighbourhood ?? '', 'tr') ||
  a.street.localeCompare(b.street, 'tr') ||
  a.houseNumber.localeCompare(b.houseNumber, 'en', { numeric: true });

export function sampleRecords(rows: RawRecord[], perProvince: number, seed: number): { records: AddressRecord[]; stats: SampleStat[] } {
  const byProvince = new Map<string, AddressRecord[]>();
  const names = new Map<string, string>();
  const seen = new Set<string>();
  for (const row of rows) {
    const street = row.street.trim();
    const number = row.houseNumber.trim();
    const district = officialDistrict(row.province, row.district, row.provinceName);
    if (!isCleanStreet(street) || !NUMBER.test(number) || district === null) continue;
    const key = [row.province, district.name, row.neighbourhood ?? '', street, number].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    names.set(row.province, row.provinceName);
    const list = byProvince.get(row.province) ?? [];
    list.push({
      province: row.province,
      provinceName: row.provinceName,
      district: district.name,
      districtNames: { ...row.districtNames, tr: district.name },
      neighbourhood: row.neighbourhood,
      neighbourhoodNames: row.neighbourhoodNames,
      street,
      houseNumber: number,
    });
    byProvince.set(row.province, list);
  }
  const records: AddressRecord[] = [];
  const stats: SampleStat[] = [];
  for (const plate of [...byProvince.keys()].sort()) {
    const list = (byProvince.get(plate) as AddressRecord[]).sort(order);
    const next = mulberry32(seed + Number(plate));
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [list[i], list[j]] = [list[j] as AddressRecord, list[i] as AddressRecord];
    }
    const taken = list.slice(0, perProvince);
    records.push(...taken);
    stats.push({ province: plate, name: names.get(plate) as string, available: list.length, taken: taken.length });
  }
  records.sort(order);
  return { records, stats };
}

async function main(): Promise<void> {
  const source = process.argv[2] ?? 'dist/work/addresses-12.jsonl';
  const rows: RawRecord[] = [];
  for await (const line of createInterface({ input: createReadStream(source, 'utf8') })) if (line.trim() !== '') rows.push(JSON.parse(line) as RawRecord);
  const { records, stats } = sampleRecords(rows, 250, 7);
  mkdirSync('fixtures', { recursive: true });
  writeFileSync('fixtures/address-records.json', JSON.stringify({ version: 1, records }) + '\n');
  const dir = process.env.GEO_REPORT_DIR ?? join(homedir(), 'Desktop', 'yuksi-geo-raporlar');
  mkdirSync(dir, { recursive: true });
  const table = ['| Plaka | İl | OSM kayıt sayısı (temizlenmiş) | Örneğe alınan |', '|---|---|---|---|', ...stats.map((s) => `| ${s.province} | ${s.name} | ${s.available} | ${s.taken} |`)];
  writeFileSync(join(dir, 'faz-1-adres-ornekleri.md'), `# Faz 1: 12 il adres örnekleri\n\nKaynak: OpenStreetMap (ODbL). Tohum 7, il başına en çok 250.\n\n${table.join('\n')}\n\nToplam: ${records.length}\n`);
  console.log(`${records.length} kayıt`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(String(error));
    process.exit(1);
  });
}
