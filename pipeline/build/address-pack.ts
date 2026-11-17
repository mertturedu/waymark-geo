import { existsSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import poiKinds from '../config/poi-kinds.json';
import { cellOf, cellsOfLine } from '../../src/core/geo/cells';
import { decodeLines, encodeLines, encodeRings, type Polygon, type Ring } from '../../src/core/region/geom';
import { nameKey } from '../../src/core/text/fold';
import { lookupWord } from '../../src/core/text/lexicon';
import { houseNumberKey } from '../../src/core/text/number';
import { streetKey } from '../../src/core/text/street';
import { encodePostings, trigramCodes } from '../../src/core/text/trigram';
import { assignId, loadRegistry, saveRegistry } from './id-registry';
import { districtSidKey, osmSid, streetSid, unitSid } from './sid';

export type PackStats = {
  rows: number;
  streets: number;
  parts: number;
  places: number;
  neighbourhoods: number;
  districts: number;
  searchNames: number;
  skippedNumbers: number;
  emptyStreets: number;
  droppedParts: number;
  bytes: number;
  tables: Record<string, number>;
};

type Names = Record<string, string>;
type AdminRow = { id: string; level: number; parent: string | null; names: Names; alt: string[]; center: [number, number]; rings: Polygon[] };
type Where = { district: string; neighbourhood: string | null; hoodName: string | null; hoodNames: Names | null; hoodSource: string };
type AddressRow = Where & { id: string; street: string | null; place: string | null; number: string; postcode: string | null; lon: number; lat: number };
type StreetRow = Where & { name: string; names: Names; alt: string[]; lines: Ring[]; ways: string[] };
export type PlaceInfo = { cat: string | null; brand: string | null; street: string | null; number: string | null; postcode: string | null; conf: number; msrc?: 0 | 1 };
type NationalMark = { hood: string; sid: string; official: number };
type NationalUnitRow = { district: string; name: string; sid: string; source: number; official: number; center: [number, number] | null; rings: Polygon[] | null };
type PlaceRow = Where & { id: string; kind: string; name: string; names: Names; alt: string[]; lon: number; lat: number; info?: PlaceInfo };

export const FORMAT_VERSION = 2;
const SOURCE_EVIDENCE = 4;
const SOURCE_OFFICIAL = 5;
export const APPLICATION_ID = 0x59474f31;
const SCALE = 1e6;
const OSM_TYPE: Record<string, number> = { n: 0, w: 1, r: 2 };

const e6 = (value: number): number => Math.round(value * SCALE);
const osmCode = (id: string): number => Number(id.slice(1)) * 4 + (OSM_TYPE[id[0] as string] as number);
const numberOf = (id: string): number => Number(id.slice(1));
const compare = (a: string | number, b: string | number): number => (a < b ? -1 : a > b ? 1 : 0);

function readLines<T>(path: string): T[] {
  if (!existsSync(path)) throw new Error(`${path}: dosya yok`);
  const rows: T[] = [];
  const lines = readFileSync(path, 'utf8').split('\n');
  lines.forEach((line, index) => {
    if (line.trim() === '') return;
    try {
      rows.push(JSON.parse(line) as T);
    } catch {
      throw new Error(`${path}:${index + 1}: satır okunamadı`);
    }
  });
  return rows;
}

export function cleanNeighbourhoodName(raw: string): string {
  const words = raw.trim().split(/\s+/);
  while (words.length > 1) {
    const hit = lookupWord(nameKey(words[words.length - 1] as string));
    if (hit?.kind !== 'mahalle') break;
    words.pop();
  }
  return words.join(' ');
}

export const DERIVED_MIN_DOORS = 4;
export const DERIVED_MAX_OFFSET_M = 15;
export const DERIVED_MIN_LENGTH_M = 30;
export const DERIVED_MAX_LENGTH_M = 3000;

export type DoorPoint = { lon: number; lat: number };

export function lineFromDoors(points: DoorPoint[]): [number, number][] | null {
  if (points.length < DERIVED_MIN_DOORS) return null;
  const lat0 = points.reduce((s, p) => s + p.lat, 0) / points.length;
  const kx = 111_320 * Math.cos((lat0 * Math.PI) / 180);
  const ky = 111_320;
  const mx = points.reduce((s, p) => s + p.lon, 0) / points.length;
  const my = points.reduce((s, p) => s + p.lat, 0) / points.length;
  const xy = points.map((p) => [(p.lon - mx) * kx, (p.lat - my) * ky] as [number, number]);
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const [x, y] of xy) {
    sxx += x * x;
    syy += y * y;
    sxy += x * y;
  }
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const ux = Math.cos(theta);
  const uy = Math.sin(theta);
  let lo = Infinity;
  let hi = -Infinity;
  let off = 0;
  for (const [x, y] of xy) {
    const t = x * ux + y * uy;
    lo = Math.min(lo, t);
    hi = Math.max(hi, t);
    off += Math.abs(-x * uy + y * ux);
  }
  const length = hi - lo;
  if (length < DERIVED_MIN_LENGTH_M || length > DERIVED_MAX_LENGTH_M || off / points.length > DERIVED_MAX_OFFSET_M) return null;
  const at = (t: number): [number, number] => [mx + (t * ux) / kx, my + (t * uy) / ky];
  return [at(lo), at(hi)];
}

