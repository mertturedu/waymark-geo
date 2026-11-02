import { cellsAround, type LngLat } from '../geo/cells';
import { distanceM } from '../geo/distance';
import type { SqlDb } from '../ports';
import { createReader } from '../region/geom';

export const SUPPORTED_BUILDING_FORMAT = '1';
export const SNAP_M = 30;
export const CLAIM_M = 12;
const CELL_E6 = 2000;
const ROW = 65536;
const TIE_M = 1e-6;

export type Doors = (cells: number[]) => Promise<{ id: number; lng: number; lat: number }[]>;
export type BuildingSnap = (point: LngLat, exclude?: ReadonlySet<number>) => Promise<LngLat | null>;

function decodeCell(cell: number, bytes: Uint8Array): LngLat[] {
  const reader = createReader(bytes);
  const cy = Math.floor(cell / ROW);
  const cx = cell - cy * ROW;
  const count = reader.varint();
  const out: LngLat[] = [];
  for (let i = 0; i < count; i++) {
    const x = reader.varint();
    const y = reader.varint();
    out.push([(cx * CELL_E6 + x) / 1e6, (cy * CELL_E6 + y) / 1e6]);
  }
  reader.done();
  return out;
}

export async function openBuildings(db: SqlDb, doors: Doors): Promise<BuildingSnap> {
  const meta = new Map((await db.all<{ k: string; v: string }>('SELECT k, v FROM meta')).map((r) => [r.k, r.v]));
  if (meta.get('format') !== SUPPORTED_BUILDING_FORMAT) throw new Error(`desteklenmeyen bina paketi biçimi: ${String(meta.get('format'))}`);
  return async (point, exclude) => {
    const cells = cellsAround(point, SNAP_M);
    const rows = await db.all<{ cell: number; pts: Uint8Array }>(`SELECT cell, pts FROM building_cell WHERE cell IN (${cells.map(() => '?').join(', ')})`, cells);
    const near: { d: number; at: LngLat }[] = [];
    for (const row of rows) {
      for (const at of decodeCell(row.cell, row.pts)) {
        const d = distanceM(point, at);
        if (d <= SNAP_M) near.push({ d, at });
      }
    }
    if (near.length === 0) return null;
    near.sort((a, b) => (Math.abs(a.d - b.d) <= TIE_M ? a.at[1] - b.at[1] || a.at[0] - b.at[0] : a.d - b.d));
    const taken = (await doors(cellsAround(point, SNAP_M + CLAIM_M))).filter((door) => !(exclude && exclude.has(door.id)));
    const free = near.find((b) => !taken.some((door) => distanceM([door.lng, door.lat], b.at) <= CLAIM_M));
    return free ? free.at : null;
  };
}
