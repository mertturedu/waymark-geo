import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { repoRoot } from './addr-sets';
import { fitsOf, roadsOf } from './hints-attach';
import { groupsOf } from './hints-overture';

type Ranked = { truth: string; n: number; byReach: Map<number, [string, number][]> };
type Params = { reach: number; minPois: number; minFit: number; margin: number };

const REACH = [15, 20, 25, 30];
const LIKE_MISSING = process.env.POOL === 'unnamed' || process.env.POOL === 'absent';
const ABSENT = process.env.POOL === 'absent';

export function collect(plate: string): Ranked[] {
  const dir = join(repoRoot, 'dist', 'work', '261028', 'packs', plate);
  const roads = roadsOf(plate, true);
  const directory = new DatabaseSync(join(dir, 'directory.sqlite'), { readOnly: true });
  try {
    const out: Ranked[] = [];
    for (const [id, g] of groupsOf(directory)) {
      if (g.pois.length < 3 || !roads.owners.has(id)) continue;
      out.push({ truth: id, n: g.pois.length, byReach: new Map(REACH.map((r) => [r, fitsOf(roads, g.pois, r)])) });
    }
    return out;
  } finally {
    directory.close();
  }
}

export function score(rows: Ranked[], p: Params): { tested: number; picked: number; right: number } {
  let picked = 0;
  let right = 0;
  for (const r of rows) {
    if (r.n < p.minPois) continue;
    const ranked = r.byReach.get(p.reach)!.filter(([owner]) => !LIKE_MISSING || owner.startsWith('unnamed:') || (!ABSENT && owner === r.truth));
    const best = ranked[0];
    if (!best || best[1] < p.minFit) continue;
    const second = ranked[1];
    if (second && second[1] > best[1] - p.margin) continue;
    picked++;
    if (best[0] === r.truth) right++;
  }
  return { tested: rows.filter((r) => r.n >= p.minPois).length, picked, right };
}

function main(): void {
  const tune = (process.argv[2] ?? '20,42').split(',');
  const holdout = (process.argv[3] ?? '35,06,07,16').split(',');
  const sets = [tune, holdout].map((plates) => plates.flatMap((p) => collect(p)));
  const grid: Params[] = [];
  for (const reach of REACH) for (const minPois of [3, 4, 5]) for (const minFit of [0.7, 0.8, 0.9]) for (const margin of [0.2, 0.3, 0.4]) grid.push({ reach, minPois, minFit, margin });
  const results = grid.map((p) => ({ p, a: score(sets[0]!, p), b: score(sets[1]!, p) }));
  const fmt = (s: { tested: number; picked: number; right: number }): string => `${s.right}/${s.picked} %${(100 * s.right / Math.max(1, s.picked)).toFixed(1)} kapsama %${(100 * s.picked / Math.max(1, s.tested)).toFixed(0)}`;
  const good = results.filter((r) => r.a.picked >= 50 && r.a.right / r.a.picked >= 0.95).sort((x, y) => y.a.picked - x.a.picked);
  console.log('ayar kümesi >= %95 olanlar (kapsamaya göre):');
  for (const r of good.slice(0, 8)) console.log(JSON.stringify(r.p), '| ayar', fmt(r.a), '| sınama', fmt(r.b));
  const best = [...results].sort((x, y) => y.a.right / Math.max(1, y.a.picked) - x.a.right / Math.max(1, x.a.picked))[0]!;
  console.log('en yüksek doğruluk', JSON.stringify(best.p), fmt(best.a), fmt(best.b));
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) main();
