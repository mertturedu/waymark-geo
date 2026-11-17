import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { streetKey } from '../src/core/text/street';
import { repoRoot } from './addr-sets';
import { resolves } from './municipal-discover';
import { getText, linksOf } from './municipal-harvest';
import { hoodKey } from './municipal-lib';
import { hoodIndexOf, type HoodIndex } from './municipal-read';
import { decodeText, isOpenLicense, jsonTable, namedRows, parseCsv, readXls, readXlsx, streetRows, titleLocation, type Table } from './opendata-lib';

type Resource = { format: string; name: string; url: string };
type Dataset = { title: string; license: string | null; tags: string[]; resources: Resource[] };
type Entry = { portal: string; plate: string; dataset: string; license: string | null; status: string; rows: number; matched: number; hoods: number };
type State = { scanned: string[]; entries: Entry[]; portals: Record<string, string> };

const base = join(repoRoot, 'dist', 'municipal', 'opendata');
const stateFile = join(base, 'state.json');
export const hintsDir = join(repoRoot, 'dist', 'municipal', 'hints-opendata');
const USER_AGENT = 'yuksi-geo-research/1.0 (address data study)';
const PREFIX = ['acikveri', 'veri', 'data', 'opendata', 'acik-veri', 'verisetleri', 'acikdata', 'ckan'];
const WANTED = /sokak|cadde|csbm|mahalle.*(isim|liste|ad)|yol adi|yol adları|adres|numarataj|değişen|rehber|bağımsız bölüm/i;
const QUERIES = ['sokak', 'cadde', 'csbm', 'adres', 'yol', 'numarataj', 'rehber', 'mahalle'];
const FORMAT = /^(csv|xlsx?|api|json)$/i;
const FORMAT_ORDER = ['csv', 'xlsx', 'api', 'json', 'xls'];
const MAX_DATASETS = 1500;
export const pendingDir = join(repoRoot, 'dist', 'municipal', 'hints-opendata-pending');

const state: State = existsSync(stateFile) ? (JSON.parse(readFileSync(stateFile, 'utf8')) as State) : { scanned: [], entries: [], portals: {} };
const save = (): void => {
  mkdirSync(base, { recursive: true });
  writeFileSync(`${stateFile}.tmp`, JSON.stringify(state));
  renameSync(`${stateFile}.tmp`, stateFile);
};

export const rootOf = (domain: string): string => domain.replace(/^www\./, '');

async function isCkan(host: string): Promise<boolean> {
  const body = await getText(`https://${host}/api/3/action/package_search?rows=0`);
  return !!body && /"success"\s*:\s*true/.test(body);
}

export async function portalsOf(domain: string): Promise<string[]> {
  const root = rootOf(domain);
  const hosts = new Set<string>();
  for (const prefix of PREFIX) {
    const host = `${prefix}.${root}`;
    if (await resolves(host)) hosts.add(host);
  }
  const home = await getText(`https://${domain}/`);
  if (home) {
    for (const link of linksOf(home, `https://${domain}/`)) {
      try {
        const u = new URL(link);
        if (u.host.endsWith(root) && u.host !== domain && /veri|data/i.test(u.host)) hosts.add(u.host);
      } catch {
        continue;
      }
    }
  }
  const out: string[] = [];
  for (const host of hosts) if (await isCkan(host)) out.push(host);
  return out;
}

async function datasetsOf(portal: string): Promise<Dataset[]> {
  const seen = new Map<string, Dataset>();
  for (const q of QUERIES) {
    for (let start = 0; start < MAX_DATASETS; start += 100) {
      const body = await getText(`https://${portal}/api/3/action/package_search?q=${encodeURIComponent(q)}&rows=100&start=${start}`);
      if (!body) break;
      let count = 0;
      try {
        const j = JSON.parse(body) as { result?: { results?: { title: string; license_id?: string; tags?: { name: string }[]; resources: Resource[] }[] } };
        const results = j.result?.results ?? [];
        count = results.length;
        for (const d of results) {
          if (seen.has(d.title)) continue;
          seen.set(d.title, { title: d.title, license: d.license_id ?? null, tags: (d.tags ?? []).map((t) => t.name), resources: d.resources.filter((r) => FORMAT.test(r.format)) });
        }
      } catch {
        break;
      }
      if (count < 100) break;
    }
  }
  return [...seen.values()].filter((d) => d.resources.length > 0 && (WANTED.test(d.title) || d.tags.some((t) => WANTED.test(t))));
}

export async function download(url: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(90000), redirect: 'follow' });
    if (!res.ok) return null;
    const length = Number(res.headers.get('content-length') ?? 0);
    if (length > 80_000_000) return null;
    return new Uint8Array(await res.arrayBuffer());
  } catch {
    return null;
  }
}

