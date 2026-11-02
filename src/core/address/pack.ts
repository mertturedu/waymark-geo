import type { LngLat } from '../geo/cells';
import type { SqlDb } from '../ports';
import { decodeLines, decodeRings, type Polygon } from '../region/geom';
import { decodePostings, trigramCodes } from '../text/trigram';

export const SUPPORTED_FORMAT = '2';
const MAX_KEY = 64;
const DEFAULT_LIMIT = 200;
const POOL = 4;
const PART_CHUNK = 500;
export const MAX_CODES = 24;
export const MIN_SHARE = 0.3;
export const SHORT_KEY = 8;
const POSTCODE_DIGITS = 5;

export type StreetRow = { id: number; name: string; key: string; kind: string | null; number: number | null };
export type AddressRow = {
  id: number;
  streetId: number | null;
  districtId: number;
  hoodId: number | null;
  place: string | null;
  number: string;
  nkey: string;
  num: number | null;
  suffix: string;
  parity: number | null;
  lng: number;
  lat: number;
  osm: number;
  postcode: string | null;
};
export type PartRow = { id: number; districtId: number; hoodId: number | null; lines: LngLat[][] };
export type NamedPart = PartRow & { nameId: number };
export type PoiInfo = { category: string | null; brand: string | null; street: string | null; number: string | null; postcode: string | null; confidence: number };
export type PoiRow = { id: number; kind: string; name: string; districtId: number; hoodId: number | null; lng: number; lat: number; osm: number; info?: PoiInfo };
export type NameHit = { nameId: number; ref: number; lang: string; key: string; name: string | null };
export type Candidate = NameHit & { shared: number };
export type DistrictInfo = { id: number; name: string; key: string; center: LngLat };
export type HoodInfo = { id: number; districtId: number; name: string; key: string; source: number; center: LngLat | null; names?: Record<string, string> };

export type Region = {
  id: string;
  districts: DistrictInfo[];
  hoods: HoodInfo[];
  kinds: Map<number, string>;
  streetCandidates(key: string, kind: 'street' | 'poi', limit?: number): Promise<Candidate[]>;
  allNames(kind: 'street' | 'poi'): Promise<NameHit[]>;
  prefixNames(kind: 'street' | 'poi', prefix: string, limit?: number): Promise<NameHit[]>;
  streetsByIds(ids: number[]): Promise<StreetRow[]>;
  hoodsOfStreet(ids: number[]): Promise<{ nameId: number; districtId: number; hoodId: number | null }[]>;
  addressesOf(streetId: number, nkey: string): Promise<AddressRow[]>;
  addressesWithoutStreet(hoodId: number, nkey: string): Promise<AddressRow[]>;
  neighbours(streetId: number, parity: 0 | 1 | null, districtId?: number | null): Promise<AddressRow[]>;
  partsOf(streetId: number): Promise<PartRow[]>;
  poisByIds(ids: number[]): Promise<PoiRow[]>;
  districtPolygons(): Promise<Map<number, Polygon[]>>;
  districtCoverage(): Promise<Map<number, { streets: number; addresses: number }>>;
  hoodPolygons(districtId: number): Promise<Map<number, Polygon[]>>;
  addressesInCells(cells: number[]): Promise<AddressRow[]>;
  partsInCells(cells: number[]): Promise<NamedPart[]>;
  db: SqlDb;
};

type RawAddress = { id: number; street_id: number | null; district_id: number; hood_id: number | null; place: string | null; number: string; nkey: string; num: number | null; suffix: string; parity: number | null; lon: number; lat: number; osm: number; postcode: string | null };

const ADDRESS_COLUMNS = 'id, street_id, district_id, hood_id, place, number, nkey, num, suffix, parity, lon, lat, osm, postcode';

const marks = (count: number): string => Array.from({ length: count }, () => '?').join(', ');

const toAddress = (r: RawAddress): AddressRow => ({
  id: r.id, streetId: r.street_id, districtId: r.district_id, hoodId: r.hood_id, place: r.place, number: r.number, nkey: r.nkey,
  num: r.num, suffix: r.suffix, parity: r.parity, lng: r.lon / 1e6, lat: r.lat / 1e6, osm: r.osm, postcode: r.postcode,
});

export const COMMON_BYTES = 5_000;
const KEEP_RARE = 4;
const PLACE_CODES = 12;

