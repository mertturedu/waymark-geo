import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { repoRoot } from './addr-sets';
import { allowedByRobots, htmlToText, parseSitemap, robotsDisallow } from './municipal-lib';

export type Page = { url: string; text: string };
export type HarvestOptions = { limit?: number; delayMs?: number; budgetMs?: number; maxPdf?: number };
export type HarvestResult = { pages: Page[]; fetched: number; cached: number; failed: number; pdfs: number; stoppedByBudget: boolean };

const USER_AGENT = 'yuksi-geo-research/1.0 (address data study)';
const SKIP = /\.(jpe?g|png|gif|webp|svg|docx?|xlsx?|zip|rar|mp[34]|css|js|ico)(\?|$)/i;
export const PDF = /\.pdf(\?|$)/i;
const WORTH = /karar|meclis|imar|ilan|duyuru|haber|yol|asfalt|sokak|cadde|bulvar|plan|ihale|encumen|mahalle|kamulast|numarataj|adres|park|altyap|kanal/i;
export const PDF_WORTH = /karar|meclis|imar|plan|encumen|ilan|ozet|numarataj|adres|sokak|cadde|yol|kamulast/i;
export const cacheDir = (domain: string): string => join(repoRoot, 'dist', 'municipal', domain);

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
export const fileOf = (dir: string, url: string): string => join(dir, `${createHash('sha1').update(url).digest('hex').slice(0, 16)}.json`);

async function request(url: string, timeoutMs = 20000): Promise<Response | null> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: '*/*' }, signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' });
    return res.ok ? res : null;
  } catch {
    return null;
  }
}

export async function getText(url: string): Promise<string | null> {
  const res = await request(url);
  if (!res || !/(html|xml|text|json)/i.test(res.headers.get('content-type') ?? '')) return null;
  try {
    return await res.text();
  } catch {
    return null;
  }
}

export async function getPdfText(url: string): Promise<string | null> {
  const res = await request(url, 45000);
  if (!res) return null;
  const length = Number(res.headers.get('content-length') ?? 0);
  if (length > 20_000_000) return null;
  const file = join(tmpdir(), `muni-${createHash('sha1').update(url).digest('hex').slice(0, 12)}.pdf`);
  try {
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    return execFileSync('pdftotext', ['-layout', '-q', file, '-'], { timeout: 60000, maxBuffer: 64 * 1024 * 1024 }).toString('utf8');
  } catch {
    return null;
  } finally {
    rmSync(file, { force: true });
  }
}

export const urlScore = (url: string): number => (WORTH.test(new URL(url).pathname) ? 2 : 0) + (/\/(sayfa|page)\/\d+|[?&](page|sayfa)=/i.test(url) ? 0 : 1);

async function fromSitemaps(root: string, disallow: string[], limit: number): Promise<string[]> {
  const seen = new Set<string>();
  const urls: string[] = [];
  const queue = [`${root}/sitemap.xml`, `${root}/wp-sitemap.xml`, `${root}/sitemap_index.xml`];
  while (queue.length > 0 && urls.length < limit * 3) {
    const next = queue.shift()!;
    if (seen.has(next)) continue;
    seen.add(next);
    const xml = await getText(next);
    if (!xml || !/<(urlset|sitemapindex)/i.test(xml)) continue;
    const parsed = parseSitemap(xml);
    queue.push(...parsed.sitemaps);
    for (const u of parsed.urls) {
      try {
        if (!SKIP.test(u) && allowedByRobots(new URL(u).pathname, disallow)) urls.push(u);
      } catch {
        continue;
      }
    }
    await sleep(250);
  }
  return [...new Set(urls)];
}

export function linksOf(html: string, base: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/href\s*=\s*["']([^"'#]+)["']/gi)) {
    try {
      out.push(new URL(m[1]!.replace(/&amp;/g, '&'), base).toString());
    } catch {
      continue;
    }
  }
  return out;
}

