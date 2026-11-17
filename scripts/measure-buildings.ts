import { createReadStream, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { openRegion } from '../src/core/address/pack';
import { predictNumber } from '../src/core/address/predict';
import { cellOf, cellsAround, type LngLat } from '../src/core/geo/cells';
import { distanceM } from '../src/core/geo/distance';
import { createNodePackStore } from '../src/node/pack-store';
import { CENTROID_M, CENTROID_MIN, CLAIM_M, centroidRatio, indexBuildings, qualifies, type Building, type BuildingIndex } from '../pipeline/build/building-select';
import { pickTargets, summarize, type AddressPoint } from './measure-predict';

export { centroidRatio, indexBuildings, qualifies, type Building, type BuildingIndex };

const SNAP_M = 30;
const REQUIRED_GAIN = 20;
const ALLOWED_GROWTH = 50;
const TIE_M = 1e-6;

export function snapToBuilding(point: LngLat, index: BuildingIndex, isClaimed: (building: Building) => boolean, maxM: number = SNAP_M): LngLat | null {
  let best: { d: number; building: Building } | null = null;
  for (const building of index.around(point, maxM)) {
    if (isClaimed(building)) continue;
    const d = distanceM(point, [building.lng, building.lat]);
    if (best === null || (Math.abs(d - best.d) <= TIE_M ? building.id < best.building.id : d < best.d)) best = { d, building };
  }
  return best ? [best.building.lng, best.building.lat] : null;
}

export function decideAdoption(input: { medianBefore: number; medianAfter: number; growthPercent: number }): { adopt: boolean; reductionPercent: number } {
  if (input.medianBefore <= 0) return { adopt: false, reductionPercent: 0 };
  const reductionPercent = Math.round(((input.medianBefore - input.medianAfter) / input.medianBefore) * 1e6) / 1e4;
  return { adopt: reductionPercent >= REQUIRED_GAIN && input.growthPercent <= ALLOWED_GROWTH, reductionPercent };
}

const varintSize = (value: number): number => {
  let size = 1;
  for (let rest = value; rest >= 128; rest = Math.floor(rest / 128)) size += 1;
  return size;
};

export function encodedSize(list: Building[]): number {
  const sorted = list.map((b) => ({ cell: cellOf(b.lng, b.lat), x: Math.round(b.lng * 1e5), y: Math.round(b.lat * 1e5) })).sort((a, b) => a.cell - b.cell || a.y - b.y || a.x - b.x);
  let total = 0;
  let previousCell = 0;
  let previous = { x: 0, y: 0 };
  for (const [index, item] of sorted.entries()) {
    const newCell = index === 0 || item.cell !== previousCell;
    total += newCell ? varintSize(item.cell - previousCell) : 0;
    const dx = newCell ? item.x : item.x - previous.x;
    const dy = newCell ? item.y : item.y - previous.y;
    total += varintSize(Math.abs(dx) * 2) + varintSize(Math.abs(dy) * 2);
    previousCell = item.cell;
    previous = item;
  }
  return total;
}

async function readBuildings(file: string): Promise<Building[]> {
  const out: Building[] = [];
  for await (const line of createInterface({ input: createReadStream(file) })) {
    if (line === '') continue;
    const row = JSON.parse(line) as { id: string; lon: number; lat: number; area_m2: number };
    out.push({ id: row.id, lng: row.lon, lat: row.lat, area: row.area_m2 });
  }
  return out;
}

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const PRIORITY = ['06', '10', '16', '20', '34', '35', '38', '41', '42', '45', '58', '59'];

async function run(): Promise<void> {
  const store = await createNodePackStore(join(repoRoot, 'dist', 'packs'));
  const manifest = JSON.parse(readFileSync(join(repoRoot, 'dist', 'packs', 'manifest-v1.json'), 'utf8')) as { regions: { id: string; files: { kind: string; size: number }[] }[] };
  const addressBytes = manifest.regions.filter((r) => PRIORITY.includes(r.id)).reduce((sum, r) => sum + (r.files.find((f) => f.kind === 'address')?.size ?? 0), 0);
  const all = { before: [] as number[], after: [] as number[] };
  const gated = { before: [] as number[], after: [] as number[], without: [] as number[] };
  const included: string[] = [];
  let neededBytes = 0;
  let needed = 0;
  const perProvince: Record<string, { ratio: number; before: number; after: number; without: number; qualifies: boolean }> = {};
  const lines = ['# Faz 3 bina eşleştirme deneyi', '', 'Her ilde iki yanında komşusu olan en çok 2.000 adres gizlenir; seçilen varyantın (B) tahmini, 30 m içindeki sahipsiz en yakın bina merkezine çekilir. Sahipsiz: 12 m içinde başka adres noktası yok. "Bina yoksa" sütunu, gizlenen adresin kendi binası haritada yokmuş gibi (3 m içindekiler çıkarılarak) aynı çekmeyi dener; yanlış binaya çekmenin zararını gösterir. Merkez oranı: adres noktalarının yüzde kaçı bir bina merkezinin 3 m içinde (en az yüzde 50 olan ile bina parçası yazılır).', '', '| İl | Adet | Çekilen | Merkez oranı | Önce ortanca | Sonra ortanca | Bina yoksa ortanca | Önce p90 | Sonra p90 | Bina | Bayt | Parça |', '|---|---|---|---|---|---|---|---|---|---|---|---|'];
  for (const plate of PRIORITY) {
    const db = await store.open(plate);
    if (!db) continue;
    const region = await openRegion(db);
    const raw = await db.all<{ id: number; street_id: number; district_id: number; hood_id: number | null; num: number; parity: number; lon: number; lat: number }>('SELECT id, street_id, district_id, hood_id, num, parity, lon, lat FROM address WHERE street_id IS NOT NULL AND num IS NOT NULL AND parity IS NOT NULL ORDER BY id');
    const rows: AddressPoint[] = raw.map((r) => ({ id: r.id, streetId: r.street_id, districtId: r.district_id, hoodId: r.hood_id, num: r.num, parity: r.parity as 0 | 1, lng: r.lon / 1e6, lat: r.lat / 1e6 }));
    const every = (await db.all<{ id: number; lon: number; lat: number }>('SELECT id, lon, lat FROM address ORDER BY id')).map((r) => ({ id: r.id, point: [r.lon / 1e6, r.lat / 1e6] as LngLat }));
    const doors = new Map<number, { id: number; point: LngLat }[]>();
    for (const d of every) doors.set(cellOf(d.point[0], d.point[1]), [...(doors.get(cellOf(d.point[0], d.point[1])) ?? []), d]);
    const claimedBy = (building: Building, ignore: number): boolean => cellsAround([building.lng, building.lat], CLAIM_M).some((cell) => (doors.get(cell) ?? []).some((d) => d.id !== ignore && distanceM(d.point, [building.lng, building.lat]) <= CLAIM_M));
    const buildings = await readBuildings(join(repoRoot, 'dist', 'work', '261020', 'buildings', plate, 'buildings.jsonl'));
    const index = indexBuildings(buildings);
    const ratio = centroidRatio(every.filter((_, i) => i % 37 === 0).slice(0, 4000).map((d) => d.point), index);
    const streetCells = new Set((await db.all<{ cell: number }>('SELECT cell FROM street_cell')).map((r) => r.cell));
    const useful = buildings.filter((b) => {
      const cell = cellOf(b.lng, b.lat);
      return [cell - 65536 - 1, cell - 65536, cell - 65536 + 1, cell - 1, cell, cell + 1, cell + 65536 - 1, cell + 65536, cell + 65536 + 1].some((c) => streetCells.has(c)) && !claimedBy(b, -1);
    });
    const bytes = encodedSize(useful);
    const picked = pickTargets(rows, 2000, 2026).both;
    const b: number[] = [];
    const a: number[] = [];
    const w: number[] = [];
    let moved = 0;
    for (const t of picked) {
      const guess = await predictNumber(region, { id: t.streetId, hoodId: t.hoodId, districtId: t.districtId }, { int: t.num, key: String(t.num), parity: t.parity }, { exclude: new Set([t.id]), parts: await region.partsOf(t.streetId) });
      if (!guess || guess.precision !== 'interpolated') continue;
      const truth: LngLat = [t.lng, t.lat];
      const err = distanceM(guess.coordinate, truth);
      const target = snapToBuilding(guess.coordinate, index, (x) => claimedBy(x, t.id));
      const wrong = snapToBuilding(guess.coordinate, index, (x) => claimedBy(x, t.id) || distanceM([x.lng, x.lat], truth) <= CENTROID_M);
      b.push(err);
      a.push(target ? distanceM(target, truth) : err);
      w.push(wrong ? distanceM(wrong, truth) : err);
      if (target) moved += 1;
    }
    const sb = summarize(b);
    const sa = summarize(a);
    const sw = summarize(w);
    const ok = qualifies(ratio);
    perProvince[plate] = { ratio: Math.round(ratio * 1000) / 1000, before: sb.median, after: sa.median, without: sw.median, qualifies: ok };
    all.before.push(...b);
    all.after.push(...a);
    if (ok) {
      included.push(plate);
      gated.before.push(...b);
      gated.after.push(...a);
      gated.without.push(...w);
      neededBytes += bytes;
      needed += useful.length;
    }
    lines.push(`| ${plate} | ${b.length} | ${moved} | ${(ratio * 100).toFixed(1)} | ${sb.median} | ${sa.median} | ${sw.median} | ${sb.p90} | ${summarize(a).p90} | ${useful.length} | ${bytes} | ${ok ? 'evet' : 'hayır'} |`);
    await db.close();
  }
  const pooledBefore = summarize(all.before);
  const pooledAfter = summarize(all.after);
  const gb = summarize(gated.before);
  const ga = summarize(gated.after);
  const gw = summarize(gated.without);
  const growthPercent = Math.round((neededBytes / addressBytes) * 1e4) / 100;
  const decision = decideAdoption({ medianBefore: gb.median, medianAfter: ga.median, growthPercent });
  const result = { adopt: decision.adopt, rule: { centroidMin: CENTROID_MIN, centroidMeters: CENTROID_M, snapMeters: SNAP_M, claimMeters: CLAIM_M }, included, medianBefore: gb.median, medianAfter: ga.median, medianWithoutBuilding: gw.median, p90Before: gb.p90, p90After: ga.p90, reductionPercent: decision.reductionPercent, growthPercent, neededBuildings: needed, neededBytes, addressBytes, allProvinces: { medianBefore: pooledBefore.median, medianAfter: pooledAfter.median, p90Before: pooledBefore.p90, p90After: pooledAfter.p90 }, perProvince };
  lines.push('', `Bina parçası yazılacak iller: ${included.join(', ')}. Bu illerde toplam ${gated.before.length} hedef: ortanca ${gb.median} m -> ${ga.median} m (yüzde ${decision.reductionPercent} düşüş), p90 ${gb.p90} -> ${ga.p90}; bina yoksa ortanca ${gw.median} m.`, `Bütün 12 il (süzgeçsiz): ortanca ${pooledBefore.median} -> ${pooledAfter.median} m, p90 ${pooledBefore.p90} -> ${pooledAfter.p90}.`, `Bina parçaları ${needed} bina, ${neededBytes} bayt; 12 il adres paketleri ${addressBytes} bayt; büyüme yüzde ${growthPercent}.`, '', `Karar: ${decision.adopt ? 'benimse' : 'benimseme'} (kural: ortanca en az yüzde ${REQUIRED_GAIN} düşer ve paket en çok yüzde ${ALLOWED_GROWTH} büyür).`);
  const dir = join(homedir(), 'Desktop', 'yuksi-geo-raporlar');
  mkdirSync(join(dir, 'faz-3-kararlar'), { recursive: true });
  writeFileSync(join(dir, 'faz-3-bina-deneyi.md'), lines.join('\n') + '\n');
  writeFileSync(join(dir, 'faz-3-kararlar', 'bina-eslestirme.json'), JSON.stringify(result, null, 1) + '\n');
  console.log(lines.join('\n'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    console.error(String(error));
    process.exit(1);
  });
}
