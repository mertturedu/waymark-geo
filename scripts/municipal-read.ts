import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ask } from '../tools/ollama';
import { repoRoot } from './addr-sets';
import type { Site } from './municipal-discover';
import { harvest, type HarvestOptions } from './municipal-harvest';
import { aggregate, hoodKey, streetMentions, verifyClaim, type Claim, type Support } from './municipal-lib';

const MODEL = 'qwen3:14b';
const SCHEMA = {
  type: 'object',
  properties: { items: { type: 'array', items: { type: 'object', properties: { street: { type: 'string' }, hood: { type: 'string' }, quote: { type: 'string' } }, required: ['street', 'hood', 'quote'] } } },
  required: ['items'],
} as const;
const SYSTEM =
  'Türkiye belediyesi metninden yalnızca metinde açıkça yazan sokak, cadde ya da bulvar adlarını ve bulundukları mahalleyi çıkar. street=sokak/cadde/bulvar adı türüyle, hood=mahalle adı (Mahallesi eki olmadan), quote=metinden BİREBİR kopyalanmış, hem sokak adını hem mahalle adını içeren kısa parça. Mahalle metinde o sokakla birlikte geçmiyorsa o öğeyi hiç yazma. Tahmin etme, bilgi ekleme. Yoksa items boş dizi olsun.';

export type HoodIndex = { byKey: Map<string, { district: string; sid: string | null }[]>; districts: Set<string> };
export type Row = { page: string; claim: Claim; via: 'qwen' | 'kural'; verdict: string; district: string | null; boiler: boolean };
export type SiteResult = { domain: string; plate: string; kind: Site['kind']; pages: number; passages: number; qwenCalls: number; rows: Row[]; at: string };

const claimsDir = join(repoRoot, 'dist', 'municipal', 'claims');
const packs = join(repoRoot, 'dist', 'work', '261028', 'packs');

export function hoodIndexOf(plate: string): HoodIndex {
  const db = new DatabaseSync(join(packs, plate, 'address.sqlite'), { readOnly: true });
  try {
    const rows = db.prepare('SELECT h.name name, h.extra extra, h.sid sid, d.name district FROM neighbourhood h JOIN district d ON d.id = h.district_id').all() as { name: string; extra: string; sid: string | null; district: string }[];
    const byKey = new Map<string, { district: string; sid: string | null }[]>();
    for (const r of rows) {
      const names = [r.name, ...((JSON.parse(r.extra) as { alt?: string[] }).alt ?? [])];
      for (const n of names) {
        if (!n) continue;
        const key = hoodKey(n);
        const list = byKey.get(key) ?? [];
        if (!list.some((x) => x.district === r.district)) list.push({ district: r.district, sid: r.sid });
        byKey.set(key, list);
      }
    }
    return { byKey, districts: new Set(rows.map((r) => r.district)) };
  } finally {
    db.close();
  }
}

export const hoodSet = (index: HoodIndex): Set<string> => new Set(index.byKey.keys());

export function districtOf(site: Site, index: HoodIndex, hood: string, passage: string): string | null {
  const options = index.byKey.get(hoodKey(hood));
  if (!options || options.length === 0) return null;
  const siteDistrict = site.kind === 'belediye' || site.kind === 'kaymakamlik' ? [...index.districts].find((d) => hoodKey(d) === hoodKey(site.name)) : undefined;
  if (siteDistrict) return options.some((o) => o.district === siteDistrict) ? siteDistrict : null;
  const fold = hoodKey(passage);
  const named = options.filter((o) => fold.includes(hoodKey(o.district)));
  if (named.length === 1) return named[0]!.district;
  return options.length === 1 ? options[0]!.district : null;
}

const resultFile = (site: Site): string => join(claimsDir, `${createHash('sha1').update(site.domain).digest('hex').slice(0, 12)}.json`);

export function loadResult(site: Site): SiteResult | null {
  const file = resultFile(site);
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as SiteResult) : null;
}

export async function readSite(site: Site, options: HarvestOptions & { maxQwen?: number } = {}): Promise<SiteResult> {
  const { pages } = await harvest(site.domain, options);
  const index = hoodIndexOf(site.plate);
  const hoods = hoodSet(index);
  const passageCount = new Map<string, number>();
  const mentionsOf = pages.map((page) => ({ page, mentions: streetMentions(page.text) }));
  for (const { mentions } of mentionsOf) for (const m of new Set(mentions.map((x) => x.passage))) passageCount.set(m, (passageCount.get(m) ?? 0) + 1);
  const rows: Row[] = [];
  const seen = new Set<string>();
  let passages = 0;
  let qwenCalls = 0;
  for (const { page, mentions } of mentionsOf) {
    for (const m of mentions) {
      const boiler = (passageCount.get(m.passage) ?? 0) > 3;
      const pageId = boiler ? `boiler:${createHash('sha1').update(m.passage).digest('hex').slice(0, 10)}` : page.url;
      if (seen.has(`${pageId}|${m.passage}`)) continue;
      seen.add(`${pageId}|${m.passage}`);
      passages++;
      const folded = hoodKey(m.passage);
      if (m.hood && hoods.has(hoodKey(m.hood))) {
        const at = m.passage.toLowerCase().indexOf(m.hood.toLowerCase());
        const claim = { street: m.street, hood: m.hood, quote: m.passage.slice(Math.max(0, at), Math.max(0, at) + 160) };
        const verdict = verifyClaim(claim, m.passage, hoods);
        const district = verdict.ok ? districtOf(site, index, m.hood, m.passage) : null;
        rows.push({ page: pageId, claim, via: 'kural', verdict: verdict.ok && !district ? 'mahalle bu ilçede değil ya da belirsiz' : verdict.reason, district, boiler });
        continue;
      }
      if (qwenCalls >= (options.maxQwen ?? 400) || ![...hoods].some((h) => h.length >= 4 && folded.includes(h))) continue;
      qwenCalls++;
      const out = await ask<{ items: Claim[] }>(MODEL, SYSTEM, m.passage, SCHEMA, { numPredict: 300 }).catch(() => null);
      for (const claim of out?.items ?? []) {
        const verdict = verifyClaim(claim, m.passage, hoods);
        const district = verdict.ok ? districtOf(site, index, claim.hood, m.passage) : null;
        rows.push({ page: pageId, claim, via: 'qwen', verdict: verdict.ok && !district ? 'mahalle bu ilçede değil ya da belirsiz' : verdict.reason, district, boiler });
      }
    }
  }
  const result: SiteResult = { domain: site.domain, plate: site.plate, kind: site.kind, pages: pages.length, passages, qwenCalls, rows, at: new Date().toISOString() };
  mkdirSync(claimsDir, { recursive: true });
  writeFileSync(resultFile(site), JSON.stringify(result));
  return result;
}

export function supports(rows: Row[]): (Support & { district: string; via: string[] })[] {
  const ok = rows.filter((r) => r.verdict === 'ok' && r.district);
  const out = aggregate(ok.map((r) => ({ claim: { ...r.claim, hood: `${r.district}/${r.claim.hood}` }, page: r.page })));
  return out.map((s) => {
    const [district, hood] = [s.hood.slice(0, s.hood.indexOf('/')), s.hood.slice(s.hood.indexOf('/') + 1)];
    return { ...s, hood, district, via: [...new Set(ok.filter((r) => r.district === district && hoodKey(r.claim.hood) === hoodKey(hood) && r.claim.street === s.street).map((r) => r.via))] };
  });
}
