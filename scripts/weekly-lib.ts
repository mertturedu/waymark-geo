export type TextSummary = { count: number; found: number; notFound: number; ambiguous: number; within15: number; within30: number; within50: number; median: number; p90: number; streetOk: number; hoodOk: number; districtOk: number };
export type PlacesSummary = { count: number; first: number; top3: number };
export type ReverseSummary = { count: number; street: number; exact: number; near: number };
export type EngineSummary = { covered: number; within30: number; found: number; sdkWithin30: number };
export type Pattern = { key: string; count: number; share: number; example: string };

export type Weekly = {
  tag: string;
  at: string;
  plates: string[];
  sets: { g2: TextSummary; g2a?: TextSummary; g7?: PlacesSummary; g8?: ReverseSummary };
  engines: Record<string, EngineSummary>;
  speedMs: { p50: number; p95: number };
  patterns: Pattern[];
  failing: string[];
};

export type Outcome = { id: string; source: string; ops: string[]; status: string; precision: string | null; errorM: number; streetOk: boolean; hoodOk: boolean | null; districtOk: boolean; ms: number; text?: string };

export const FAIL_M = 50;
export const NOT_FOUND_M = 100_000;
export const MAX_PATTERNS = 12;
export const MAX_FAILING = 400;

export const WEEKLY_LIMITS = {
  textWithin30Drop: 1,
  textStreetDrop: 1,
  textNotFoundRise: 0.5,
  placesTop3Drop: 1.5,
  reverseStreetDrop: 2,
  speedP95Ratio: 1.5,
};

const round = (value: number, digits = 1): number => Math.round(value * 10 ** digits) / 10 ** digits;
const pct = (count: number, total: number): number => (total === 0 ? 0 : round((100 * count) / total));

export function quantile(values: readonly number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] as number;
}

export function summarizeText(outcomes: readonly Outcome[]): TextSummary {
  const total = outcomes.length;
  const hood = outcomes.filter((o) => o.hoodOk !== null);
  const errors = outcomes.map((o) => o.errorM);
  return {
    count: total,
    found: pct(outcomes.filter((o) => o.status !== 'not_found').length, total),
    notFound: pct(outcomes.filter((o) => o.status === 'not_found').length, total),
    ambiguous: pct(outcomes.filter((o) => o.status === 'ambiguous').length, total),
    within15: pct(errors.filter((e) => e <= 15).length, total),
    within30: pct(errors.filter((e) => e <= 30).length, total),
    within50: pct(errors.filter((e) => e <= 50).length, total),
    median: round(quantile(errors, 0.5), 0),
    p90: round(quantile(errors, 0.9), 0),
    streetOk: pct(outcomes.filter((o) => o.streetOk).length, total),
    hoodOk: pct(hood.filter((o) => o.hoodOk === true).length, hood.length),
    districtOk: pct(outcomes.filter((o) => o.districtOk).length, total),
  };
}

export const isFailure = (o: Outcome): boolean => o.status === 'not_found' || o.errorM > FAIL_M;

export function failurePatterns(outcomes: readonly Outcome[]): Pattern[] {
  const failed = outcomes.filter(isFailure);
  const groups = new Map<string, Outcome[]>();
  for (const o of failed) {
    const reason = o.status === 'not_found' ? 'bulunamadı' : o.status === 'ambiguous' ? 'belirsiz' : !o.streetOk ? 'sokak yanlış' : 'nokta uzak';
    const key = `${reason} · ${[...o.ops].sort().join('+') || 'işleçsiz'} · ${o.source === 'business' ? 'işletme kapısı' : 'OSM kapısı'} · ${o.precision ?? 'sonuçsuz'}`;
    const list = groups.get(key);
    if (list) list.push(o);
    else groups.set(key, [o]);
  }
  return [...groups]
    .sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1))
    .slice(0, MAX_PATTERNS)
    .map(([key, list]) => ({ key, count: list.length, share: pct(list.length, failed.length), example: list[0]?.text ?? list[0]?.id ?? '' }));
}

export const failingIds = (outcomes: readonly Outcome[]): string[] => outcomes.filter(isFailure).map((o) => o.id).sort().slice(0, MAX_FAILING);

export type Violation = { metric: string; before: number; after: number; limit: string };

export function compareWeekly(previous: Weekly, next: Weekly, limits = WEEKLY_LIMITS): Violation[] {
  const out: Violation[] = [];
  const drop = (metric: string, before: number, after: number, cap: number): void => {
    if (before - after > cap) out.push({ metric, before, after, limit: `en çok ${cap} puan düşüş` });
  };
  const rise = (metric: string, before: number, after: number, cap: number): void => {
    if (after - before > cap) out.push({ metric, before, after, limit: `en çok ${cap} puan artış` });
  };
  for (const set of ['g2', 'g2a'] as const) {
    const a = previous.sets[set];
    const b = next.sets[set];
    if (!a || !b) continue;
    drop(`${set.toUpperCase()} ≤30 m`, a.within30, b.within30, limits.textWithin30Drop);
    drop(`${set.toUpperCase()} sokak doğru`, a.streetOk, b.streetOk, limits.textStreetDrop);
    rise(`${set.toUpperCase()} bulunamadı`, a.notFound, b.notFound, limits.textNotFoundRise);
  }
  const p = previous.sets.g7;
  const q = next.sets.g7;
  if (p && q) drop('G7 ilk 3te', p.top3, q.top3, limits.placesTop3Drop);
  const r = previous.sets.g8;
  const s = next.sets.g8;
  if (r && s) drop('G8 sokak doğru', r.street, s.street, limits.reverseStreetDrop);
  if (previous.speedMs.p95 > 0 && next.speedMs.p95 / previous.speedMs.p95 > limits.speedP95Ratio) {
    out.push({ metric: 'geocode süresi p95 (ms)', before: previous.speedMs.p95, after: next.speedMs.p95, limit: `en çok ${limits.speedP95Ratio} kat` });
  }
  return out;
}

