import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createNeighbourhoods, hoodKey, type NeighbourhoodShard } from '../src/core/address/neighbourhoods';
import { parseAddress } from '../src/core/text/parse';

const dir = resolve(process.argv[2] ?? 'dist/neighbourhoods');
const read = <T>(name: string): T => JSON.parse(readFileSync(join(dir, name), 'utf8')) as T;
const pct = (values: number[], p: number): number => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * p))] as number;
const ms = (n: number): string => `${n.toFixed(3)} ms`;

const index = read<{ codes: Record<string, string[]>; count: number }>('index.json');
const hoods = createNeighbourhoods({ index: index as never, load: async (plate) => read<NeighbourhoodShard>(`${plate}.json`) });

async function main(): Promise<void> {
  const plates = [...new Set(Object.values(index.codes).flatMap((where) => where.map((w) => w.slice(0, w.indexOf('/')))))].sort();
  const heap = (): number => process.memoryUsage().heapUsed / 1048576;
  global.gc?.();
  const before = heap();

  const loads: number[] = [];
  for (const plate of plates) {
    const t = performance.now();
    await hoods.list(plate);
    loads.push(performance.now() - t);
  }
  console.log(`shard load+index (${plates.length} provinces, cold): p50 ${ms(pct(loads, 0.5))}, p95 ${ms(pct(loads, 0.95))}, max ${ms(Math.max(...loads))}`);

  const samples: { plate: string; district: string; name: string; postcode: string }[] = [];
  for (const plate of plates) {
    const shard = read<NeighbourhoodShard>(`${plate}.json`);
    for (const d of shard.districts) for (const [postcode, names] of d.groups) for (const name of names) samples.push({ plate, district: d.name, name, postcode });
  }
  const pick = samples.filter((_, i) => i % 7 === 0);
  const found: number[] = [];
  let hit = 0;
  let right = 0;
  for (const s of pick) {
    const t = performance.now();
    const matches = await hoods.find(s.plate, s.district, s.name);
    found.push(performance.now() - t);
    if (matches.length > 0) hit++;
    if (matches.some((m) => m.postcode === s.postcode)) right++;
  }
  console.log(`find, ${pick.length} real names: p50 ${ms(pct(found, 0.5))}, p95 ${ms(pct(found, 0.95))}; found ${((hit / pick.length) * 100).toFixed(2)}%, right postcode ${((right / pick.length) * 100).toFixed(2)}%`);

  const typo: number[] = [];
  let suggested = 0;
  let tried = 0;
  for (const s of pick.filter((p) => hoodKey(p.name).replace(/ /g, '').length >= 6).slice(0, 2000)) {
    const key = hoodKey(s.name);
    const broken = `${key.slice(0, 2)}${key.slice(3)}`;
    const t = performance.now();
    const options = await hoods.suggest(s.plate, s.district, broken);
    typo.push(performance.now() - t);
    tried++;
    if (options.some((o) => hoodKey(o) === key)) suggested++;
  }
  console.log(`suggest, ${tried} one-letter-dropped names: p50 ${ms(pct(typo, 0.5))}, p95 ${ms(pct(typo, 0.95))}; right name offered ${((suggested / tried) * 100).toFixed(2)}%`);

  const fills: number[] = [];
  let filled = 0;
  const codes = Object.keys(index.codes).filter((_, i) => i % 3 === 0);
  for (const code of codes) {
    const t = performance.now();
    const parsed = hoods.fillArea(parseAddress(`Atatürk Mahallesi ${code}`));
    fills.push(performance.now() - t);
    if (parsed.province !== null) filled++;
  }
  console.log(`postcode -> province, ${codes.length} codes: p50 ${ms(pct(fills, 0.5))}, p95 ${ms(pct(fills, 0.95))}; province found ${((filled / codes.length) * 100).toFixed(2)}%`);

  global.gc?.();
  console.log(`heap with all ${plates.length} provinces loaded: +${(heap() - before).toFixed(1)} MB (the directory keeps at most 6 provinces; this run loaded them all once)`);
  hoods.clear();
  const small = await (async () => {
    const t = performance.now();
    for (const plate of ['34', '06', '35', '16', '07', '27']) await hoods.list(plate);
    return performance.now() - t;
  })();
  global.gc?.();
  console.log(`6 big provinces in the cache: ${ms(small)} total, heap +${(heap() - before).toFixed(1)} MB over start`);
}

void main();
