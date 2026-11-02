const M_PER_DEGREE = 111_195;
const MICRO = 1e6;
const RAD = Math.PI / 180;

function scales(line: number[]): [number, number] {
  const mLat = M_PER_DEGREE / MICRO;
  return [mLat * Math.cos(((line[1] as number) / MICRO) * RAD), mLat];
}

function lengths(line: number[], mLon: number, mLat: number): number[] {
  const out = [0];
  for (let i = 0; i + 3 < line.length; i += 2) {
    out.push((out[out.length - 1] as number) + Math.hypot(((line[i + 2] as number) - (line[i] as number)) * mLon, ((line[i + 3] as number) - (line[i + 1] as number)) * mLat));
  }
  return out;
}

export function pointAt(line: number[], at: number): [number, number] {
  const [mLon, mLat] = scales(line);
  const along = lengths(line, mLon, mLat);
  const total = along[along.length - 1] as number;
  const target = Math.min(1, Math.max(0, at)) * total;
  for (let i = 1; i < along.length; i++) {
    const end = along[i] as number;
    if (target <= end) {
      const start = along[i - 1] as number;
      const t = end === start ? 0 : (target - start) / (end - start);
      return [(line[2 * i - 2] as number) + ((line[2 * i] as number) - (line[2 * i - 2] as number)) * t, (line[2 * i - 1] as number) + ((line[2 * i + 1] as number) - (line[2 * i - 1] as number)) * t];
    }
  }
  return [line[line.length - 2] as number, line[line.length - 1] as number];
}

export function slice(line: number[], from: number, to: number): number[] {
  const [mLon, mLat] = scales(line);
  const along = lengths(line, mLon, mLat);
  const total = along[along.length - 1] as number;
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  const start = pointAt(line, lo);
  const end = pointAt(line, hi);
  const middle: number[] = [];
  for (let i = 1; i + 1 < along.length; i++) {
    const at = total === 0 ? 0 : (along[i] as number) / total;
    if (at > lo && at < hi) middle.push(line[2 * i] as number, line[2 * i + 1] as number);
  }
  const forward = [start[0], start[1], ...middle, end[0], end[1]];
  if (from <= to) return forward;
  const reversed: number[] = [];
  for (let i = forward.length - 2; i >= 0; i -= 2) reversed.push(forward[i] as number, forward[i + 1] as number);
  return reversed;
}

export function reverse(line: number[]): number[] {
  const out: number[] = [];
  for (let i = line.length - 2; i >= 0; i -= 2) out.push(line[i] as number, line[i + 1] as number);
  return out;
}

export function join(parts: number[][]): number[] {
  const out: number[] = [];
  for (const part of parts) {
    for (let i = 0; i < part.length; i += 2) {
      const n = out.length;
      if (n >= 2 && out[n - 2] === part[i] && out[n - 1] === part[i + 1]) continue;
      out.push(part[i] as number, part[i + 1] as number);
    }
  }
  return out;
}
