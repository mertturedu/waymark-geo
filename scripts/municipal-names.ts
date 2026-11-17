import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { streetKey } from '../src/core/text/street';
import { repoRoot } from './addr-sets';
import type { Site } from './municipal-discover';
import { cacheDir } from './municipal-harvest';
import { hoodKey, streetMentions } from './municipal-lib';
import { districtOf, hoodIndexOf, type HoodIndex } from './municipal-read';

export type NameClaim = { name: string; kind: string; district: string; hood: string; street: string; number: string | null; page: string; quote: string };

const WORD = "[A-ZÇĞİÖŞÜ][\\p{L}0-9'’.-]*";
const KIND = '(Sitesi|Sit\\.|Apartmanı|Apt\\.|Evleri|Konutları|Plaza|Plazası|İş Merkezi|İşmerkezi|Residence|Rezidans|Blokları|Çarşısı|Pasajı|Han[ıi])';
const NAME = new RegExp(`((?:${WORD} ){1,3})${KIND}(?![\\p{L}])`, 'gu');
const NOISE = /^(bu|belediye|resmi|resmî|internet|web|kaymakaml|valilik|ilgili|tüm|diğer|her|bir|ve|ile)\b/i;
const NOISE_ANY = /belediye|kaymakaml|internet|web|valilik|e-devlet/i;
const LEAD = /^(?:(?:Cad|Cd|Sk|Sok|Mah|Mh|Bulv?|Blv)\.?|Caddesi|Sokağı|Sokak|Cadde|Bulvarı|Mahallesi|Mahalle)\s+/i;
const NUMBER = /\b(?:No|N)\s*[:.]?\s*(\d+(?:[/-]\w+)?)/i;

export function nameClaims(text: string, site: Site, index: HoodIndex, hoods: Set<string>, page: string): NameClaim[] {
  const out: NameClaim[] = [];
  for (const m of streetMentions(text)) {
    if (!m.hood || !hoods.has(hoodKey(m.hood))) continue;
    const district = districtOf(site, index, m.hood, m.passage);
    if (!district) continue;
    for (const n of m.passage.matchAll(NAME)) {
      let lead = n[1]!.trim();
      while (LEAD.test(lead)) lead = lead.replace(LEAD, '');
      const name = `${lead} ${n[2]!}`;
      if (lead === '' || NOISE.test(name) || NOISE_ANY.test(name) || name.length > 48 || name.length < 6) continue;
      const number = NUMBER.exec(m.passage)?.[1] ?? null;
      out.push({ name, kind: n[2]!.replace(/[ıi]$/, '').toLowerCase(), district, hood: m.hood, street: m.street, number, page, quote: m.passage.slice(0, 200) });
    }
  }
  return out;
}

function main(): void {
  const state = JSON.parse(readFileSync(join(repoRoot, 'dist', 'municipal', 'state.json'), 'utf8')) as { plates: Record<string, { status: string; sites: Site[] }> };
  const outDir = join(repoRoot, 'dist', 'municipal', 'names');
  mkdirSync(outDir, { recursive: true });
  let total = 0;
  for (const [plate, p] of Object.entries(state.plates)) {
    if (p.status !== 'done') continue;
    const index = hoodIndexOf(plate);
    const hoods = new Set(index.byKey.keys());
    const by = new Map<string, { c: NameClaim; pages: Set<string>; sid: string | null }>();
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
        for (const c of nameClaims(page.text, site, index, hoods, page.url)) {
          const id = `${c.district}|${hoodKey(c.hood)}|${streetKey(c.street).key}|${hoodKey(c.name)}`;
          const e = by.get(id) ?? { c, pages: new Set<string>(), sid: index.byKey.get(hoodKey(c.hood))?.find((o) => o.district === c.district)?.sid ?? null };
          e.pages.add(`${site.domain}|${c.page}`);
          by.set(id, e);
        }
      }
    }
    const lines = [...by.values()].map((e) => JSON.stringify({ plate, district: e.c.district, hood: e.c.hood, sid: e.sid, street: e.c.street, number: e.c.number, name: e.c.name, kind: e.c.kind, sources: e.pages.size, pages: [...e.pages].slice(0, 3), quote: e.c.quote }));
    writeFileSync(join(outDir, `${plate}.jsonl`), lines.join('\n') + (lines.length ? '\n' : ''));
    total += lines.length;
    console.log(`${plate}: ${lines.length} yapı adı (${[...by.values()].filter((e) => e.c.number).length} tanesi numaralı)`);
  }
  console.log(`toplam ${total}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