const delta = (a: number | undefined, b: number): string => (a === undefined ? '-' : `${b - a >= 0 ? '+' : ''}${round(b - a)}`);

export function renderWeekly(next: Weekly, previous: Weekly | null, violations: Violation[]): string {
  const rows = (name: string, b: TextSummary, a?: TextSummary): string[] => [
    `| ${name} ≤15 m | ${b.within15} | ${delta(a?.within15, b.within15)} |`,
    `| ${name} ≤30 m | ${b.within30} | ${delta(a?.within30, b.within30)} |`,
    `| ${name} ≤50 m | ${b.within50} | ${delta(a?.within50, b.within50)} |`,
    `| ${name} sokak doğru | ${b.streetOk} | ${delta(a?.streetOk, b.streetOk)} |`,
    `| ${name} mahalle doğru | ${b.hoodOk} | ${delta(a?.hoodOk, b.hoodOk)} |`,
    `| ${name} bulunamadı | ${b.notFound} | ${delta(a?.notFound, b.notFound)} |`,
    `| ${name} ortanca / p90 (m) | ${b.median} / ${b.p90} | ${a ? `${delta(a.median, b.median)} / ${delta(a.p90, b.p90)}` : '-'} |`,
  ];
  const lines = [
    `# Haftalık ölçüm: ${next.tag}`,
    '',
    `Tarih ${next.at.slice(0, 10)}; iller ${next.plates.join(', ')}; önceki: ${previous ? previous.tag : 'yok (başlangıç noktası)'}.`,
    '',
    `**Kapı sonucu: ${violations.length === 0 ? 'GEÇTİ' : `KALDI (${violations.length} gerileme)`}**`,
    '',
    '| Ölçü | Değer (%) | Önceki haftaya fark (puan) |',
    '|---|---|---|',
    ...rows('G2', next.sets.g2, previous?.sets.g2),
    ...(next.sets.g2a ? rows('G2a', next.sets.g2a, previous?.sets.g2a) : []),
    ...(next.sets.g7 ? [`| G7 ilk sırada | ${next.sets.g7.first} | ${delta(previous?.sets.g7?.first, next.sets.g7.first)} |`, `| G7 ilk 3te | ${next.sets.g7.top3} | ${delta(previous?.sets.g7?.top3, next.sets.g7.top3)} |`] : []),
    ...(next.sets.g8 ? [`| G8 sokak doğru | ${next.sets.g8.street} | ${delta(previous?.sets.g8?.street, next.sets.g8.street)} |`, `| G8 numara tam | ${next.sets.g8.exact} | ${delta(previous?.sets.g8?.exact, next.sets.g8.exact)} |`, `| G8 numara ±2 | ${next.sets.g8.near} | ${delta(previous?.sets.g8?.near, next.sets.g8.near)} |`] : []),
    `| geocode süresi p50 / p95 (ms) | ${next.speedMs.p50} / ${next.speedMs.p95} | ${previous ? `${delta(previous.speedMs.p50, next.speedMs.p50)} / ${delta(previous.speedMs.p95, next.speedMs.p95)}` : '-'} |`,
    '',
  ];
  if (violations.length > 0) {
    lines.push('## Gerilemeler', '', '| Ölçü | Önce | Sonra | Sınır |', '|---|---|---|---|', ...violations.map((v) => `| ${v.metric} | ${v.before} | ${v.after} | ${v.limit} |`), '');
  }
  const engines = Object.entries(next.engines);
  if (engines.length > 0) {
    lines.push('## Kıyas motorları (önbellekteki aynı G2 metinleri)', '', '| Motor | Ortak metin | ≤30 m (%) | SDK ≤30 m (%) | Aynı metinlerde fark (puan) |', '|---|---|---|---|---|');
    for (const [name, e] of engines) lines.push(`| ${name} | ${e.covered} | ${e.within30} | ${e.sdkWithin30} | ${e.covered === 0 ? '-' : delta(e.within30, e.sdkWithin30)} |`);
    lines.push('');
  }
  return lines.join('\n');
}

export function renderQueue(next: Weekly, previous: Weekly | null): string {
  const before = new Set(previous?.failing ?? []);
  const now = new Set(next.failing);
  const appeared = next.failing.filter((id) => !before.has(id));
  const fixed = (previous?.failing ?? []).filter((id) => !now.has(id));
  const lines = [
    `# Farklılık kuyruğu: ${next.tag}`,
    '',
    `Başarısız G2 metni: ${next.failing.length}${next.failing.length >= MAX_FAILING ? ' (üst sınır)' : ''}. Önceki haftaya göre yeni: ${previous ? appeared.length : '-'}, düzelen: ${previous ? fixed.length : '-'}.`,
    '',
    '## En sık başarısız kalıplar',
    '',
    '| Kalıp (neden · işleç · kaynak · sonuç düzeyi) | Adet | Pay (%) | Örnek |',
    '|---|---|---|---|',
    ...next.patterns.map((p) => `| ${p.key} | ${p.count} | ${p.share} | ${p.example.replace(/\|/g, '/')} |`),
    '',
  ];
  if (previous && appeared.length > 0) lines.push('## Bu hafta yeni başarısız olanlar (ilk 30)', '', ...appeared.slice(0, 30).map((id) => `- ${id}`), '');
  return lines.join('\n');
}
