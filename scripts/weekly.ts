import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { distanceM } from '../src/core/geo/distance';
import { streetKey } from '../src/core/text/street';
import { peek } from '../tools/compare/cache';
import { evalText, openSearch } from './addr-eval';
import type { PlaceRecord } from './addr-g7g8';
import { DATA_VERSION, readSet, type Door, type TextRecord } from './addr-sets';
import { compareWeekly, failingIds, failurePatterns, quantile, renderQueue, renderWeekly, summarizeText, type EngineSummary, type Outcome, type Violation, type Weekly } from './weekly-lib';

export const WEEKLY_PLATES = ['34', '06', '35', '41', '16'];
export const DEFAULT_CAP = 300;
export const weeklyDir = (): string => join(homedir(), 'Desktop', 'yuksi-geo-raporlar', 'haftalik');

const arg = (name: string): string | undefined => {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : undefined;
};

const head = <T>(list: T[], cap: number): T[] => {
  if (list.length <= cap) return list;
  const step = list.length / cap;
  return Array.from({ length: cap }, (_, i) => list[Math.floor(i * step)] as T);
};

export async function measure(tag: string, plates: string[], cap: number): Promise<Weekly> {
  const search = await openSearch(tag, true, plates);
  const noDirectory = await openSearch(tag, false, plates);
  const g2: Outcome[] = [];
  const g2a: Outcome[] = [];
  const texts = new Map<string, TextRecord>();
  let placesTotal = 0;
  let first = 0;
  let top3 = 0;
  let revTotal = 0;
  let revStreet = 0;
  let revExact = 0;
  let revNear = 0;
  for (const plate of plates) {
    for (const record of head(readSet<TextRecord>('g2', plate), cap)) {
      const o = await evalText(search, record);
      g2.push({ ...o, text: record.text });
      texts.set(record.id, record);
    }
    for (const record of head(readSet<TextRecord>('g2a', plate), Math.floor(cap / 2))) g2a.push({ ...(await evalText(search, record)), text: record.text });
    for (const r of head(readSet<PlaceRecord>('g7', plate), Math.floor(cap / 2))) {
      const result = await search.resolve(r.text);
      const candidates = result.status === 'region_missing' ? [] : result.candidates;
      const index = candidates.findIndex((c) => distanceM(c.coordinate, [r.lng, r.lat]) <= 30);
      placesTotal += 1;
      if (index === 0) first += 1;
      if (index >= 0 && index < 3) top3 += 1;
    }
    for (const r of head(readSet<Door>('g8', plate), Math.floor(cap / 2))) {
      revTotal += 1;
      const place = await noDirectory.reverse([r.lng, r.lat]);
      if (!place?.components.street || streetKey(place.components.street).key !== streetKey(r.street).key) continue;
      revStreet += 1;
      const got = Number.parseInt(place.components.houseNumber ?? '', 10);
      if (place.components.houseNumber?.toLocaleLowerCase('tr-TR') === r.number.toLocaleLowerCase('tr-TR')) revExact += 1;
      if (Number.isFinite(got) && got % 2 === r.num % 2 && Math.abs(got - r.num) <= 2) revNear += 1;
    }
    search.invalidate(plate);
    noDirectory.invalidate(plate);
  }
  const engines: Record<string, EngineSummary> = {};
  for (const name of ['nominatim', 'photon']) {
    let covered = 0;
    let found = 0;
    let within = 0;
    let sdkWithin = 0;
    for (const o of g2) {
      const hit = peek(name, texts.get(o.id)?.text ?? '');
      if (!hit) continue;
      covered += 1;
      if (hit.found) found += 1;
      const truth = texts.get(o.id) as TextRecord;
      if (hit.point && distanceM(hit.point, [truth.lng, truth.lat]) <= 30) within += 1;
      if (o.errorM <= 30) sdkWithin += 1;
    }
    if (covered > 0) engines[name] = { covered, found: Math.round((1000 * found) / covered) / 10, within30: Math.round((1000 * within) / covered) / 10, sdkWithin30: Math.round((1000 * sdkWithin) / covered) / 10 };
  }
  const ms = g2.map((o) => o.ms);
  const pct = (a: number, b: number): number => (b === 0 ? 0 : Math.round((1000 * a) / b) / 10);
  return {
    tag,
    at: new Date().toISOString(),
    plates,
    sets: {
      g2: summarizeText(g2),
      ...(g2a.length > 0 ? { g2a: summarizeText(g2a) } : {}),
      ...(placesTotal > 0 ? { g7: { count: placesTotal, first: pct(first, placesTotal), top3: pct(top3, placesTotal) } } : {}),
      ...(revTotal > 0 ? { g8: { count: revTotal, street: pct(revStreet, revTotal), exact: pct(revExact, revTotal), near: pct(revNear, revTotal) } } : {}),
    },
    engines,
    speedMs: { p50: Math.round(quantile(ms, 0.5) * 10) / 10, p95: Math.round(quantile(ms, 0.95) * 10) / 10 },
    patterns: failurePatterns(g2),
    failing: failingIds(g2),
  };
}

export function previousWeekly(dir: string, tag: string): Weekly | null {
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => f.endsWith('.json') && !f.startsWith(`${tag}.`)).sort();
  const last = files[files.length - 1];
  return last ? (JSON.parse(readFileSync(join(dir, last), 'utf8')) as Weekly) : null;
}

export type WeeklyResult = { weekly: Weekly; previous: Weekly | null; violations: Violation[] };

export async function runWeekly(tag: string, plates: string[], cap: number, dir = weeklyDir(), options: { baseline?: string; save?: boolean } = {}): Promise<WeeklyResult> {
  const weekly = await measure(tag, plates, cap);
  const previous = options.baseline ? (JSON.parse(readFileSync(options.baseline, 'utf8')) as Weekly) : previousWeekly(dir, tag);
  const violations = previous ? compareWeekly(previous, weekly) : [];
  if (options.save !== false) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${tag}.json`), JSON.stringify(weekly));
    writeFileSync(join(dir, `${tag}.md`), renderWeekly(weekly, previous, violations));
    writeFileSync(join(dir, `farklilik-${tag}.md`), renderQueue(weekly, previous));
  }
  return { weekly, previous, violations };
}

async function main(): Promise<number> {
  const tag = arg('--tag') ?? DATA_VERSION;
  const plates = (arg('--plates') ?? WEEKLY_PLATES.join(',')).split(',');
  const cap = Number(arg('--cap') ?? DEFAULT_CAP);
  const baseline = arg('--baseline');
  const dir = arg('--out') ?? weeklyDir();
  const { weekly, previous, violations } = await runWeekly(tag, plates, cap, dir, baseline ? { baseline } : {});
  console.log(renderWeekly(weekly, previous, violations));
  if (violations.length > 0 && !process.argv.includes('--approve-regressions')) {
    console.error(`gerileme kapısı (K18.2) tutmadı: ${violations.length} gerileme; açıklanıp onaylanana kadar yayın durur (--approve-regressions)`);
    return 1;
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main().then((code) => process.exit(code));
