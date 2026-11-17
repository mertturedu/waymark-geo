import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { distanceM } from '../../src/core/geo/distance';
import { pointInRings, type Polygon } from '../../src/core/region/geom';
import { nameKey } from '../../src/core/text/fold';
import { houseNumberKey } from '../../src/core/text/number';
import { streetKey } from '../../src/core/text/street';
import { buildAddressPack, cleanNeighbourhoodName, type PackStats, type PlaceInfo } from './address-pack';
import { bestReading, readAll, type Reading } from './directory-read';

export type ModelGroups = Record<string, string>;

export function loadModelGroups(file = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'category-groups-model.json')): ModelGroups {
  if (!existsSync(file)) return {};
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as { groups?: ModelGroups };
  return Object.fromEntries(Object.entries(parsed.groups ?? {}).filter(([, group]) => DIRECTORY_KINDS.includes(group) && group !== 'other'));
}

export const DIRECTORY_KINDS = ['pharmacy', 'health', 'safety', 'money', 'fuel', 'worship', 'lodging', 'market', 'food', 'public', 'shop', 'other'];

export type DirectoryRow = { id: string; name: string; name_tr: string | null; cat: string; g: string; conf: number; addr: string | null; more?: string[]; brand?: string | null; tax?: string | null; locality: string | null; postcode: string | null; lon: number; lat: number };
type Admin = { id: string; level: number; parent: string | null; rings: Polygon[] };
type Box = [number, number, number, number];
type Area = { id: string; rings: Polygon[]; box: Box };
export type Located = { district: string; neighbourhood: string | null };
export type DirectoryStats = PackStats & { sourceRows: number; extraRows: number; located: number; withStreet: number; withDoor: number; doorGroups: number; modelKinds: number };

const MAX_SPREAD_M = 500;
const MIN_HOOD_ROWS = 2;
const POSTCODE = /^\d{5}$/;

function boxOf(rings: Polygon[]): Box {
  const box: Box = [Infinity, Infinity, -Infinity, -Infinity];
  for (const polygon of rings) for (const [x, y] of polygon[0] ?? []) {
    if (x < box[0]) box[0] = x;
    if (y < box[1]) box[1] = y;
    if (x > box[2]) box[2] = x;
    if (y > box[3]) box[3] = y;
  }
  return box;
}

const inside = (area: Area, lon: number, lat: number): boolean => lon >= area.box[0] && lon <= area.box[2] && lat >= area.box[1] && lat <= area.box[3] && pointInRings([lon, lat], area.rings);

export function createLocator(admin: Admin[]): { locate(lon: number, lat: number): Located | null } {
  const districts: Area[] = admin.filter((a) => a.level === 6).map((a) => ({ id: a.id, rings: a.rings, box: boxOf(a.rings) })).sort((a, b) => (a.id < b.id ? -1 : 1));
  const known = new Set(districts.map((d) => d.id));
  const hoods = new Map<string, Area[]>();
  for (const a of admin.filter((x) => x.level === 8 && x.parent !== null && known.has(x.parent))) {
    const list = hoods.get(a.parent as string) ?? [];
    list.push({ id: a.id, rings: a.rings, box: boxOf(a.rings) });
    hoods.set(a.parent as string, list);
  }
  for (const list of hoods.values()) list.sort((a, b) => (a.id < b.id ? -1 : 1));
  return {
    locate(lon, lat) {
      const district = districts.find((d) => inside(d, lon, lat));
      if (!district) return null;
      const hood = (hoods.get(district.id) ?? []).find((h) => inside(h, lon, lat));
      return { district: district.id, neighbourhood: hood?.id ?? null };
    },
  };
}

type Item = { row: DirectoryRow; at: Located; readings: Reading[]; best: Reading; listed: boolean };
const mean = (values: number[]): number => values.reduce((a, b) => a + b, 0) / values.length;

export function medoid(points: [number, number][]): [number, number] {
  if (points.length <= 2) return points[0] as [number, number];
  let best = points[0] as [number, number];
  let bestSum = Infinity;
  for (const p of points) {
    const sum = points.reduce((total, q) => total + distanceM(p, q), 0);
    if (sum < bestSum - 1e-9) {
      best = p;
      bestSum = sum;
    }
  }
  return best;
}