function drawFromDoors(addresses: AddressRow[], streetIdOf: (raw: string | null) => number | null, drawn: Set<number>, nameOf: (id: number) => string): StreetRow[] {
  type Group = { id: number; district: string; points: DoorPoint[]; hoods: Map<string, number> };
  const groups = new Map<string, Group>();
  for (const a of addresses) {
    const id = streetIdOf(a.street);
    if (id === null || drawn.has(id)) continue;
    const key = `${id}|${a.district}`;
    const g: Group = groups.get(key) ?? { id, district: a.district, points: [], hoods: new Map() };
    g.points.push({ lon: a.lon, lat: a.lat });
    if (a.neighbourhood !== null) g.hoods.set(a.neighbourhood, (g.hoods.get(a.neighbourhood) ?? 0) + 1);
    groups.set(key, g);
  }
  const out: StreetRow[] = [];
  for (const g of [...groups.values()].sort((a, b) => a.id - b.id || compare(a.district, b.district))) {
    const line = lineFromDoors(g.points);
    if (!line) continue;
    const hood = mostCommon(g.hoods);
    out.push({ district: g.district, neighbourhood: hood === '' ? null : hood, hoodName: null, hoodNames: null, hoodSource: 'polygon', name: nameOf(g.id), names: {}, alt: [], lines: [line], ways: [`d${g.id}`] });
  }
  return out;
}

const mostCommon = (counts: Map<string, number>): string => [...counts].sort((a, b) => b[1] - a[1] || compare(a[0], b[0]))[0]?.[0] ?? '';

type Accumulator = { x: number; y: number; n: number };

