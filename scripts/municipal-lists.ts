import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { streetKey } from '../src/core/text/street';
import { repoRoot } from './addr-sets';
import type { Site } from './municipal-discover';
import { cacheDir } from './municipal-harvest';
import { hoodKey, streetMentions } from './municipal-lib';
import { districtOf, hoodIndexOf, type HoodIndex } from './municipal-read';
import { readdirSync } from 'node:fs';

const HEADING = /^([\p{L}0-9'’. -]{3,48}?)\s+(?:mahallesi|mahalle|mah\.|mah|mh\.|mh)\s*:?$/iu;
const SKIP_PAGE = /vefat|cenaze|taziye|olum/i;

export type ListClaim = { page: string; district: string; hood: string; street: string; key: string; quote: string; block: number };

const MIN_BLOCK = 3;

const titleCase = (line: string): string => {
  const letters = line.replace(/[^\p{L}]/gu, '');
  if (letters.length === 0 || letters !== letters.toLocaleUpperCase('tr')) return line;
  return line.toLocaleLowerCase('tr').replace(/(^|[\s(-])(\p{L})/gu, (_m, a: string, b: string) => `${a}${b.toLocaleUpperCase('tr')}`);
};

const clean = (line: string): string => line.replace(/^[\s\-*•·\d.)]+(?=\p{L})/u, '').replace(/[\s,;.]+$/u, '');

export function listClaims(page: { url: string; text: string }, site: Site, index: HoodIndex, hoods: Set<string>): ListClaim[] {
  if (SKIP_PAGE.test(page.url)) return [];
  const out: ListClaim[] = [];
  let hood: string | null = null;
  let heading = '';
  let block: ListClaim[] = [];
  const close = (): void => {
    if (block.length >= MIN_BLOCK) for (const c of block) out.push({ ...c, block: block.length });
    block = [];
  };
  for (const raw of page.text.split('\n')) {
    const line = raw.trim();
    if (line === '') continue;
    const h = HEADING.exec(line);
    if (h && hoods.has(hoodKey(h[1]!))) {
      close();
      hood = h[1]!.trim();
      heading = line;
      continue;
    }
    if (hood === null) continue;
    const text = clean(titleCase(line));
    const found = line.length <= 80 ? streetMentions(text) : [];
    const only = found.length === 1 && !found[0]!.hood && found[0]!.street.length >= text.length * 0.8 ? found[0]! : null;
    const district = only ? districtOf(site, index, hood, `${heading} ${line}`) : null;
    const key = only ? streetKey(only.street).key : '';
    if (!only || !district || key === '') {
      close();
      hood = null;
      continue;
    }
    block.push({ page: page.url, district, hood, street: only.street, key, quote: `${heading} | ${line}`.slice(0, 200), block: 0 });
  }
  close();
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const state = JSON.parse(readFileSync(join(repoRoot, 'dist', 'municipal', 'state.json'), 'utf8')) as { plates: Record<string, { status: string; sites: Site[] }> };
  const outDir = join(repoRoot, 'dist', 'municipal', 'hints-lists');
  mkdirSync(outDir, { recursive: true });
  let total = 0;
  for (const [plate, p] of Object.entries(state.plates)) {
    if (p.status !== 'done') continue;
    const index = hoodIndexOf(plate);
    const hoods = new Set(index.byKey.keys());
    const by = new Map<string, { claim: ListClaim; pages: Set<string>; quotes: string[]; sid: string | null }>();
    for (const site of p.sites) {
      const dir = cacheDir(site.domain);
      if (!existsSync(dir)) continue;
      for (const f of readdirSync(dir)) {
        if (f === 'urls.json' || !f.endsWith('.json')) continue;
        let page: { url: string; text: string };
        try {
          page = JSON.parse(readFileSync(join(dir, f), 'utf8')) as { url: string; text: string };
        } catch {
          continue;
        }
        for (const c of listClaims(page, site, index, hoods)) {
          const id = `${c.district}|${hoodKey(c.hood)}|${c.key}`;
          const e = by.get(id) ?? { claim: c, pages: new Set<string>(), quotes: [], sid: index.byKey.get(hoodKey(c.hood))?.find((o) => o.district === c.district)?.sid ?? null };
          e.pages.add(`${site.domain}|${c.page}`);
          if (e.quotes.length < 2) e.quotes.push(c.quote);
          by.set(id, e);
        }
      }
    }
    const lines = [...by.values()].map((e) => JSON.stringify({ plate, district: e.claim.district, hood: e.claim.hood, sid: e.sid, street: e.claim.street, key: e.claim.key, sources: e.pages.size, via: ['liste'], block: e.claim.block, pages: [...e.pages].slice(0, 5), quotes: e.quotes }));
    writeFileSync(join(outDir, `${plate}.jsonl`), lines.join('\n') + (lines.length ? '\n' : ''));
    total += lines.length;
    console.log(`${plate}: ${lines.length} liste kanıtı (${[...by.values()].filter((e) => e.pages.size >= 2).length} tanesi ≥ 2 kaynak)`);
  }
  console.log(`toplam ${total}`);
}