export function lineThrough(points: [number, number][]): [number, number][][] {
  const unique = [...new Map(points.map((p) => [`${p[0]},${p[1]}`, p])).values()];
  if (unique.length < 2) return [];
  const cos = Math.cos((mean(unique.map((p) => p[1])) * Math.PI) / 180);
  const xs = unique.map((p) => p[0] * cos);
  const ys = unique.map((p) => p[1]);
  const mx = mean(xs);
  const my = mean(ys);
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let i = 0; i < unique.length; i++) {
    const dx = (xs[i] as number) - mx;
    const dy = (ys[i] as number) - my;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  const ordered = unique.map((p, i) => ({ p, t: ((xs[i] as number) - mx) * ux + ((ys[i] as number) - my) * uy })).sort((a, b) => a.t - b.t || a.p[0] - b.p[0] || a.p[1] - b.p[1]).map((o) => o.p);
  const lines: [number, number][][] = [];
  let current: [number, number][] = [];
  for (const p of ordered) {
    const last = current[current.length - 1];
    if (last && distanceM(last, p) > MAX_SPREAD_M) {
      if (current.length >= 2) lines.push(current);
      current = [];
    }
    current.push(p);
  }
  if (current.length >= 2) lines.push(current);
  return lines;
}

const writeLines = (path: string, rows: unknown[]): void => {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length > 0 ? '\n' : ''));
};

const readRows = <T>(path: string): T[] => (existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l) as T) : []);

