import { createHash } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { NEIGHBOURHOOD_PACK_VERSION, type NeighbourhoodIndex, type NeighbourhoodShard } from '../../src/core/address/neighbourhoods';
import { findDistrict, findProvince, provinceIds } from '../../src/core/text/admin';
import { nameKey } from '../../src/core/text/fold';

export type HoodRow = { city: string; district: string; neighbourhood: string; postcode: string };
export type Rejected = { line: number; row: string; reason: 'unknown_province' | 'unknown_district' | 'ambiguous_district' | 'bad_postcode' | 'plate_mismatch' | 'empty_name' | 'duplicate' };
export type NeighbourhoodBuild = { index: NeighbourhoodIndex; shards: Map<string, NeighbourhoodShard>; rejected: Rejected[]; stats: { rows: number; kept: number; provinces: number; districts: number; postcodes: number } };

const HEADER = ['city', 'district', 'neighborhood', 'postcode'];

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i] as string;
    if (quoted) {
      if (ch === '"' && body[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && body[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

export function readHoodRows(text: string): HoodRow[] {
  const [head, ...rest] = parseCsv(text);
  if (!head || HEADER.some((name, i) => (head[i] ?? '').trim().toLowerCase() !== name)) throw new Error(`unexpected header: expected ${HEADER.join(',')}`);
  return rest.map((cells) => ({ city: (cells[0] ?? '').trim(), district: (cells[1] ?? '').trim(), neighbourhood: (cells[2] ?? '').trim(), postcode: (cells[3] ?? '').trim() }));
}

export function buildNeighbourhoodPack(rows: HoodRow[], source: string): NeighbourhoodBuild {
  const rejected: Rejected[] = [];
  const grouped = new Map<string, Map<string, Map<string, Set<string>>>>();
  const seen = new Set<string>();
  const codes = new Map<string, Set<string>>();
  let kept = 0;
  rows.forEach((row, at) => {
    const reject = (reason: Rejected['reason']): void => void rejected.push({ line: at + 2, row: `${row.city},${row.district},${row.neighbourhood},${row.postcode}`, reason });
    const province = findProvince(row.city);
    if (!province) return reject('unknown_province');
    const districts = findDistrict(row.district, province.id);
    if (districts.length === 0) return reject('unknown_district');
    if (districts.length > 1) return reject('ambiguous_district');
    if (!/^\d{5}$/.test(row.postcode)) return reject('bad_postcode');
    if (row.postcode.slice(0, 2) !== province.id) return reject('plate_mismatch');
    if (nameKey(row.neighbourhood) === '') return reject('empty_name');
    const district = (districts[0] as { name: string }).name;
    const identity = `${province.id}|${nameKey(district)}|${row.neighbourhood}|${row.postcode}`;
    if (seen.has(identity)) return reject('duplicate');
    seen.add(identity);
    kept++;
    const byDistrict = grouped.get(province.id) ?? new Map<string, Map<string, Set<string>>>();
    const byCode = byDistrict.get(district) ?? new Map<string, Set<string>>();
    const names = byCode.get(row.postcode) ?? new Set<string>();
    names.add(row.neighbourhood);
    byCode.set(row.postcode, names);
    byDistrict.set(district, byCode);
    grouped.set(province.id, byDistrict);
    const where = codes.get(row.postcode) ?? new Set<string>();
    where.add(`${province.id}/${district}`);
    codes.set(row.postcode, where);
  });

  const shards = new Map<string, NeighbourhoodShard>();
  let districtTotal = 0;
  for (const plate of [...grouped.keys()].sort()) {
    const byDistrict = grouped.get(plate) as Map<string, Map<string, Set<string>>>;
    districtTotal += byDistrict.size;
    shards.set(plate, {
      v: NEIGHBOURHOOD_PACK_VERSION,
      plate,
      districts: [...byDistrict.keys()].sort((a, b) => a.localeCompare(b, 'tr')).map((name) => ({
        name,
        groups: [...(byDistrict.get(name) as Map<string, Set<string>>).entries()].sort(([a], [b]) => a.localeCompare(b)).map(([code, names]) => [code, [...names].sort((a, b) => a.localeCompare(b, 'tr'))] as [string, string[]]),
      })),
    });
  }
  const index: NeighbourhoodIndex = { v: NEIGHBOURHOOD_PACK_VERSION, source, count: kept, codes: Object.fromEntries([...codes.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([code, where]) => [code, [...where].sort()])) };
  return { index, shards, rejected, stats: { rows: rows.length, kept, provinces: shards.size, districts: districtTotal, postcodes: codes.size } };
}

export function writeNeighbourhoodPack(build: NeighbourhoodBuild, outDir: string): { files: string[]; checksum: string } {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const hash = createHash('sha256');
  const files: string[] = [];
  const put = (name: string, value: unknown): void => {
    const body = JSON.stringify(value);
    writeFileSync(join(outDir, name), body);
    hash.update(name).update(body);
    files.push(name);
  };
  put('index.json', build.index);
  for (const plate of provinceIds()) {
    const shard = build.shards.get(plate);
    if (shard) put(`${plate}.json`, shard);
  }
  return { files, checksum: hash.digest('hex') };
}
