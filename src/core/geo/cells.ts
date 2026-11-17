export type LngLat = [number, number];

export const CELL_SCALE = 500;
const ROW = 65536;
const M_PER_DEGREE = 111_195;

const CELL_E6 = 1_000_000 / CELL_SCALE;
const unit = (degrees: number): number => Math.round(degrees * 1e6) / CELL_E6;

export function cellOf(lon: number, lat: number): number {
  return Math.floor(unit(lat)) * ROW + Math.floor(unit(lon));
}

function touches(x0: number, y0: number, x1: number, y1: number, cx: number, cy: number): boolean {
  let low = 0;
  let high = 1;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const edges: [number, number][] = [[-dx, x0 - cx], [dx, cx + 1 - x0], [-dy, y0 - cy], [dy, cy + 1 - y0]];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) low = Math.max(low, t);
    else high = Math.min(high, t);
    if (low > high) return false;
  }
  return true;
}

export function cellsOfLine(line: LngLat[]): number[] {
  const found = new Set<number>();
  if (line.length === 1) found.add(cellOf(line[0]![0], line[0]![1]));
  for (let i = 0; i + 1 < line.length; i++) {
    const x0 = unit(line[i]![0]);
    const y0 = unit(line[i]![1]);
    const x1 = unit(line[i + 1]![0]);
    const y1 = unit(line[i + 1]![1]);
    const from = [Math.ceil(Math.min(x0, x1)) - 1, Math.ceil(Math.min(y0, y1)) - 1];
    const to = [Math.floor(Math.max(x0, x1)), Math.floor(Math.max(y0, y1))];
    for (let cy = from[1]!; cy <= to[1]!; cy++) for (let cx = from[0]!; cx <= to[0]!; cx++) if (touches(x0, y0, x1, y1, cx, cy)) found.add(cy * ROW + cx);
    found.add(cellOf(line[i]![0], line[i]![1]));
    found.add(cellOf(line[i + 1]![0], line[i + 1]![1]));
  }
  return [...found].sort((a, b) => a - b);
}

export function cellsAround(center: LngLat, radiusM: number): number[] {
  const dLat = radiusM / M_PER_DEGREE;
  const dLon = radiusM / (M_PER_DEGREE * Math.cos((center[1] * Math.PI) / 180));
  const cells: number[] = [];
  for (let cy = Math.floor(unit(center[1] - dLat)); cy <= Math.floor(unit(center[1] + dLat)); cy++)
    for (let cx = Math.floor(unit(center[0] - dLon)); cx <= Math.floor(unit(center[0] + dLon)); cx++) cells.push(cy * ROW + cx);
  return cells;
}