export async function buildDirectoryPack(input: { province: string; workDir: string; outFile: string; osmTimestamp: string; modelGroups?: ModelGroups }): Promise<DirectoryStats> {
  const modelGroups = input.modelGroups ?? loadModelGroups();
  const { province, workDir } = input;
  const adminFile = join(workDir, 'admin-pack', `${province}.jsonl`);
  const admin = readRows<Admin & { names: Record<string, string> }>(adminFile);
  const rows = readRows<DirectoryRow>(join(workDir, 'overture', `${province}.rows.jsonl`));
  const extra = readRows<DirectoryRow>(join(workDir, 'fsq', `${province}.rows.jsonl`));
  const locator = createLocator(admin);
  const hoodOfDistrict = new Map<string, Map<string, string>>();
  for (const a of admin.filter((x) => x.level === 8 && x.parent !== null)) {
    const name = cleanNeighbourhoodName(a.names.tr ?? Object.values(a.names)[0] ?? a.id);
    const map = hoodOfDistrict.get(a.parent as string) ?? new Map<string, string>();
    if (!map.has(nameKey(name))) map.set(nameKey(name), a.id);
    hoodOfDistrict.set(a.parent as string, map);
  }

  const items: Item[] = [];
  const take = (row: DirectoryRow, listed: boolean): void => {
    const at = locator.locate(row.lon, row.lat);
    if (!at) return;
    const readings = readAll(row.addr, row.more ?? []);
    items.push({ row, at, readings, best: bestReading(readings), listed });
  };
  for (const row of rows) take(row, true);
  for (const row of extra) take(row, false);
  const textHoods = new Map<string, number>();
  for (const item of items) if (item.at.neighbourhood === null && item.best.hood) textHoods.set(`${item.at.district}|${item.best.hood}`, (textHoods.get(`${item.at.district}|${item.best.hood}`) ?? 0) + 1);
  const whereOf = (item: Item): { district: string; neighbourhood: string | null; hoodName: string | null; hoodNames: null; hoodSource: string } => {
    if (item.at.neighbourhood !== null) return { district: item.at.district, neighbourhood: item.at.neighbourhood, hoodName: null, hoodNames: null, hoodSource: 'polygon' };
    const hood = item.best.hood;
    const known = hood ? hoodOfDistrict.get(item.at.district)?.get(hood) : undefined;
    if (known) return { district: item.at.district, neighbourhood: known, hoodName: null, hoodNames: null, hoodSource: 'text' };
    const named = hood && (textHoods.get(`${item.at.district}|${hood}`) ?? 0) >= MIN_HOOD_ROWS ? hood : null;
    return { district: item.at.district, neighbourhood: null, hoodName: named, hoodNames: null, hoodSource: 'text' };
  };

  type Group = { where: ReturnType<typeof whereOf>; street: string; points: [number, number][]; extra: [number, number][]; names: Map<string, number> };
  const streets = new Map<string, Group>();
  type Door = { where: ReturnType<typeof whereOf>; street: string; number: string; points: [number, number][]; extra: [number, number][]; postcode: string | null };
  const own = (x: { points: [number, number][]; extra: [number, number][] }): [number, number][] => (x.points.length > 0 ? x.points : x.extra);
  const doors = new Map<string, Door>();
  const hoodId = (w: ReturnType<typeof whereOf>): string => w.neighbourhood ?? `~${w.hoodName ?? ''}`;
  let withStreet = 0;
  let withDoor = 0;
  for (const item of items) {
    for (const reading of item.readings) {
      if (!reading.street) continue;
      withStreet += 1;
      const key = streetKey(reading.street);
      if (key.key === '') continue;
      const where = whereOf(item);
      const sid = `${where.district}|${hoodId(where)}|${key.key}|${key.kind ?? ''}`;
      const group: Group = streets.get(sid) ?? { where, street: reading.street, points: [], extra: [], names: new Map() };
      (item.listed ? group.points : group.extra).push([item.row.lon, item.row.lat]);
      group.names.set(reading.street, (group.names.get(reading.street) ?? 0) + 1);
      streets.set(sid, group);
      const hn = reading.number ? houseNumberKey(reading.number) : null;
      if (reading.number && hn) {
        withDoor += 1;
        const did = `${sid}|${hn.key}`;
        const door: Door = doors.get(did) ?? { where, street: reading.street, number: reading.number, points: [], extra: [], postcode: null };
        (item.listed ? door.points : door.extra).push([item.row.lon, item.row.lat]);
        const code = (item.row.postcode ?? '').trim();
        if (door.postcode === null && POSTCODE.test(code)) door.postcode = code;
        doors.set(did, door);
      }
    }
  }

  const sequence = (n: number, prefix: string): string => `${prefix}${n}`;
  const addressRows = [...doors.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([, d], i) => {
    const at = medoid(own(d));
    return { ...d.where, id: sequence(i + 1, 'n'), street: d.street, place: null, number: d.number, postcode: d.postcode, lon: at[0], lat: at[1], tags: {}, slack: false };
  });
  const streetRows = [...streets.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).flatMap(([, g], i) => {
    const lines = lineThrough(own(g));
    if (lines.length === 0) return [];
    const name = [...g.names].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]?.[0] as string;
    return [{ ...g.where, name, names: {}, alt: [], lines, ways: [sequence(i + 1, 'w')] }];
  });
  let modelKinds = 0;
  const placeRows = items.filter((item) => item.listed).map((item, i) => {
    const alt = item.row.name_tr && item.row.name_tr !== item.row.name ? [item.row.name_tr] : [];
    const code = (item.row.postcode ?? '').trim();
    const mapped = item.row.g === 'other' ? modelGroups[item.row.cat] : undefined;
    const model = mapped && mapped !== 'other' ? mapped : undefined;
    if (model) modelKinds++;
    const info: PlaceInfo = { cat: item.row.cat || null, brand: item.row.brand ?? null, street: item.best.street, number: item.best.number, postcode: POSTCODE.test(code) ? code : null, conf: Math.round(item.row.conf * 100), ...(model ? { msrc: 1 as const } : {}) };
    return { ...whereOf(item), id: sequence(i + 1, 'n'), kind: model ?? item.row.g, name: item.row.name, names: {}, alt, lon: item.row.lon, lat: item.row.lat, info };
  });

  const scratch = join(workDir, 'directory-work', province);
  rmSync(scratch, { recursive: true, force: true });
  mkdirSync(join(scratch, 'admin-pack'), { recursive: true });
  copyFileSync(adminFile, join(scratch, 'admin-pack', `${province}.jsonl`));
  writeLines(join(scratch, 'addresses', province, 'addresses.jsonl'), addressRows);
  writeLines(join(scratch, 'streets', province, 'streets.jsonl'), streetRows);
  writeLines(join(scratch, 'places', province, 'places.jsonl'), placeRows);
  const stats = await buildAddressPack({ province, workDir: scratch, outFile: input.outFile, osmTimestamp: input.osmTimestamp, kinds: DIRECTORY_KINDS });
  rmSync(scratch, { recursive: true, force: true });
  return { ...stats, sourceRows: rows.length, extraRows: extra.length, located: items.length, withStreet, withDoor, doorGroups: addressRows.length, modelKinds };
}
