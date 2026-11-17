import type { LngLat } from '../../src/core/geo/cells';
import { distanceM, projectOnLine } from '../../src/core/geo/distance';
import { ADDRESS_RADIUS_M, STREET_RADIUS_M } from '../../src/core/address/reverse';
import type { Region } from '../../src/core/address/pack';
import type { Borders } from '../../src/core/region/borders';
import { decodeLines, decodeRings, pointInRings, type Polygon } from '../../src/core/region/geom';

export type OracleAnswer = { plate: string; districtId: number | null; hoodId: number | null; addressId: number | null; streetId: number | null };

type Areas = { districts: [number, Polygon[]][]; hoods: [number, number, Polygon[]][] };
type Roads = { id: number; nameId: number; districtId: number; hoodId: number | null; box: [number, number, number, number]; lines: LngLat[][] }[];

const areas = new WeakMap<Region, Promise<Areas>>();
const roads = new WeakMap<Region, Promise<Roads>>();

const loadAreas = (region: Region): Promise<Areas> => {
  let entry = areas.get(region);
  if (!entry) {
    entry = (async () => ({
      districts: (await region.db.all<{ id: number; poly: Uint8Array }>('SELECT id, poly FROM district ORDER BY id')).map((r) => [r.id, decodeRings(r.poly)] as [number, Polygon[]]),
      hoods: (await region.db.all<{ id: number; district_id: number; poly: Uint8Array }>('SELECT id, district_id, poly FROM neighbourhood WHERE poly IS NOT NULL ORDER BY id')).map((r) => [r.id, r.district_id, decodeRings(r.poly)] as [number, number, Polygon[]]),
    }))();
    areas.set(region, entry);
  }
  return entry;
};

const loadRoads = (region: Region): Promise<Roads> => {
  let entry = roads.get(region);
  if (!entry) {
    entry = (async () => {
      const rows = await region.db.all<{ id: number; name_id: number; district_id: number; hood_id: number | null; geom: Uint8Array }>('SELECT id, name_id, district_id, hood_id, geom FROM street_part ORDER BY id');
      return rows.map((r) => {
        const lines = decodeLines(r.geom) as LngLat[][];
        const all = lines.flat();
        return { id: r.id, nameId: r.name_id, districtId: r.district_id, hoodId: r.hood_id, lines, box: [Math.min(...all.map((p) => p[0])), Math.min(...all.map((p) => p[1])), Math.max(...all.map((p) => p[0])), Math.max(...all.map((p) => p[1]))] as [number, number, number, number] };
      });
    })();
    roads.set(region, entry);
  }
  return entry;
};

type Best = { d: number; plate: string; id: number; answer: OracleAnswer };

const better = (a: Best, b: Best | null): boolean => b === null || (Math.abs(a.d - b.d) <= 1e-6 ? (a.plate === b.plate ? a.id < b.id : a.plate < b.plate) : a.d < b.d);

export async function reverseOracle(regions: Region[], borders: Borders, point: LngLat): Promise<OracleAnswer | null> {
  const margin = 0.01;
  const near = regions.filter((r) => {
    const box = borders.provinceBounds(r.id);
    return box !== null && point[0] >= box[0] - margin && point[0] <= box[2] + margin && point[1] >= box[1] - margin && point[1] <= box[3] + margin;
  });
  const reach = 0.002;
  let door: Best | null = null;
  for (const region of near) {
    const rows = await region.db.all<{ id: number; street_id: number | null; district_id: number; hood_id: number | null; lon: number; lat: number }>(
      'SELECT id, street_id, district_id, hood_id, lon, lat FROM address WHERE lon BETWEEN ? AND ? AND lat BETWEEN ? AND ? ORDER BY id',
      [Math.round((point[0] - reach) * 1e6), Math.round((point[0] + reach) * 1e6), Math.round((point[1] - reach) * 1e6), Math.round((point[1] + reach) * 1e6)],
    );
    for (const r of rows) {
      const d = distanceM(point, [r.lon / 1e6, r.lat / 1e6]);
      const hit: Best = { d, plate: region.id, id: r.id, answer: { plate: region.id, districtId: r.district_id, hoodId: r.hood_id, addressId: r.id, streetId: r.street_id } };
      if (d <= ADDRESS_RADIUS_M && better(hit, door)) door = hit;
    }
  }
  if (door) return door.answer;

  let road: Best | null = null;
  for (const region of near) {
    for (const part of await loadRoads(region)) {
      if (point[0] < part.box[0] - reach || point[0] > part.box[2] + reach || point[1] < part.box[1] - reach || point[1] > part.box[3] + reach) continue;
      const d = Math.min(...part.lines.filter((l) => l.length > 0).map((l) => projectOnLine(point, l).distanceM));
      const hit: Best = { d, plate: region.id, id: part.id, answer: { plate: region.id, districtId: part.districtId, hoodId: part.hoodId, addressId: null, streetId: part.nameId } };
      if (d <= STREET_RADIUS_M && better(hit, road)) road = hit;
    }
  }
  if (road) return road.answer;

  for (const region of [...near].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const { districts, hoods } = await loadAreas(region);
    const district = districts.find(([, rings]) => pointInRings(point, rings));
    if (!district) continue;
    const hood = hoods.find(([, districtId, rings]) => districtId === district[0] && pointInRings(point, rings));
    return { plate: region.id, districtId: district[0], hoodId: hood ? hood[0] : null, addressId: null, streetId: null };
  }
  const plate = borders.provinceAt(point[0], point[1]);
  return near.some((r) => r.id === plate) && plate ? { plate, districtId: null, hoodId: null, addressId: null, streetId: null } : null;
}
