import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { repoRoot } from './addr-sets';
import { getText, linksOf } from './municipal-harvest';
import { hoodKey } from './municipal-lib';
import { hoodIndexOf } from './municipal-read';
import { appendHints, download, hintsDir, matchRows, pendingDir } from './opendata-run';
import { decodeText, isOpenLicense, parseCsv, readXls, readXlsx, streetRows, type Table } from './opendata-lib';

type Page = { host: string; plate: string; license: string | null; list: string[]; pattern: RegExp; slug: (url: string) => string };

const PAGES: Page[] = [
  { host: 'acikveri.kayseri.bel.tr', plate: '38', license: 'cc-by-4', list: ['/'], pattern: /\/veri-seti\/([a-z0-9-]*csbm[a-z0-9-]*)\/\d+$/, slug: (url) => (/\/veri-seti\/([a-z0-9]+)-(?:ilcesi-)?csbm/.exec(url)?.[1] ?? '') },
];
const FILE = /\/uploads\/[^"']+\.(xlsx?|csv)$/i;
const tmp = join(repoRoot, 'dist', 'municipal', 'opendata', 'tmp');

async function tableOf(url: string): Promise<Table> {
  const bytes = await download(url);
  if (!bytes) return [];
  if (/\.csv$/i.test(url)) return parseCsv(decodeText(bytes));
  mkdirSync(tmp, { recursive: true });
  const file = join(tmp, `p-${Date.now()}-${Math.floor(Math.random() * 1e6)}${/\.xlsx$/i.test(url) ? '.xlsx' : '.xls'}`);
  writeFileSync(file, bytes);
  try {
    return /\.xlsx$/i.test(url) ? readXlsx(file) : readXls(file);
  } finally {
    rmSync(file, { force: true });
  }
}

export async function pullPages(site: Page): Promise<{ title: string; rows: number; matched: number; hoods: number }[]> {
  const root = `https://${site.host}`;
  const index = hoodIndexOf(site.plate);
  const datasets = new Set<string>();
  for (const path of site.list) {
    const html = await getText(`${root}${path}`);
    for (const link of html ? linksOf(html, root) : []) if (site.pattern.test(new URL(link).pathname)) datasets.add(link);
  }
  const out: { title: string; rows: number; matched: number; hoods: number }[] = [];
  for (const link of datasets) {
    const html = await getText(link);
    const file = html ? linksOf(html, root).find((l) => FILE.test(l)) : undefined;
    const title = new URL(link).pathname.split('/')[2] ?? link;
    if (!file) {
      out.push({ title, rows: 0, matched: 0, hoods: 0 });
      continue;
    }
    const rows = streetRows(await tableOf(file));
    const district = site.slug(link);
    const matched = matchRows(rows, index, district || null);
    if (matched.length > 0) appendHints(isOpenLicense(site.license) ? hintsDir : pendingDir, site.plate, site.host, { title, license: site.license, tags: [], resources: [] }, matched);
    out.push({ title, rows: rows.length, matched: matched.length, hoods: new Set(matched.map((m) => `${m.district}|${hoodKey(m.hood)}`)).size });
    await new Promise((done) => setTimeout(done, 500));
  }
  return out;
}

async function main(): Promise<void> {
  for (const site of PAGES) {
    const result = await pullPages(site);
    for (const r of result) console.log(`${site.host} ${r.title}: ${r.rows} satır, ${r.matched} eşleşti, ${r.hoods} mahalle`);
    console.log(JSON.stringify({ host: site.host, datasets: result.length, rows: result.reduce((n, r) => n + r.rows, 0), matched: result.reduce((n, r) => n + r.matched, 0) }));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
