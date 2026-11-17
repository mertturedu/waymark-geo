import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { repoRoot } from './addr-sets';
import { resolves } from './municipal-discover';
import { getText } from './municipal-harvest';

export type Dataset = { portal: string; plate: string; title: string; license: string | null; resources: { format: string; name: string; url: string }[] };

const PREFIX = ['acikveri', 'veri', 'data', 'opendata', 'acikveriportali', 'acikdata'];
const TITLE = /sokak|cadde|mahalle.*(isim|liste|ad)|adres|yol ad|kapi|kapı/i;

export const rootOf = (domain: string): string => domain.replace(/^www\./, '');

async function search(portal: string, q: string): Promise<{ title: string; license_id?: string; resources: { format: string; name: string; url: string }[] }[]> {
  const body = await getText(`https://${portal}/api/3/action/package_search?q=${encodeURIComponent(q)}&rows=50`);
  if (!body) return [];
  try {
    const j = JSON.parse(body) as { success?: boolean; result?: { results?: { title: string; license_id?: string; resources: { format: string; name: string; url: string }[] }[] } };
    return j.success ? (j.result?.results ?? []) : [];
  } catch {
    return [];
  }
}

export async function findDatasets(domain: string, plate: string): Promise<Dataset[]> {
  const root = rootOf(domain);
  const found: Dataset[] = [];
  for (const prefix of PREFIX) {
    const portal = `${prefix}.${root}`;
    if (!(await resolves(portal))) continue;
    const seen = new Set<string>();
    for (const q of ['sokak', 'cadde', 'mahalle']) {
      for (const d of await search(portal, q)) {
        if (!TITLE.test(d.title) || seen.has(d.title)) continue;
        seen.add(d.title);
        const resources = d.resources.filter((r) => /csv|xls|json|geojson|shp/i.test(r.format));
        if (resources.length > 0) found.push({ portal, plate, title: d.title, license: d.license_id ?? null, resources });
      }
    }
  }
  return found;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const state = JSON.parse(readFileSync(join(repoRoot, 'dist', 'municipal', 'state.json'), 'utf8')) as { plates: Record<string, { sites: { domain: string; plate: string; kind: string }[] }> };
  const sites = Object.values(state.plates).flatMap((p) => p.sites).filter((s) => s.kind === 'belediye');
  const all: Dataset[] = [];
  let next = 0;
  await Promise.all(Array.from({ length: 16 }, async () => {
    for (let i = next++; i < sites.length; i = next++) all.push(...(await findDatasets(sites[i]!.domain, sites[i]!.plate)));
  }));
  mkdirSync(join(repoRoot, 'dist', 'municipal', 'opendata'), { recursive: true });
  writeFileSync(join(repoRoot, 'dist', 'municipal', 'opendata', 'datasets.json'), JSON.stringify(all, null, 1));
  console.log(JSON.stringify({ belediyeSites: sites.length, datasets: all.length, portals: new Set(all.map((d) => d.portal)).size }));
  for (const d of all.slice(0, 40)) console.log(d.plate, d.portal, '|', d.title, '|', d.license, '|', d.resources.map((r) => r.format).join(','));
}