export async function buildAddressPack(input: { province: string; workDir: string; outFile: string; osmTimestamp: string; kinds?: string[]; registryDir?: string }): Promise<PackStats> {
  const { province, workDir } = input;
  const admin = readLines<AdminRow>(join(workDir, 'admin-pack', `${province}.jsonl`));
  const addresses = readLines<AddressRow>(join(workDir, 'addresses', province, 'addresses.jsonl'));
  const streets = readLines<StreetRow>(join(workDir, 'streets', province, 'streets.jsonl'));
  const derivedFile = join(workDir, 'street-names', `${province}.jsonl`);
  if (existsSync(derivedFile)) streets.push(...readLines<StreetRow>(derivedFile));
  const places = readLines<PlaceRow>(join(workDir, 'places', province, 'places.jsonl'));

  const districts = admin.filter((r) => r.level === 6).sort((a, b) => numberOf(a.id) - numberOf(b.id));
  const districtId = new Map(districts.map((d, i) => [d.id, i + 1]));
  const districtName = new Map(districts.map((d, i) => [i + 1, d.names.tr ?? Object.values(d.names)[0] ?? d.id]));
  const hoodRows = admin.filter((r) => r.level === 8 && districtId.has(r.parent as string)).sort((a, b) => numberOf(a.id) - numberOf(b.id));
  const hoodId = new Map<string, number>();
  const hoodByKey = new Map<string, number>();
  const hoods: { id: number; district: number; osm: number | null; name: string; key: string; source: number; extra: string; center: [number, number] | null; poly: Uint8Array | null; sid: string; official: number }[] = [];
  for (const row of hoodRows) {
    const name = cleanNeighbourhoodName(row.names.tr ?? Object.values(row.names)[0] ?? row.id);
    const { tr: _tr, ...others } = row.names;
    void _tr;
    const id = hoods.length + 1;
    hoodId.set(row.id, id);
    const district = districtId.get(row.parent as string) as number;
    hoods.push({ id, district, osm: osmCode(row.id), name, key: nameKey(name), source: 0, extra: JSON.stringify({ names: others, alt: row.alt }), center: row.center, poly: encodeRings(row.rings, SCALE), sid: osmSid(province, row.id), official: 0 });
    const lookup = `${district}|${nameKey(name)}`;
    if (!hoodByKey.has(lookup)) hoodByKey.set(lookup, id);
  }

  const nationalFile = join(workDir, 'admin-national', `${province}.jsonl`);
  if (existsSync(nationalFile)) {
    const rows = readLines<NationalMark & NationalUnitRow>(nationalFile);
    for (const row of rows) {
      if (row.hood !== undefined) {
        const hood = hoods[(hoodId.get(row.hood) ?? 0) - 1];
        if (hood) hood.official = row.official;
        continue;
      }
      const district = districtId.get(row.district);
      if (district === undefined) continue;
      const key = nameKey(cleanNeighbourhoodName(row.name));
      if (key === '' || hoodByKey.has(`${district}|${key}`)) continue;
      const id = hoods.length + 1;
      hoods.push({ id, district, osm: null, name: row.name, key, source: row.source, extra: JSON.stringify({ names: {}, alt: [] }), center: row.center, poly: row.rings ? encodeRings(row.rings, SCALE) : null, sid: row.sid, official: row.official });
      hoodByKey.set(`${district}|${key}`, id);
    }
  }

  const sums = new Map<number, Accumulator>();
  const touch = (id: number, lon: number, lat: number): void => {
    const sum = sums.get(id) ?? { x: 0, y: 0, n: 0 };
    sum.x += lon;
    sum.y += lat;
    sum.n += 1;
    sums.set(id, sum);
  };
  type Fallback = { district: number; key: string; counts: Map<string, number>; source: number; names: Names };
  const fallbacks = new Map<string, Fallback>();
  for (const row of [...addresses, ...streets, ...places].filter((r) => r.neighbourhood === null && r.hoodName)) {
    const district = districtId.get(row.district);
    if (district === undefined) continue;
    const name = cleanNeighbourhoodName(row.hoodName as string);
    const key = nameKey(name);
    const lookup = `${district}|${key}`;
    if (key === '' || hoodByKey.has(lookup)) continue;
    const source = row.hoodSource === 'place' ? 2 : 1;
    const entry = fallbacks.get(lookup) ?? { district, key, counts: new Map(), source, names: {} };
    entry.counts.set(name, (entry.counts.get(name) ?? 0) + 1);
    if (source < entry.source || (source === entry.source && Object.keys(entry.names).length === 0)) {
      entry.source = Math.min(source, entry.source);
      if (row.hoodNames && Object.keys(row.hoodNames).length > 0) entry.names = row.hoodNames;
    }
    fallbacks.set(lookup, entry);
  }
  for (const entry of [...fallbacks.values()].sort((a, b) => a.district - b.district || compare(a.key, b.key))) {
    const id = hoods.length + 1;
    hoods.push({ id, district: entry.district, osm: null, name: mostCommon(entry.counts), key: entry.key, source: entry.source, extra: JSON.stringify({ names: entry.names, alt: [] }), center: null, poly: null, sid: unitSid(province, districtSidKey(districtName.get(entry.district) ?? ''), entry.key), official: 0 });
    hoodByKey.set(`${entry.district}|${entry.key}`, id);
  }
  const hoodOf = (row: Where): number | null => {
    if (row.neighbourhood !== null) return hoodId.get(row.neighbourhood) ?? null;
    if (!row.hoodName) return null;
    return hoodByKey.get(`${districtId.get(row.district) ?? 0}|${nameKey(cleanNeighbourhoodName(row.hoodName))}`) ?? null;
  };

  type StreetGroup = { key: string; kind: string | null; number: number | null; raw: Map<string, number>; extra: { text: string; lang: string }[]; ways: string[] };
  const groups = new Map<string, StreetGroup>();
  const groupOf = (raw: string): StreetGroup | null => {
    const sk = streetKey(raw);
    if (sk.key === '') return null;
    const id = `${sk.key}|${sk.kind ?? ''}`;
    let group = groups.get(id);
    if (!group) {
      group = { key: sk.key, kind: sk.kind, number: sk.numberOnly ? sk.number : null, raw: new Map(), extra: [], ways: [] };
      groups.set(id, group);
    }
    group.raw.set(raw, (group.raw.get(raw) ?? 0) + 1);
    return group;
  };
  let emptyStreets = 0;
  for (const row of streets) {
    const group = groupOf(row.name);
    if (!group) {
      emptyStreets += 1;
      continue;
    }
    for (const way of row.ways) if (group.ways.length < 12 && !group.ways.includes(way)) group.ways.push(way);
    for (const [lang, text] of Object.entries(row.names)) if (lang !== 'tr') group.extra.push({ text, lang });
    for (const text of row.alt) group.extra.push({ text, lang: 'tr' });
  }
  for (const row of addresses) {
    if (row.street === null) continue;
    if (!groupOf(row.street)) emptyStreets += 1;
  }
  const ordered = [...groups.values()].sort((a, b) => compare(a.key, b.key) || compare(a.kind ?? '', b.kind ?? ''));
  const streetId = new Map<string, number>();
  ordered.forEach((g, i) => streetId.set(`${g.key}|${g.kind ?? ''}`, i + 1));
  const streetIdOf = (raw: string | null): number | null => {
    if (raw === null) return null;
    const sk = streetKey(raw);
    return sk.key === '' ? null : (streetId.get(`${sk.key}|${sk.kind ?? ''}`) ?? null);
  };

  const kindNames = [...(input.kinds ?? Object.keys(poiKinds))].sort();
  const kindId = new Map(kindNames.map((name, i) => [name, i + 1]));

  const tmp = `${input.outFile}.tmp`;
  rmSync(tmp, { force: true });
  const db = new DatabaseSync(tmp);
  try {
    db.exec('PRAGMA page_size = 4096; PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF; PRAGMA auto_vacuum = 0; PRAGMA encoding = "UTF-8";');
    db.exec(`
      CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
      CREATE TABLE district (id INTEGER PRIMARY KEY, osm INTEGER NOT NULL, name TEXT NOT NULL, key TEXT NOT NULL, extra TEXT NOT NULL, cx INTEGER NOT NULL, cy INTEGER NOT NULL, poly BLOB NOT NULL);
      CREATE TABLE neighbourhood (id INTEGER PRIMARY KEY, district_id INTEGER NOT NULL, osm INTEGER, name TEXT NOT NULL, key TEXT NOT NULL, source INTEGER NOT NULL, extra TEXT NOT NULL, cx INTEGER, cy INTEGER, poly BLOB, sid TEXT, official INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE street_name (id INTEGER PRIMARY KEY, name TEXT NOT NULL, key TEXT NOT NULL, kind TEXT, number INTEGER, sid TEXT);
      CREATE TABLE street_part (id INTEGER PRIMARY KEY, name_id INTEGER NOT NULL, district_id INTEGER NOT NULL, hood_id INTEGER, geom BLOB NOT NULL, src INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE street_cell (cell INTEGER PRIMARY KEY, parts BLOB NOT NULL);
      CREATE TABLE address (id INTEGER PRIMARY KEY, street_id INTEGER, district_id INTEGER NOT NULL, hood_id INTEGER, place TEXT, number TEXT NOT NULL, nkey TEXT NOT NULL, num INTEGER, suffix TEXT NOT NULL, parity INTEGER, lon INTEGER NOT NULL, lat INTEGER NOT NULL, osm INTEGER NOT NULL, postcode TEXT, cell INTEGER NOT NULL);
      CREATE TABLE poi_kind (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
      CREATE TABLE poi (id INTEGER PRIMARY KEY, kind INTEGER NOT NULL, name TEXT NOT NULL, district_id INTEGER NOT NULL, hood_id INTEGER, lon INTEGER NOT NULL, lat INTEGER NOT NULL, osm INTEGER NOT NULL);
      CREATE TABLE search_name (id INTEGER PRIMARY KEY, kind INTEGER NOT NULL, ref INTEGER NOT NULL, lang TEXT NOT NULL, key TEXT NOT NULL, name TEXT);
      CREATE TABLE tri (code INTEGER PRIMARY KEY, ids BLOB NOT NULL);
    `);
    db.exec('BEGIN');
    const meta = db.prepare('INSERT INTO meta (k, v) VALUES (?, ?)');
    for (const [k, v] of [['format', String(FORMAT_VERSION)], ['osm_time', input.osmTimestamp], ['province', province], ['scale', String(SCALE)]] as [string, string][]) meta.run(k, v);

    const insertDistrict = db.prepare('INSERT INTO district (id, osm, name, key, extra, cx, cy, poly) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    for (const d of districts) {
      const name = d.names.tr ?? Object.values(d.names)[0] ?? d.id;
      const { tr: _tr, ...others } = d.names;
      void _tr;
      insertDistrict.run(districtId.get(d.id) as number, osmCode(d.id), name, nameKey(name), JSON.stringify({ names: others, alt: d.alt }), e6(d.center[0]), e6(d.center[1]), encodeRings(d.rings, SCALE));
    }

    const insertStreetName = db.prepare('INSERT INTO street_name (id, name, key, kind, number, sid) VALUES (?, ?, ?, ?, ?, ?)');
    const registryDir = input.registryDir ?? join(workDir, 'id-registry');
    const registry = loadRegistry(registryDir, province);
    const claimed = new Set<string>();
    ordered.forEach((g, i) => insertStreetName.run(i + 1, mostCommon(g.raw), g.key, g.kind, g.number, assignId(registry, claimed, `${g.key}|${g.kind ?? ''}`, g.ways, () => streetSid(province, g.key, g.kind))));
    saveRegistry(registryDir, province, registry);

    const drawn = new Set<number>();
    for (const row of streets) {
      const id = streetIdOf(row.name);
      if (id !== null) drawn.add(id);
    }
    const derivedRows = drawFromDoors(addresses, streetIdOf, drawn, (id) => mostCommon(ordered[id - 1]?.raw ?? new Map()));
    const derivedSet = new Set<StreetRow>(derivedRows);
    const partRows = [...streets, ...derivedRows]
      .map((row) => ({ row, name: streetIdOf(row.name) }))
      .filter((p): p is { row: StreetRow; name: number } => p.name !== null && districtId.has(p.row.district))
      .sort((a, b) => a.name - b.name || (districtId.get(a.row.district) as number) - (districtId.get(b.row.district) as number) || compare(hoodOf(a.row) ?? 0, hoodOf(b.row) ?? 0) || compare(a.row.ways[0] ? numberOf(a.row.ways[0]) : 0, b.row.ways[0] ? numberOf(b.row.ways[0]) : 0));
    const insertPart = db.prepare('INSERT INTO street_part (id, name_id, district_id, hood_id, geom, src) VALUES (?, ?, ?, ?, ?, ?)');
    const cellRows: [number, number][] = [];
    partRows.forEach((p, i) => {
      const hood = hoodOf(p.row);
      const geom = encodeLines(p.row.lines, SCALE);
      insertPart.run(i + 1, p.name, districtId.get(p.row.district) as number, hood, geom, derivedSet.has(p.row) ? 1 : 0);
      for (const cell of new Set(decodeLines(geom).flatMap((line) => cellsOfLine(line)))) cellRows.push([cell, i + 1]);
      if (hood !== null && p.row.lines[0]?.[0]) touch(hood, p.row.lines[0][0][0], p.row.lines[0][0][1]);
    });

    const namedLess = streets.filter((r) => districtId.has(r.district)).length - (partRows.length - derivedRows.length);
    const partsOfCell = new Map<number, number[]>();
    for (const [cell, part] of cellRows) partsOfCell.set(cell, [...(partsOfCell.get(cell) ?? []), part]);
    const insertCell = db.prepare('INSERT INTO street_cell (cell, parts) VALUES (?, ?)');
    for (const cell of [...partsOfCell.keys()].sort((a, b) => a - b)) insertCell.run(cell, encodePostings(partsOfCell.get(cell) as number[]));
    db.prepare('INSERT INTO meta (k, v) VALUES (?, ?)').run('dropped_parts', String(namedLess));

    let skippedNumbers = 0;
    const addressRows = addresses
      .map((row) => ({ row, hn: houseNumberKey(row.number), street: streetIdOf(row.street), hood: hoodOf(row), district: districtId.get(row.district) }))
      .filter((a) => {
        if (a.district === undefined) return false;
        if (a.hn === null) {
          skippedNumbers += 1;
          return false;
        }
        return true;
      })
      .sort((a, b) => (a.district as number) - (b.district as number) || compare(a.hood ?? 0, b.hood ?? 0) || compare(a.street ?? 0, b.street ?? 0) || compare(a.hn?.int ?? -1, b.hn?.int ?? -1) || compare(a.hn?.key ?? '', b.hn?.key ?? '') || compare(osmCode(a.row.id), osmCode(b.row.id)));
    const insertAddress = db.prepare('INSERT INTO address (id, street_id, district_id, hood_id, place, number, nkey, num, suffix, parity, lon, lat, osm, postcode, cell) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    addressRows.forEach((a, i) => {
      const hn = a.hn as NonNullable<typeof a.hn>;
      insertAddress.run(i + 1, a.street, a.district as number, a.hood, a.row.place, a.row.number, hn.key, hn.int, hn.suffix, hn.parity === null ? null : hn.parity === 'odd' ? 1 : 0, e6(a.row.lon), e6(a.row.lat), osmCode(a.row.id), a.row.postcode, cellOf(e6(a.row.lon) / SCALE, e6(a.row.lat) / SCALE));
      if (a.hood !== null) touch(a.hood, a.row.lon, a.row.lat);
    });

    const insertKind = db.prepare('INSERT INTO poi_kind (id, name) VALUES (?, ?)');
    kindNames.forEach((name, i) => insertKind.run(i + 1, name));
    const poiRows = places
      .filter((p) => districtId.has(p.district) && kindId.has(p.kind))
      .sort((a, b) => (kindId.get(a.kind) as number) - (kindId.get(b.kind) as number) || (districtId.get(a.district) as number) - (districtId.get(b.district) as number) || compare(nameKey(a.name), nameKey(b.name)) || compare(osmCode(a.id), osmCode(b.id)));
    const insertPoi = db.prepare('INSERT INTO poi (id, kind, name, district_id, hood_id, lon, lat, osm) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    if (poiRows.some((p) => p.info)) {
      db.exec('CREATE TABLE info_text (id INTEGER PRIMARY KEY, text TEXT NOT NULL); CREATE TABLE poi_info (id INTEGER PRIMARY KEY, cat INTEGER, brand INTEGER, street INTEGER, number TEXT, postcode INTEGER, conf INTEGER NOT NULL, msrc INTEGER NOT NULL DEFAULT 0)');
      const words = [...new Set(poiRows.flatMap((p) => [p.info?.cat, p.info?.brand, p.info?.street]).filter((w): w is string => !!w))].sort(compare);
      const wordId = new Map(words.map((w, i) => [w, i + 1]));
      const insertText = db.prepare('INSERT INTO info_text (id, text) VALUES (?, ?)');
      words.forEach((w, i) => insertText.run(i + 1, w));
      const insertInfo = db.prepare('INSERT INTO poi_info (id, cat, brand, street, number, postcode, conf, msrc) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
      const idOf = (w: string | null): number | null => (w ? (wordId.get(w) ?? null) : null);
      poiRows.forEach((p, i) => {
        if (!p.info) return;
        const code = p.info.postcode && /^\d{1,9}$/.test(p.info.postcode) ? Number(p.info.postcode) : null;
        insertInfo.run(i + 1, idOf(p.info.cat), idOf(p.info.brand), idOf(p.info.street), p.info.number, code, p.info.conf, p.info.msrc ?? 0);
      });
    }
    poiRows.forEach((p, i) => {
      const hood = hoodOf(p);
      insertPoi.run(i + 1, kindId.get(p.kind) as number, p.name, districtId.get(p.district) as number, hood, e6(p.lon), e6(p.lat), osmCode(p.id));
      if (hood !== null) touch(hood, p.lon, p.lat);
    });

    const insertHood = db.prepare('INSERT INTO neighbourhood (id, district_id, osm, name, key, source, extra, cx, cy, poly, sid, official) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const h of hoods) {
      const sum = sums.get(h.id);
      const center: [number, number] | null = h.center ?? (sum ? [sum.x / sum.n, sum.y / sum.n] : null);
      insertHood.run(h.id, h.district, h.osm, h.name, h.key, center && h.source === SOURCE_OFFICIAL ? SOURCE_EVIDENCE : h.source, h.extra, center ? e6(center[0]) : null, center ? e6(center[1]) : null, h.poly, h.sid, h.official);
    }

    type Search = { kind: number; ref: number; lang: string; key: string; name: string | null };
    const searches: Search[] = [];
    const seen = new Set<string>();
    const addSearch = (kind: number, ref: number, lang: string, key: string, name: string | null): void => {
      const id = `${kind}|${ref}|${lang}|${key}`;
      if (key === '' || seen.has(id)) return;
      seen.add(id);
      searches.push({ kind, ref, lang, key, name });
    };
    ordered.forEach((g, i) => {
      addSearch(0, i + 1, 'tr', g.key, null);
      for (const e of [...g.extra].sort((a, b) => compare(a.lang, b.lang) || compare(a.text, b.text))) addSearch(0, i + 1, e.lang, streetKey(e.text).key, e.text);
    });
    poiRows.forEach((p, i) => {
      addSearch(1, i + 1, 'tr', nameKey(p.name), null);
      for (const [lang, text] of Object.entries(p.names).sort((a, b) => compare(a[0], b[0]))) if (lang !== 'tr') addSearch(1, i + 1, lang, nameKey(text), text);
      for (const text of [...p.alt].sort()) addSearch(1, i + 1, 'tr', nameKey(text), text);
    });
    const insertSearch = db.prepare('INSERT INTO search_name (id, kind, ref, lang, key, name) VALUES (?, ?, ?, ?, ?, ?)');
    const split = input.kinds !== undefined;
    const postings = new Map<number, number[]>();
    const placePostings = new Map<number, number[]>();
    searches.forEach((s, i) => {
      insertSearch.run(i + 1, s.kind, s.ref, s.lang, s.key, s.name);
      const target = split && s.kind === 1 ? placePostings : postings;
      for (const code of trigramCodes(s.key)) {
        const list = target.get(code);
        if (list) list.push(i + 1);
        else target.set(code, [i + 1]);
      }
    });
    const writeTri = (table: string, map: Map<number, number[]>): void => {
      const insert = db.prepare(`INSERT INTO ${table} (code, ids) VALUES (?, ?)`);
      for (const code of [...map.keys()].sort((a, b) => a - b)) insert.run(code, encodePostings(map.get(code) as number[]));
    };
    writeTri('tri', postings);
    if (split) {
      db.exec('CREATE TABLE tri_poi (code INTEGER PRIMARY KEY, ids BLOB NOT NULL)');
      writeTri('tri_poi', placePostings);
    }
    db.exec('COMMIT');

    db.exec(`
      CREATE INDEX address_street ON address (street_id, num, suffix);
      CREATE INDEX address_hood ON address (hood_id);
      CREATE INDEX address_cell ON address (cell);
      CREATE INDEX street_part_name ON street_part (name_id);
      CREATE INDEX search_name_key ON search_name (key);
      ${input.kinds ? '' : 'CREATE INDEX poi_kind_idx ON poi (kind);'}
    `);
    db.exec(`PRAGMA user_version = ${FORMAT_VERSION}; PRAGMA application_id = ${APPLICATION_ID};`);
    db.exec('VACUUM');
    const check = db.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
    if (check.integrity_check !== 'ok') throw new Error(`integrity_check: ${check.integrity_check}`);
    let tables: Record<string, number> = {};
    try {
      const sizes = db.prepare('SELECT name, SUM(pgsize) AS bytes FROM dbstat GROUP BY name ORDER BY name').all() as { name: string; bytes: number }[];
      tables = Object.fromEntries(sizes.map((s) => [s.name, Number(s.bytes)]));
    } catch {
      tables = {};
    }
    db.close();
    renameSync(tmp, input.outFile);
    return {
      rows: addressRows.length,
      streets: ordered.length,
      parts: partRows.length,
      places: poiRows.length,
      neighbourhoods: hoods.length,
      districts: districts.length,
      searchNames: searches.length,
      skippedNumbers,
      emptyStreets,
      droppedParts: namedLess,
      bytes: statSync(input.outFile).size,
      tables,
    };
  } catch (error) {
    try {
      db.close();
    } catch {
      // already closed
    }
    rmSync(tmp, { force: true });
    throw error;
  }
}
