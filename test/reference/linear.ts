type Pt = [number, number];

const M = 111_195;

function local(p: Pt, origin: Pt): Pt {
  return [(p[0] - origin[0]) * Math.cos((origin[1] * Math.PI) / 180) * M, (p[1] - origin[1]) * M];
}

function walkOf(point: Pt, line: Pt[]): number {
  let best = Infinity;
  let walked = 0;
  let result = 0;
  for (let i = 0; i + 1 < line.length; i++) {
    const a = local(line[i] as Pt, point);
    const b = local(line[i + 1] as Pt, point);
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const length = Math.hypot(dx, dy);
    const t = length === 0 ? 0 : Math.max(0, Math.min(1, -(a[0] * dx + a[1] * dy) / (length * length)));
    const away = Math.hypot(a[0] + dx * t, a[1] + dy * t);
    if (away < best) {
      best = away;
      result = walked + t * length;
    }
    walked += length;
  }
  return result;
}

function atWalk(line: Pt[], walk: number): Pt {
  let walked = 0;
  for (let i = 0; i + 1 < line.length; i++) {
    const a = line[i] as Pt;
    const b = line[i + 1] as Pt;
    const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const la = local(a, mid);
    const lb = local(b, mid);
    const length = Math.hypot(lb[0] - la[0], lb[1] - la[1]);
    if (walk <= walked + length || i + 2 === line.length) {
      const t = length === 0 ? 0 : Math.max(0, Math.min(1, (walk - walked) / length));
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    walked += length;
  }
  return line[0] as Pt;
}

export function linearBaseline(neighbours: { int: number; point: Pt }[], line: Pt[], target: number): Pt | null {
  if (line.length < 2) return null;
  const lower = neighbours.filter((n) => n.int < target).sort((a, b) => b.int - a.int)[0];
  const upper = neighbours.filter((n) => n.int > target).sort((a, b) => a.int - b.int)[0];
  if (!lower || !upper) return null;
  const from = walkOf(lower.point, line);
  const to = walkOf(upper.point, line);
  const t = (target - lower.int) / (upper.int - lower.int);
  return atWalk(line, from + t * (to - from));
}