export function skipCommon(codes: number[], sizes: Map<number, number>): number[] {
  const known = codes.filter((c) => sizes.has(c));
  const rare = known.filter((c) => (sizes.get(c) as number) <= COMMON_BYTES);
  if (rare.length >= KEEP_RARE) return rare.sort((a, b) => a - b);
  return known.sort((a, b) => (sizes.get(a) as number) - (sizes.get(b) as number) || a - b).slice(0, KEEP_RARE).sort((a, b) => a - b);
}

export function rarest(codes: number[], sizes: Map<number, number>, limit: number): number[] {
  const known = codes.filter((c) => sizes.has(c));
  if (known.length <= limit) return known.sort((a, b) => a - b);
  return known.sort((a, b) => (sizes.get(a) as number) - (sizes.get(b) as number) || a - b).slice(0, limit).sort((a, b) => a - b);
}

export function namesOf(extra: string): Record<string, string> | null {
  try {
    const parsed = JSON.parse(extra) as { names?: Record<string, unknown> };
    const out: Record<string, string> = {};
    for (const [lang, value] of Object.entries(parsed.names ?? {})) if (typeof value === 'string' && value !== '') out[lang] = value;
    return Object.keys(out).length > 0 ? out : null;
  } catch {
    return null;
  }
}

export async function openRegion(db: SqlDb): Promise<Region> {
  const meta = new Map((await db.all<{ k: string; v: string }>('SELECT k, v FROM meta')).map((r) => [r.k, r.v]));
  if (meta.get('format') !== SUPPORTED_FORMAT) throw new Error(`desteklenmeyen paket biçimi: ${String(meta.get('format'))}`);
  const center = (cx: number | null, cy: number | null): LngLat | null => (cx === null || cy === null ? null : [cx / 1e6, cy / 1e6]);
  const districts = (await db.all<{ id: number; name: string; key: string; cx: number; cy: number }>('SELECT id, name, key, cx, cy FROM district ORDER BY id')).map((d) => ({
    id: d.id, name: d.name, key: d.key, center: [d.cx / 1e6, d.cy / 1e6] as LngLat,
  }));
  const hoods = (await db.all<{ id: number; district_id: number; name: string; key: string; source: number; cx: number | null; cy: number | null; extra: string }>('SELECT id, district_id, name, key, source, cx, cy, extra FROM neighbourhood ORDER BY id')).map((h) => {
    const names = namesOf(h.extra);
    return { id: h.id, districtId: h.district_id, name: h.name, key: h.key, source: h.source, center: center(h.cx, h.cy), ...(names ? { names } : {}) };
  });
  const tables = new Set((await db.all<{ name: string }>("SELECT name FROM sqlite_schema WHERE type = 'table' AND name IN ('poi_info', 'tri_poi')")).map((r) => r.name));
  const withInfo = tables.has('poi_info');
  const placeTri = tables.has('tri_poi');
  const kinds = new Map((await db.all<{ id: number; name: string }>('SELECT id, name FROM poi_kind')).map((k) => [k.id, k.name]));
  let districtPolys: Promise<Map<number, Polygon[]>> | null = null;
  let coverage: Promise<Map<number, { streets: number; addresses: number }>> | null = null;
  const hoodPolys = new Map<number, Promise<Map<number, Polygon[]>>>();
  const kindCode = (kind: 'street' | 'poi'): number => (kind === 'street' ? 0 : 1);

  return {
    id: meta.get('province') ?? '',
    districts,
    hoods,
    kinds,
    db,
    async streetCandidates(key, kind, limit = DEFAULT_LIMIT) {
      const codes = trigramCodes(key.slice(0, MAX_KEY));
      if (codes.length === 0) return [];
      const shared = new Map<number, number>();
      const table = kind === 'poi' && placeTri ? 'tri_poi' : 'tri';
      let used = codes;
      const bigTable = table === 'tri_poi';
      if (codes.length > MAX_CODES || bigTable) {
        const sizes = new Map((await db.all<{ code: number; n: number }>(`SELECT code, length(ids) AS n FROM ${table} WHERE code IN (${marks(codes.length)})`, codes)).map((r) => [r.code, r.n]));
        used = bigTable ? skipCommon(codes, sizes) : codes;
        const cap = bigTable ? PLACE_CODES : MAX_CODES;
        if (used.length > cap) used = rarest(used, sizes, cap);
      }
      if (used.length === 0) return [];
      for (const row of await db.all<{ code: number; ids: Uint8Array }>(`SELECT code, ids FROM ${table} WHERE code IN (${marks(used.length)})`, used)) {
        for (const id of decodePostings(row.ids)) shared.set(id, (shared.get(id) ?? 0) + 1);
      }
      const floor = used.length <= SHORT_KEY ? 1 : Math.max(1, Math.ceil(used.length * MIN_SHARE));
      const pool = [...shared].filter((entry) => entry[1] >= floor).sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, limit * POOL);
      if (pool.length === 0) return [];
      const rows = await db.all<{ id: number; kind: number; ref: number; lang: string; key: string; name: string | null }>(`SELECT id, kind, ref, lang, key, name FROM search_name WHERE id IN (${marks(pool.length)})`, pool.map((p) => p[0]));
      const count = new Map(pool);
      return rows
        .filter((r) => r.kind === kindCode(kind))
        .map((r) => ({ nameId: r.id, ref: r.ref, lang: r.lang, key: r.key, name: r.name, shared: count.get(r.id) as number }))
        .sort((a, b) => b.shared - a.shared || a.nameId - b.nameId)
        .slice(0, limit);
    },
    async allNames(kind) {
      const rows = await db.all<{ id: number; ref: number; lang: string; key: string; name: string | null }>('SELECT id, ref, lang, key, name FROM search_name WHERE kind = ? ORDER BY id', [kindCode(kind)]);
      return rows.map((r) => ({ nameId: r.id, ref: r.ref, lang: r.lang, key: r.key, name: r.name }));
    },
    async prefixNames(kind, prefix, limit = DEFAULT_LIMIT) {
      const from = prefix.slice(0, MAX_KEY);
      const rows = await db.all<{ id: number; ref: number; lang: string; key: string; name: string | null }>('SELECT id, ref, lang, key, name FROM search_name WHERE key >= ? AND key < ? AND kind = ? ORDER BY key, id LIMIT ?', [from, `${from}\uffff`, kindCode(kind), limit]);
      return rows.map((r) => ({ nameId: r.id, ref: r.ref, lang: r.lang, key: r.key, name: r.name }));
    },
    async streetsByIds(ids) {
      if (ids.length === 0) return [];
      return db.all<StreetRow>(`SELECT id, name, key, kind, number FROM street_name WHERE id IN (${marks(ids.length)}) ORDER BY id`, ids);
    },
    async hoodsOfStreet(ids) {
      if (ids.length === 0) return [];
      const rows = await db.all<{ name_id: number; district_id: number; hood_id: number | null }>(
        `SELECT name_id, district_id, hood_id FROM street_part WHERE name_id IN (${marks(ids.length)}) UNION SELECT street_id, district_id, hood_id FROM address WHERE street_id IN (${marks(ids.length)}) ORDER BY 1, 2, 3`,
        [...ids, ...ids],
      );
      return rows.map((r) => ({ nameId: r.name_id, districtId: r.district_id, hoodId: r.hood_id }));
    },
    async addressesOf(streetId, nkey) {
      return (await db.all<RawAddress>(`SELECT ${ADDRESS_COLUMNS} FROM address WHERE street_id = ? AND nkey = ? ORDER BY id`, [streetId, nkey])).map(toAddress);
    },
    async addressesWithoutStreet(hoodId, nkey) {
      return (await db.all<RawAddress>(`SELECT ${ADDRESS_COLUMNS} FROM address WHERE street_id IS NULL AND hood_id = ? AND nkey = ? ORDER BY id`, [hoodId, nkey])).map(toAddress);
    },
    async neighbours(streetId, parity, districtId = null) {
      const where = ['street_id = ?', 'num IS NOT NULL'];
      const params: (number)[] = [streetId];
      if (parity !== null) {
        where.push('parity = ?');
        params.push(parity);
      }
      if (districtId !== null) {
        where.push('district_id = ?');
        params.push(districtId);
      }
      return (await db.all<RawAddress>(`SELECT ${ADDRESS_COLUMNS} FROM address WHERE ${where.join(' AND ')} ORDER BY num, suffix, id`, params)).map(toAddress);
    },
    async partsOf(streetId) {
      const rows = await db.all<{ id: number; district_id: number; hood_id: number | null; geom: Uint8Array }>('SELECT id, district_id, hood_id, geom FROM street_part WHERE name_id = ? ORDER BY id', [streetId]);
      return rows.map((r) => ({ id: r.id, districtId: r.district_id, hoodId: r.hood_id, lines: decodeLines(r.geom) as LngLat[][] }));
    },
    districtCoverage() {
      coverage ??= Promise.all([
        db.all<{ id: number; n: number }>('SELECT district_id AS id, COUNT(*) AS n FROM street_part GROUP BY district_id'),
        db.all<{ id: number; n: number }>('SELECT district_id AS id, COUNT(*) AS n FROM address GROUP BY district_id'),
      ]).then(([streets, addresses]) => {
        const out = new Map<number, { streets: number; addresses: number }>();
        for (const row of streets) out.set(row.id, { streets: row.n, addresses: 0 });
        for (const row of addresses) out.set(row.id, { streets: out.get(row.id)?.streets ?? 0, addresses: row.n });
        return out;
      });
      return coverage;
    },
    districtPolygons() {
      districtPolys ??= db.all<{ id: number; poly: Uint8Array }>('SELECT id, poly FROM district ORDER BY id').then((rows) => new Map(rows.map((r) => [r.id, decodeRings(r.poly)])));
      return districtPolys;
    },
    hoodPolygons(districtId) {
      let entry = hoodPolys.get(districtId);
      if (!entry) {
        entry = db.all<{ id: number; poly: Uint8Array }>('SELECT id, poly FROM neighbourhood WHERE district_id = ? AND poly IS NOT NULL ORDER BY id', [districtId]).then((rows) => new Map(rows.map((r) => [r.id, decodeRings(r.poly)])));
        hoodPolys.set(districtId, entry);
      }
      return entry;
    },
    async addressesInCells(cells) {
      if (cells.length === 0) return [];
      return (await db.all<RawAddress>(`SELECT ${ADDRESS_COLUMNS} FROM address WHERE cell IN (${marks(cells.length)}) ORDER BY id`, cells)).map(toAddress);
    },
    async partsInCells(cells) {
      if (cells.length === 0) return [];
      const ids = new Set<number>();
      for (const row of await db.all<{ parts: Uint8Array }>(`SELECT parts FROM street_cell WHERE cell IN (${marks(cells.length)})`, cells)) for (const id of decodePostings(row.parts)) ids.add(id);
      const wanted = [...ids].sort((a, b) => a - b);
      const out: NamedPart[] = [];
      for (let from = 0; from < wanted.length; from += PART_CHUNK) {
        const chunk = wanted.slice(from, from + PART_CHUNK);
        const rows = await db.all<{ id: number; name_id: number; district_id: number; hood_id: number | null; geom: Uint8Array }>(`SELECT id, name_id, district_id, hood_id, geom FROM street_part WHERE id IN (${marks(chunk.length)}) ORDER BY id`, chunk);
        for (const r of rows) out.push({ id: r.id, nameId: r.name_id, districtId: r.district_id, hoodId: r.hood_id, lines: decodeLines(r.geom) as LngLat[][] });
      }
      return out;
    },
    async poisByIds(ids) {
      if (ids.length === 0) return [];
      type Raw = { id: number; kind: number; name: string; district_id: number; hood_id: number | null; lon: number; lat: number; osm: number; cat: string | null; brand: string | null; street: string | null; number: string | null; postcode: number | null; conf: number | null };
      const rows = withInfo
        ? await db.all<Raw>(`SELECT p.id AS id, p.kind AS kind, p.name AS name, p.district_id AS district_id, p.hood_id AS hood_id, p.lon AS lon, p.lat AS lat, p.osm AS osm, c.text AS cat, b.text AS brand, s.text AS street, i.number AS number, i.postcode AS postcode, i.conf AS conf FROM poi p LEFT JOIN poi_info i ON i.id = p.id LEFT JOIN info_text c ON c.id = i.cat LEFT JOIN info_text b ON b.id = i.brand LEFT JOIN info_text s ON s.id = i.street WHERE p.id IN (${marks(ids.length)}) ORDER BY p.id`, ids)
        : await db.all<Raw>(`SELECT id, kind, name, district_id, hood_id, lon, lat, osm, NULL AS cat, NULL AS brand, NULL AS street, NULL AS number, NULL AS postcode, NULL AS conf FROM poi WHERE id IN (${marks(ids.length)}) ORDER BY id`, ids);
      return rows.map((r) => ({
        id: r.id, kind: kinds.get(r.kind) ?? '', name: r.name, districtId: r.district_id, hoodId: r.hood_id, lng: r.lon / 1e6, lat: r.lat / 1e6, osm: r.osm,
        ...(r.conf === null ? {} : { info: { category: r.cat, brand: r.brand, street: r.street, number: r.number, postcode: r.postcode === null ? null : String(r.postcode).padStart(POSTCODE_DIGITS, '0'), confidence: r.conf / 100 } }),
      }));
    },
  };
}