async function tableOf(resource: Resource): Promise<Table | null> {
  const bytes = await download(resource.url);
  if (!bytes) return null;
  if (/^(api|json)$/i.test(resource.format)) return jsonTable(new TextDecoder().decode(bytes));
  if (/xlsx?/i.test(resource.format)) {
    mkdirSync(base, { recursive: true });
    const legacy = /^xls$/i.test(resource.format);
    const file = join(base, `tmp-${Date.now()}-${Math.floor(Math.random() * 1e6)}.${legacy ? 'xls' : 'xlsx'}`);
    writeFileSync(file, bytes);
    try {
      return legacy ? readXls(file) : readXlsx(file);
    } finally {
      rmSync(file, { force: true });
    }
  }
  return parseCsv(decodeText(bytes));
}

const declined = (): Set<string> => new Set(existsSync(join(base, 'declined-licenses.json')) ? (JSON.parse(readFileSync(join(base, 'declined-licenses.json'), 'utf8')) as string[]) : []);

const approved = (): Set<string> => {
  const file = join(base, 'approved-licenses.json');
  return new Set(existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as string[]) : []);
};

const clean = (hood: string): string => hood.replace(/\s+(MAH\.?|MAHALLES[İI]|MH\.?|K[ÖO]Y[ÜU])$/i, '').trim();

export function matchRows(rows: { district: string | null; hood: string; street: string }[], index: HoodIndex, defaultDistrict: string | null): { district: string; hood: string; sid: string | null; street: string; key: string }[] {
  const districts = new Map([...index.districts].map((d) => [hoodKey(d), d]));
  const out: { district: string; hood: string; sid: string | null; street: string; key: string }[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const named = r.district ? districts.get(hoodKey(r.district)) : undefined;
    const district = named ?? (defaultDistrict ? districts.get(hoodKey(defaultDistrict)) : undefined);
    const options = index.byKey.get(hoodKey(clean(r.hood)));
    const found = district ? options?.find((o) => o.district === district) : options?.length === 1 ? options[0] : undefined;
    if (!found) continue;
    const key = streetKey(r.street).key;
    if (key === '') continue;
    const id = `${found.district}|${hoodKey(clean(r.hood))}|${key}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ district: found.district, hood: clean(r.hood), sid: found.sid, street: r.street, key });
  }
  return out;
}

export function appendHints(dir: string, plate: string, portal: string, dataset: Dataset, rows: ReturnType<typeof matchRows>): void {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${plate}.jsonl`);
  const known = new Set(existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => { const h = JSON.parse(l) as { district: string; hood: string; key: string }; return `${h.district}|${hoodKey(h.hood)}|${h.key}`; }) : []);
  const lines = rows.filter((r) => !known.has(`${r.district}|${hoodKey(r.hood)}|${r.key}`)).map((r) => JSON.stringify({ plate, district: r.district, hood: r.hood, sid: r.sid, street: r.street, key: r.key, source: 'acikveri', portal, dataset: dataset.title, license: dataset.license }));
  if (lines.length > 0) writeFileSync(file, (existsSync(file) ? readFileSync(file, 'utf8') : '') + lines.join('\n') + '\n');
}

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

export async function pullPortal(portal: string, plate: string, districtName: string | null): Promise<Entry[]> {
  const index = hoodIndexOf(plate);
  const entries: Entry[] = [];
  for (const dataset of await datasetsOf(portal)) {
    const entry: Entry = { portal, plate, dataset: dataset.title, license: dataset.license, status: 'atlandı', rows: 0, matched: 0, hoods: 0 };
    entries.push(entry);
    if (declined().has(dataset.license ?? '')) {
      entry.status = `lisans reddedildi (${dataset.license})`;
      continue;
    }
    const open = isOpenLicense(dataset.license) || approved().has(dataset.license ?? '');
    const resource = [...dataset.resources].sort((a, b) => FORMAT_ORDER.indexOf(a.format.toLowerCase()) - FORMAT_ORDER.indexOf(b.format.toLowerCase()))[0]!;
    const table = await tableOf(resource);
    await sleep(open ? 200 : 400);
    if (!table) {
      entry.status = 'indirilemedi';
      continue;
    }
    const place = titleLocation(dataset.title);
    const rows = streetRows(table).length > 0 ? streetRows(table) : place ? namedRows(table, place) : [];
    if (rows.length === 0) {
      entry.status = 'sütun bulunamadı';
      continue;
    }
    const matched = matchRows(rows, index, place?.district ?? districtName);
    entry.rows = rows.length;
    entry.matched = matched.length;
    entry.hoods = new Set(matched.map((m) => `${m.district}|${hoodKey(m.hood)}`)).size;
    entry.status = matched.length === 0 ? 'eşleşme yok' : open ? 'alındı' : `lisans bekliyor (${dataset.license ?? 'yok'})`;
    if (matched.length > 0) appendHints(open ? hintsDir : pendingDir, plate, portal, dataset, matched);
  }
  return entries;
}

