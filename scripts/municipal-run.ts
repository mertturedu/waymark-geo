import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { repoRoot } from './addr-sets';
import { discoverPlate, type Site } from './municipal-discover';
import { hoodIndexOf, loadResult, readSite, supports, type SiteResult } from './municipal-read';
import { hoodKey } from './municipal-lib';

type PlateState = { status: 'pending' | 'reading' | 'done'; sites: Site[]; unverified: string[]; discoveredAt?: string; failed: string[]; doneAt?: string };
type State = { startedAt: string; plates: Record<string, PlateState>; log: string[] };

const base = join(repoRoot, 'dist', 'municipal');
const stateFile = join(base, 'state.json');
const hintsDir = join(base, 'hints');
const statusFile = join(homedir(), 'Desktop', 'yuksi-geo-raporlar', 'faz-19', 'municipal-status.md');
const CONCURRENCY = Number(process.env.MUNI_CONCURRENCY ?? 10);

export const budgetOf = (kind: Site['kind']): { limit: number; budgetMs: number; maxPdf: number; maxQwen: number } =>
  kind === 'belediye' ? { limit: 700, budgetMs: 14 * 60_000, maxPdf: 120, maxQwen: 150 } : kind === 'belde' ? { limit: 300, budgetMs: 8 * 60_000, maxPdf: 60, maxQwen: 80 } : { limit: 300, budgetMs: 6 * 60_000, maxPdf: 40, maxQwen: 60 };

function load(): State {
  if (existsSync(stateFile)) return JSON.parse(readFileSync(stateFile, 'utf8')) as State;
  return { startedAt: new Date().toISOString(), plates: {}, log: [] };
}

const state = load();
const save = (): void => {
  mkdirSync(base, { recursive: true });
  const tmp = `${stateFile}.tmp`;
  writeFileSync(tmp, JSON.stringify(state));
  renameSync(tmp, stateFile);
};
const note = (line: string): void => {
  state.log.push(`${new Date().toISOString().slice(0, 19)} ${line}`);
  state.log = state.log.slice(-60);
  console.log(line);
};

export function plateOrder(): string[] {
  const all = Array.from({ length: 81 }, (_, i) => String(i + 1).padStart(2, '0'));
  const gapFile = join(homedir(), 'Desktop', 'yuksi-geo-raporlar', 'faz-19', 'bosluk-haritasi.json');
  const weight = new Map<string, number>();
  if (existsSync(gapFile)) {
    const gap = JSON.parse(readFileSync(gapFile, 'utf8')) as { rows?: { plate: string; bareBuildings: number }[] };
    for (const r of gap.rows ?? []) weight.set(r.plate, r.bareBuildings);
  }
  const first = (process.env.MUNI_FIRST ?? '20').split(',');
  return [...first, ...all.filter((p) => !first.includes(p)).sort((a, b) => (weight.get(b) ?? 0) - (weight.get(a) ?? 0))];
}

async function pool<T>(items: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      for (let i = next++; i < items.length; i = next++) await fn(items[i]!);
    }),
  );
}

export function writeHints(plate: string, results: SiteResult[]): { supports: number; strong: number } {
  const index = hoodIndexOf(plate);
  const merged = supports(results.flatMap((r) => r.rows.map((row) => ({ ...row, page: `${r.domain}|${row.page}` }))));
  mkdirSync(hintsDir, { recursive: true });
  const lines = merged.map((s) => {
    const sid = index.byKey.get(hoodKey(s.hood))?.find((o) => o.district === s.district)?.sid ?? null;
    return JSON.stringify({ plate, district: s.district, hood: s.hood, sid, street: s.street, key: s.key, sources: s.pages.length, via: s.via, pages: s.pages.slice(0, 5), quotes: s.quotes.slice(0, 2) });
  });
  writeFileSync(join(hintsDir, `${plate}.jsonl`), lines.join('\n') + (lines.length ? '\n' : ''));
  return { supports: merged.length, strong: merged.filter((s) => s.pages.length >= 2).length };
}

