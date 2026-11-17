const MICRO = 1e6;
const NEAR_DEG = 0.01;
const WIDE_DEG = 0.05;

const cellKey = (lon: number, lat: number, size: number): number => Math.floor(lon / MICRO / size) * 100_000 + Math.floor(lat / MICRO / size);

export type Density = { near(lon: number, lat: number): number; wide(lon: number, lat: number): number };

export function junctionDensity(nodeLon: ArrayLike<number>, nodeLat: ArrayLike<number>, isJunction: (v: number) => boolean): Density {
  const near = new Map<number, number>();
  const wide = new Map<number, number>();
  for (let v = 0; v < nodeLon.length; v++) {
    if (!isJunction(v)) continue;
    const lon = nodeLon[v] as number;
    const lat = nodeLat[v] as number;
    const a = cellKey(lon, lat, NEAR_DEG);
    near.set(a, (near.get(a) ?? 0) + 1);
    const b = cellKey(lon, lat, WIDE_DEG);
    wide.set(b, (wide.get(b) ?? 0) + 1);
  }
  return {
    near(lon, lat) {
      const x = Math.floor(lon / MICRO / NEAR_DEG);
      const y = Math.floor(lat / MICRO / NEAR_DEG);
      let sum = 0;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) sum += near.get((x + dx) * 100_000 + y + dy) ?? 0;
      return sum / 9;
    },
    wide: (lon, lat) => wide.get(cellKey(lon, lat, WIDE_DEG)) ?? 0,
  };
}