async function scan(): Promise<number> {
  const mun = JSON.parse(readFileSync(join(repoRoot, 'dist', 'municipal', 'state.json'), 'utf8')) as { plates: Record<string, { sites: { domain: string; plate: string; kind: string; name: string }[]; status: string }> };
  const sites = Object.values(mun.plates).flatMap((p) => p.sites).filter((s) => s.kind === 'belediye' && !state.scanned.includes(s.domain));
  let next = 0;
  await Promise.all(Array.from({ length: 8 }, async () => {
    for (let i = next++; i < sites.length; i = next++) {
      const site = sites[i]!;
      try {
        for (const portal of await portalsOf(site.domain)) {
          if (state.portals[portal]) continue;
          state.portals[portal] = site.plate;
          const district = [...hoodIndexOf(site.plate).districts].some((d) => hoodKey(d) === hoodKey(site.name)) ? site.name : null;
          state.entries.push(...(await pullPortal(portal, site.plate, district)));
          save();
        }
      } catch (e) {
        console.log(`${site.domain} hata: ${String(e).slice(0, 100)}`);
      }
      state.scanned.push(site.domain);
      save();
    }
  }));
  return sites.length;
}

export function renderOpenData(): string {
  const taken = state.entries.filter((e) => e.status === 'alındı');
  const review = state.entries.filter((e) => e.status.startsWith('lisans'));
  const table = (list: Entry[]): string => list.map((e) => `| ${e.plate} | ${e.portal} | ${e.dataset} | ${e.license ?? '-'} | ${e.status} | ${e.rows} | ${e.matched} | ${e.hoods} |`).join('\n');
  return `# Açık veri çekme modu\n\nGüncelleme: ${new Date().toISOString()}\n\n- Taranan belediye sitesi: ${state.scanned.length}\n- Bulunan portal: ${Object.keys(state.portals).length}\n- Alınan veri seti: ${taken.length} (${taken.reduce((n, e) => n + e.matched, 0)} sokak-mahalle kaydı, ${taken.reduce((n, e) => n + e.hoods, 0)} mahalle)\n- Lisansı incelenecek: ${review.length}\n\n## Alınanlar\n\n| İl | Portal | Veri seti | Lisans | Durum | Satır | Eşleşen | Mahalle |\n|---|---|---|---|---|---|---|---|\n${table(taken)}\n\n## Lisansı incelenecekler (alınmadı)\n\n| İl | Portal | Veri seti | Lisans | Durum | Satır | Eşleşen | Mahalle |\n|---|---|---|---|---|---|---|---|\n${table(review)}\n`;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href && process.argv.some((a) => a.startsWith('--portal='))) {
  const arg = (name: string): string => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? '';
  const portal = arg('portal');
  const plate = arg('plate');
  state.portals[portal] = plate;
  state.entries = state.entries.filter((e) => e.portal !== portal);
  const district = arg('district') || null;
  state.entries.push(...(await pullPortal(portal, plate, district)));
  save();
  const mine = state.entries.filter((e) => e.portal === portal);
  const count = (test: (e: Entry) => boolean): { datasets: number; rows: number } => ({ datasets: mine.filter(test).length, rows: mine.filter(test).reduce((n, e) => n + e.matched, 0) });
  console.log(JSON.stringify({ portal, alındı: count((e) => e.status === 'alındı'), bekliyor: count((e) => e.status.startsWith('lisans')), sütunYok: count((e) => e.status === 'sütun bulunamadı'), eşleşmeYok: count((e) => e.status === 'eşleşme yok'), indirilemedi: count((e) => e.status === 'indirilemedi') }));
} else if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const statusFile = join(homedir(), 'Desktop', 'yuksi-geo-raporlar', 'faz-19', 'opendata-status.md');
  for (let round = 0; ; round++) {
    const n = await scan();
    writeFileSync(statusFile, renderOpenData());
    console.log(`tur ${round}: ${n} yeni site tarandı, ${Object.keys(state.portals).length} portal`);
    const mun = JSON.parse(readFileSync(join(repoRoot, 'dist', 'municipal', 'state.json'), 'utf8')) as { plates: Record<string, { status: string }> };
    if (Object.keys(mun.plates).length >= 81 && Object.values(mun.plates).every((p) => p.status === 'done') && n === 0) break;
    if (process.argv.includes('--once')) break;
    await new Promise((r) => setTimeout(r, 15 * 60_000));
  }
}