async function runPlate(plate: string): Promise<void> {
  const st = state.plates[plate] ?? { status: 'pending', sites: [], unverified: [], failed: [] };
  state.plates[plate] = st;
  if (!st.discoveredAt) {
    const found = await discoverPlate(plate).catch((e: unknown) => {
      note(`${plate} keşif hatası: ${String(e).slice(0, 120)}`);
      return null;
    });
    if (!found) return;
    st.sites = found.sites;
    st.unverified = found.unverified;
    st.discoveredAt = new Date().toISOString();
    save();
    note(`${plate}: ${st.sites.length} site bulundu (doğrulanamayan ${st.unverified.length})`);
  }
  st.status = 'reading';
  save();
  const todo = st.sites.filter((s) => !loadResult(s) && !st.failed.includes(s.domain));
  const order = [...todo].sort((a, b) => Number(b.kind === 'belediye') - Number(a.kind === 'belediye'));
  await pool(order, CONCURRENCY, async (site) => {
    try {
      const r = await readSite(site, budgetOf(site.kind));
      note(`${plate} ${site.domain}: ${r.pages} sayfa, ${r.rows.filter((x) => x.verdict === 'ok').length} geçerli iddia`);
    } catch (e) {
      st.failed.push(site.domain);
      note(`${plate} ${site.domain} hata: ${String(e).slice(0, 100)}`);
    }
    save();
  });
  const results = st.sites.map((s) => loadResult(s)).filter((r): r is SiteResult => r !== null);
  const w = writeHints(plate, results);
  st.status = 'done';
  st.doneAt = new Date().toISOString();
  save();
  note(`${plate} bitti: ${results.length}/${st.sites.length} site, ${w.supports} sokak-mahalle kanıtı (${w.strong} tanesi ≥ 2 kaynak)`);
}

export function renderStatus(s: State): string {
  const plates = Object.entries(s.plates);
  const done = plates.filter(([, p]) => p.status === 'done');
  const sites = plates.reduce((n, [, p]) => n + p.sites.length, 0);
  const read = plates.reduce((n, [, p]) => n + p.sites.filter((x) => loadResult(x)).length, 0);
  const rows = plates
    .map(([plate, p]) => {
      const hintFile = join(hintsDir, `${plate}.jsonl`);
      const lines = existsSync(hintFile) ? readFileSync(hintFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as { sources: number }) : [];
      return `| ${plate} | ${p.status} | ${p.sites.length} | ${p.sites.filter((x) => loadResult(x)).length} | ${p.failed.length} | ${lines.length} | ${lines.filter((l) => l.sources >= 2).length} |`;
    })
    .join('\n');
  return `# Belediye hattı durumu\n\nGüncelleme: ${new Date().toISOString()} · başlangıç ${s.startedAt}\n\n- İl bitti: ${done.length}/81\n- Site: ${read}/${sites} okundu\n\n| İl | Durum | Site | Okunan | Hata | Kanıt | ≥2 kaynak |\n|---|---|---|---|---|---|---|\n${rows}\n\n## Son olaylar\n\n${s.log.slice(-25).join('\n')}\n`;
}

const writeStatus = (): void => {
  try {
    mkdirSync(join(homedir(), 'Desktop', 'yuksi-geo-raporlar', 'faz-19'), { recursive: true });
    writeFileSync(statusFile, renderStatus(state));
  } catch {
    return;
  }
};

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const timer = setInterval(writeStatus, 120_000);
  const only = process.argv.slice(2).filter((a) => /^\d{2}$/.test(a));
  for (const plate of only.length ? only : plateOrder()) {
    if (state.plates[plate]?.status === 'done') continue;
    try {
      await runPlate(plate);
    } catch (e) {
      note(`${plate} hata: ${String(e).slice(0, 160)}`);
    }
    writeStatus();
  }
  clearInterval(timer);
  writeStatus();
  note('tüm iller tamam');
}
