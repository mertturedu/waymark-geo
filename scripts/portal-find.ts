import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { repoRoot } from './addr-sets';
import { resolves } from './municipal-discover';
import { getText } from './municipal-harvest';

export type Platform = 'ckan' | 'socrata' | 'arcgis-hub' | 'arcgis-rest';
export type Finding = { host: string; plate: string; platform: Platform; layers: { name: string; url: string; count: number | null }[]; note: string };

const base = join(repoRoot, 'dist', 'municipal', 'opendata');
const GIS_PREFIX = ['cbs', 'gis', 'harita', 'webgis', 'kentrehberi', 'kent', 'mapserver', 'server', 'cografi', 'hub', 'sehirrehberi'];
const WANTED = /sokak|cadde|csbm|mahalle|yol|adres|kapi|bina/i;
export const rootOf = (domain: string): string => domain.replace(/^www\./, '');

const json = async <T>(url: string): Promise<T | null> => {
  const body = await getText(url);
  if (!body) return null;
  try {
    return JSON.parse(body) as T;
  } catch {
    return null;
  }
};

export async function platformOf(host: string): Promise<Platform | null> {
  if ((await json<{ success?: boolean }>(`https://${host}/api/3/action/package_search?rows=0`))?.success) return 'ckan';
  if ((await json<{ results?: unknown[] }>(`https://${host}/api/catalog/v1?limit=1`))?.results) return 'socrata';
  if ((await json<{ data?: unknown[] }>(`https://${host}/api/v3/datasets?page%5Bsize%5D=1`))?.data) return 'arcgis-hub';
  if ((await json<{ currentVersion?: number }>(`https://${host}/arcgis/rest/services?f=json`))?.currentVersion) return 'arcgis-rest';
  return null;
}

type Svc = { name: string; type: string };
type Listing = { folders?: string[]; services?: Svc[] };

export async function restLayers(host: string): Promise<Finding['layers']> {
  const root = `https://${host}/arcgis/rest/services`;
  const top = await json<Listing>(`${root}?f=json`);
  if (!top) return [];
  const services: Svc[] = [...(top.services ?? [])];
  for (const folder of (top.folders ?? []).slice(0, 25)) services.push(...((await json<Listing>(`${root}/${folder}?f=json`))?.services ?? []));
  const out: Finding['layers'] = [];
  for (const svc of services.filter((s) => /FeatureServer|MapServer/.test(s.type)).slice(0, 60)) {
    const url = `${root}/${svc.name}/${svc.type}`;
    const info = await json<{ layers?: { id: number; name: string }[] }>(`${url}?f=json`);
    for (const layer of info?.layers ?? []) {
      if (!WANTED.test(layer.name)) continue;
      const count = (await json<{ count?: number }>(`${url}/${layer.id}/query?where=1%3D1&returnCountOnly=true&f=json`))?.count ?? null;
      out.push({ name: `${svc.name} / ${layer.name}`, url: `${url}/${layer.id}`, count });
    }
  }
  return out;
}

export async function findHosts(domain: string): Promise<string[]> {
  const root = rootOf(domain);
  const hosts: string[] = [];
  for (const prefix of GIS_PREFIX) {
    const host = `${prefix}.${root}`;
    if (await resolves(host)) hosts.push(host);
  }
  return hosts;
}

const seedsOf = (): Record<string, string[]> => {
  const file = join(base, 'portal-seeds.json');
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Record<string, string[]>) : { '35': ['acikveri.bizizmir.com'], '34': ['data.ibb.gov.tr', 'veri.tuzla.bel.tr'] };
};

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const mun = JSON.parse(readFileSync(join(repoRoot, 'dist', 'municipal', 'state.json'), 'utf8')) as { plates: Record<string, { sites: { domain: string; plate: string; kind: string }[] }> };
  const jobs: { host: string; plate: string }[] = [];
  for (const [plate, hosts] of Object.entries(seedsOf())) for (const host of hosts) jobs.push({ host, plate });
  const sites = Object.values(mun.plates).flatMap((p) => p.sites).filter((s) => s.kind === 'belediye');
  const probed = await Promise.all(sites.map(async (s) => (await findHosts(s.domain)).map((host) => ({ host, plate: s.plate }))));
  jobs.push(...probed.flat());
  const findings: Finding[] = [];
  let next = 0;
  await Promise.all(Array.from({ length: 8 }, async () => {
    for (let i = next++; i < jobs.length; i = next++) {
      const { host, plate } = jobs[i]!;
      const platform = await platformOf(host);
      if (!platform) continue;
      const layers = platform === 'arcgis-rest' ? await restLayers(host) : [];
      findings.push({ host, plate, platform, layers, note: platform === 'ckan' ? 'çekme moduna ekli' : platform === 'arcgis-rest' ? 'yalnız keşif: lisans belirtilmemiş' : 'incelenecek' });
    }
  }));
  mkdirSync(base, { recursive: true });
  writeFileSync(join(base, 'portals.json'), JSON.stringify(findings, null, 1));
  const lines = findings.map((f) => `| ${f.plate} | ${f.host} | ${f.platform} | ${f.layers.length} | ${f.layers.slice(0, 3).map((l) => `${l.name} (${l.count ?? '?'})`).join('; ')} | ${f.note} |`);
  writeFileSync(join(homedir(), 'Desktop', 'yuksi-geo-raporlar', 'faz-19', 'portal-bulucu.md'), `# Portal bulucu\n\nGüncelleme: ${new Date().toISOString()}\n\n| İl | Host | Platform | Aday katman | Örnek | Not |\n|---|---|---|---|---|---|\n${lines.join('\n')}\n`);
  console.log(JSON.stringify({ probed: jobs.length, found: findings.length, byPlatform: findings.reduce<Record<string, number>>((m, f) => ({ ...m, [f.platform]: (m[f.platform] ?? 0) + 1 }), {}) }));
  for (const f of findings.filter((x) => x.layers.length)) console.log(f.plate, f.host, f.layers.slice(0, 4).map((l) => `${l.name}(${l.count})`).join('; '));
}
