import { nameKey } from '../src/core/text';
import { streetKey } from '../src/core/text/street';

export type Mention = { street: string; hood: string | null; passage: string };
export type Claim = { street: string; hood: string; quote: string };
export type Verdict = { ok: boolean; reason: string };
export type Support = { hood: string; street: string; key: string; pages: string[]; quotes: string[] };

const KINDS = 'Sokağı|Sokağına|Sokağında|Sokağının|Sokak|Caddesi|Caddesine|Caddesinde|Caddesinin|Cadde|Bulvarı|Bulvarına|Bulvarında|Bulvar|Sk\\.|Cd\\.|Cad\\.|Bul\\.|Bulv\\.';
const WORD = "[A-ZÇĞİÖŞÜ][\\p{L}'’.]*|\\d+[.]?";
const STREET = new RegExp(`((?:(?:${WORD}) ){1,4})(${KINDS})(?![\\p{L}])`, 'gu');
const HOOD = new RegExp(`((?:(?:${WORD}) ){0,2}(?:${WORD})) (?:Mahallesi|Mahallesinde|Mahallesindeki|Mahallesine|Mahalle|Mah\\.|Mh\\.)(?![\\p{L}])`, 'gu');

const STOP = new Set(['ve', 'ile', 'için', 'bu', 'bir', 'olan', 'kadar']);

export function htmlToText(html: string): string {
  const stripped = html.replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d|td)>/gi, '\n').replace(/<[^>]+>/g, ' ');
  const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  const decoded = stripped.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return entities[e.toLowerCase()] ?? m;
  });
  return decoded.split('\n').map((l) => l.replace(/[ \t\u00a0]+/g, ' ').trim()).filter(Boolean).join('\n');
}

export function parseSitemap(xml: string): { urls: string[]; sitemaps: string[] } {
  const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]!.replace(/&amp;/g, '&'));
  const isIndex = /<sitemapindex/i.test(xml);
  return isIndex ? { urls: [], sitemaps: locs } : { urls: locs.filter((u) => !/\.xml(\.gz)?$/i.test(u)), sitemaps: locs.filter((u) => /\.xml(\.gz)?$/i.test(u)) };
}

export function robotsDisallow(robots: string): string[] {
  const rules: string[] = [];
  let applies = false;
  for (const raw of robots.split('\n')) {
    const line = raw.split('#')[0]!.trim();
    const [key, ...rest] = line.split(':');
    const value = rest.join(':').trim();
    if (/^user-agent$/i.test(key ?? '')) applies = value === '*';
    else if (applies && /^disallow$/i.test(key ?? '') && value !== '') rules.push(value);
  }
  return rules;
}

export const allowedByRobots = (path: string, disallow: string[]): boolean => !disallow.some((rule) => path.startsWith(rule.replace(/\*$/, '')));

const nameTokens = (prefix: string): string[] => {
  const tokens = prefix.trim().split(' ');
  const kept: string[] = [];
  for (let i = tokens.length - 1; i >= 0; i--) {
    const t = tokens[i]!;
    if (STOP.has(t.toLowerCase()) || /^(Mahallesi?|Mah\.|Mh\.)$/.test(t)) break;
    kept.unshift(t);
  }
  return kept;
};

export function streetMentions(text: string): Mention[] {
  const out: Mention[] = [];
  for (const line of text.split('\n')) {
    if (line.length > 1200) continue;
    const hoods = [...line.matchAll(HOOD)].map((m) => ({ at: m.index ?? 0, name: m[1]!.trim() }));
    for (const m of line.matchAll(STREET)) {
      const tokens = nameTokens(m[1]!);
      if (tokens.length === 0) continue;
      const kind = m[2]!.replace(/[ıi]n?(a|da|ı)?$/, '').toLowerCase().startsWith('c') ? 'Caddesi' : /^b/i.test(m[2]!) ? 'Bulvarı' : 'Sokağı';
      const street = `${tokens.join(' ')} ${kind}`;
      const at = m.index ?? 0;
      const near = hoods.filter((h) => Math.abs(h.at - at) <= 160).sort((a, b) => Math.abs(a.at - at) - Math.abs(b.at - at))[0];
      const hood = near ? cleanHood(near.name) : null;
      const from = Math.max(0, at - 220);
      out.push({ street, hood, passage: line.slice(from, Math.min(line.length, at + (m[0]?.length ?? 0) + 220)).trim() });
    }
  }
  return out;
}

const cleanHood = (name: string): string => name.split(' ').filter((t) => !STOP.has(t.toLowerCase())).join(' ');

const fold = (s: string): string => nameKey(s).replace(/ /g, '');

export function verifyClaim(claim: Claim, passage: string, hoodNames: Set<string>): Verdict {
  const p = fold(passage);
  const q = fold(claim.quote);
  if (q.length < 8 || !p.includes(q)) return { ok: false, reason: 'alıntı metinde yok' };
  const s = streetKey(claim.street);
  if (s.key === '' || s.numberOnly) return { ok: false, reason: 'sokak adı boş ya da yalnız numara' };
  if (!q.includes(fold(s.key))) return { ok: false, reason: 'sokak adı alıntıda yok' };
  const hood = fold(claim.hood);
  if (hood === '' || !q.includes(hood)) return { ok: false, reason: 'mahalle alıntıda yok' };
  if (!hoodNames.has(hood)) return { ok: false, reason: 'mahalle resmî listede yok' };
  return { ok: true, reason: 'ok' };
}

export function aggregate(items: { claim: Claim; page: string }[]): Support[] {
  const by = new Map<string, Support>();
  for (const { claim, page } of items) {
    const key = `${fold(claim.hood)}|${streetKey(claim.street).key}`;
    const s = by.get(key) ?? { hood: claim.hood, street: claim.street, key: streetKey(claim.street).key, pages: [], quotes: [] };
    if (!s.pages.includes(page)) {
      s.pages.push(page);
      s.quotes.push(claim.quote);
    }
    by.set(key, s);
  }
  return [...by.values()].sort((a, b) => b.pages.length - a.pages.length);
}

export const hoodKey = (s: string): string => fold(s);