async function crawl(root: string, disallow: string[], limit: number): Promise<string[]> {
  const host = new URL(root).host.replace(/^www\./, '');
  const seen = new Set<string>([`${root}/`]);
  let frontier = [`${root}/`];
  for (let depth = 0; depth < 2 && seen.size < limit; depth++) {
    const next: string[] = [];
    for (const url of frontier) {
      const html = await getText(url);
      if (!html) continue;
      for (const l of linksOf(html, url)) {
        let u: URL;
        try {
          u = new URL(l);
        } catch {
          continue;
        }
        if (u.host.replace(/^www\./, '') !== host || SKIP.test(l) || !allowedByRobots(u.pathname, disallow) || seen.has(l)) continue;
        seen.add(l);
        next.push(l);
        if (seen.size >= limit) break;
      }
      await sleep(400);
    }
    frontier = next;
  }
  return [...seen];
}

export async function harvest(domain: string, options: HarvestOptions = {}): Promise<HarvestResult> {
  const started = Date.now();
  const limit = options.limit ?? 1200;
  const root = `https://${domain}`;
  const dir = cacheDir(domain);
  mkdirSync(dir, { recursive: true });
  const robots = await getText(`${root}/robots.txt`);
  const disallow = robots ? robotsDisallow(robots) : [];
  const listFile = join(dir, 'urls.json');
  let urls: string[];
  if (existsSync(listFile)) urls = JSON.parse(readFileSync(listFile, 'utf8')) as string[];
  else {
    urls = await fromSitemaps(root, disallow, limit);
    if (urls.length < 20) urls = await crawl(root, disallow, Math.min(limit, 500));
    urls = urls.sort((a, b) => urlScore(b) - urlScore(a)).slice(0, limit);
    writeFileSync(listFile, JSON.stringify(urls));
  }
  const pages: Page[] = [];
  let fetched = 0;
  let cached = 0;
  let failed = 0;
  let pdfs = 0;
  let stoppedByBudget = false;
  const pdfQueue: string[] = [];
  const done = new Set<string>();
  const take = async (url: string): Promise<void> => {
    const file = fileOf(dir, url);
    if (existsSync(file)) {
      const page = JSON.parse(readFileSync(file, 'utf8')) as Page & { links?: string[] };
      pages.push({ url: page.url, text: page.text });
      cached++;
      for (const l of page.links ?? []) if (PDF.test(l) && PDF_WORTH.test(l) && !done.has(l)) pdfQueue.push(l);
      return;
    }
    if (PDF.test(url)) {
      const text = await getPdfText(url);
      if (text === null) {
        failed++;
        return;
      }
      writeFileSync(file, JSON.stringify({ url, text }));
      pages.push({ url, text });
      pdfs++;
    } else {
      const html = await getText(url);
      if (html === null) {
        failed++;
        return;
      }
      const links = linksOf(html, url).filter((l) => PDF.test(l) && PDF_WORTH.test(l));
      const text = htmlToText(html);
      writeFileSync(file, JSON.stringify({ url, text, links }));
      pages.push({ url, text });
      fetched++;
      pdfQueue.push(...links);
    }
    await sleep(options.delayMs ?? 600);
  };
  for (const url of urls) {
    if (Date.now() - started > (options.budgetMs ?? 40 * 60_000)) {
      stoppedByBudget = true;
      break;
    }
    done.add(url);
    await take(url);
  }
  const maxPdf = options.maxPdf ?? 150;
  for (const url of [...new Set(pdfQueue)].slice(0, maxPdf)) {
    if (done.has(url) || Date.now() - started > (options.budgetMs ?? 40 * 60_000) * 1.25) continue;
    done.add(url);
    await take(url);
  }
  return { pages, fetched, cached, failed, pdfs, stoppedByBudget };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const domains = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const limit = Number(process.argv.find((a) => a.startsWith('--limit='))?.slice(8) ?? 1200);
  for (const domain of domains) {
    const r = await harvest(domain, { limit });
    console.log(JSON.stringify({ domain, pages: r.pages.length, fetched: r.fetched, cached: r.cached, failed: r.failed, pdfs: r.pdfs, stoppedByBudget: r.stoppedByBudget }));
  }
}
