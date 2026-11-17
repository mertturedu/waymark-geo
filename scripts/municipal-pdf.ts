import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cacheDir, fileOf, getPdfText, PDF, PDF_WORTH } from './municipal-harvest';
import { repoRoot } from './addr-sets';
import { loadResult, readSite, type SiteResult } from './municipal-read';
import { writeHints } from './municipal-run';
import type { Site } from './municipal-discover';

const BUDGET_MS = 20 * 60_000;
const MAX_PDF = 400;
const TOP = /karar|meclis|encumen|numarataj|imar|plan|zabit|ozet|ilan/i;

type Cached = { url: string; text: string; links?: string[] };

export function pdfLinksOf(domain: string): string[] {
  const dir = cacheDir(domain);
  if (!existsSync(dir)) return [];
  const root = domain.replace(/^www\./, '');
  const links = new Set<string>();
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.json') || f === 'urls.json') continue;
    try {
      for (const l of (JSON.parse(readFileSync(join(dir, f), 'utf8')) as Cached).links ?? []) {
        if (PDF.test(l) && new URL(l).host.replace(/^www\./, '').endsWith(root)) links.add(l);
      }
    } catch {
      continue;
    }
  }
  return [...links].sort((a, b) => Number(TOP.test(b)) + Number(PDF_WORTH.test(b)) - Number(TOP.test(a)) - Number(PDF_WORTH.test(a)));
}

export async function fetchMissingPdfs(domain: string): Promise<number> {
  const dir = cacheDir(domain);
  const listFile = join(dir, 'urls.json');
  const urls = existsSync(listFile) ? (JSON.parse(readFileSync(listFile, 'utf8')) as string[]) : [];
  const started = Date.now();
  let added = 0;
  for (const url of pdfLinksOf(domain).filter((u) => !existsSync(fileOf(dir, u))).slice(0, MAX_PDF)) {
    if (Date.now() - started > BUDGET_MS) break;
    const text = await getPdfText(url);
    await new Promise((r) => setTimeout(r, 500));
    if (text === null) continue;
    writeFileSync(fileOf(dir, url), JSON.stringify({ url, text }));
    if (!urls.includes(url)) urls.push(url);
    added++;
  }
  if (added > 0) writeFileSync(listFile, JSON.stringify(urls));
  return added;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const stateFile = join(repoRoot, 'dist', 'municipal', 'state.json');
  const doneFile = join(repoRoot, 'dist', 'municipal', 'pdf-done.json');
  const done = new Set<string>(existsSync(doneFile) ? (JSON.parse(readFileSync(doneFile, 'utf8')) as string[]) : []);
  for (let round = 0; ; round++) {
    const state = JSON.parse(readFileSync(stateFile, 'utf8')) as { plates: Record<string, { status: string; sites: Site[] }> };
    const ready = Object.entries(state.plates).filter(([plate, p]) => p.status === 'done' && !done.has(plate));
    for (const [plate, p] of ready) {
      let added = 0;
      const sites = p.sites.filter((s) => s.kind === 'belediye' || s.kind === 'belde');
      let next = 0;
      await Promise.all(Array.from({ length: 6 }, async () => {
        for (let i = next++; i < sites.length; i = next++) {
          const site = sites[i]!;
          const n = await fetchMissingPdfs(site.domain).catch(() => 0);
          if (n > 0) {
            added += n;
            await readSite(site, { maxQwen: 150 }).catch(() => null);
          }
        }
      }));
      const results = p.sites.map((s) => loadResult(s)).filter((r): r is SiteResult => r !== null);
      const w = writeHints(plate, results);
      done.add(plate);
      writeFileSync(doneFile, JSON.stringify([...done]));
      console.log(`${plate} PDF turu: ${added} yeni PDF, ${w.supports} kanıt (${w.strong} tanesi ≥ 2 kaynak)`);
    }
    const allDone = Object.keys(state.plates).length >= 81 && Object.values(state.plates).every((p) => p.status === 'done');
    if (allDone && ready.length === 0) break;
    await new Promise((r) => setTimeout(r, 10 * 60_000));
  }
}
