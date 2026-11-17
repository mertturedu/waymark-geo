import { existsSync, readFileSync } from 'node:fs';
import { promises as dns } from 'node:dns';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { nameKey } from '../src/core/text';
import { repoRoot } from './addr-sets';
import { getText } from './municipal-harvest';
import { htmlToText } from './municipal-lib';

export type Site = { domain: string; plate: string; kind: 'belediye' | 'kaymakamlik' | 'valilik' | 'belde'; name: string };

type Admin = { provinces: { plate: string; names: { tr: string } }[]; districts: { province: string; names: { tr: string } }[] };
const admin = JSON.parse(readFileSync(join(repoRoot, 'src', 'core', 'text', 'data', 'admin.json'), 'utf8')) as Admin;

export const slugOf = (name: string): string => nameKey(name).replace(/ /g, '');

export function candidates(slug: string, province: string, kind: Site['kind']): string[] {
  if (kind === 'valilik') return [`${slug}.gov.tr`];
  if (kind === 'kaymakamlik') return [`${slug}.gov.tr`, `${slug}${province}.gov.tr`];
  if (kind === 'belde') return [`${slug}.bel.tr`];
  return [`${slug}.bel.tr`, `${slug}belediyesi.bel.tr`, `${slug}bld.bel.tr`, `${slug}${province}.bel.tr`, `${slug}bb.bel.tr`, `${slug}-bld.bel.tr`];
}

export async function resolves(domain: string): Promise<boolean> {
  for (const host of [domain, `www.${domain}`]) {
    try {
      if ((await dns.resolve4(host)).length > 0) return true;
    } catch {
      continue;
    }
  }
  return false;
}

const KEYWORD: Record<Site['kind'], string> = { belediye: 'belediye', belde: 'belediye', kaymakamlik: 'kaymakaml', valilik: 'valilik' };

export async function verify(domain: string, kind: Site['kind'], name: string, province: string, mustHaveProvince: boolean): Promise<string | null> {
  for (const host of [`www.${domain}`, domain, `www.${domain}`]) {
    const html = await getText(`https://${host}/`);
    if (!html || html.length < 800) continue;
    const text = nameKey(htmlToText(html).slice(0, 60000)).replace(/ /g, '');
    if (!text.includes(slugOf(name)) || !text.includes(KEYWORD[kind])) continue;
    if (mustHaveProvince && !text.includes(slugOf(province))) continue;
    return host;
  }
  return null;
}

async function pool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      for (let i = next++; i < items.length; i = next++) out[i] = await fn(items[i]!);
    }),
  );
  return out;
}

export function hoodNamesList(plate: string): string[] {
  const file = join(repoRoot, 'dist', 'work', '261028', 'packs', plate, 'address.sqlite');
  if (!existsSync(file)) return [];
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return [...new Set((db.prepare('SELECT name FROM neighbourhood').all() as { name: string }[]).map((r) => r.name))];
  } finally {
    db.close();
  }
}

export function seedsOf(plate: string): Site[] {
  const file = join(repoRoot, 'dist', 'municipal', 'seeds.json');
  if (!existsSync(file)) return [];
  const all = JSON.parse(readFileSync(file, 'utf8')) as Record<string, string[]>;
  return (all[plate] ?? []).map((domain) => ({ domain, plate, kind: 'belediye' as const, name: domain }));
}

export async function discoverPlate(plate: string, withBelde = true): Promise<{ sites: Site[]; unverified: string[] }> {
  const province = admin.provinces.find((p) => p.plate === plate)!.names.tr;
  const provSlug = slugOf(province);
  const districtNames = admin.districts.filter((d) => d.province === plate).map((d) => d.names.tr);
  const allDistricts = admin.districts.map((d) => slugOf(d.names.tr));
  const ambiguous = (name: string): boolean => allDistricts.filter((s) => s === slugOf(name)).length > 1 || slugOf(name) === provSlug;
  const jobs: { name: string; kind: Site['kind']; list: string[]; mustProvince: boolean }[] = [
    { name: province, kind: 'belediye', list: candidates(provSlug, provSlug, 'belediye'), mustProvince: false },
    { name: province, kind: 'valilik', list: candidates(provSlug, provSlug, 'valilik'), mustProvince: false },
    ...districtNames.flatMap((n) => [
      { name: n, kind: 'belediye' as const, list: candidates(slugOf(n), provSlug, 'belediye'), mustProvince: ambiguous(n) },
      { name: n, kind: 'kaymakamlik' as const, list: candidates(slugOf(n), provSlug, 'kaymakamlik'), mustProvince: ambiguous(n) },
    ]),
  ];
  if (withBelde) {
    const taken = new Set(districtNames.map(slugOf));
    for (const hood of hoodNamesList(plate)) {
      const slug = slugOf(hood);
      if (slug.length >= 4 && !taken.has(slug) && !jobs.some((j) => j.kind === 'belde' && j.name === hood)) jobs.push({ name: hood, kind: 'belde', list: candidates(slug, provSlug, 'belde'), mustProvince: true });
    }
  }
  const unverified: string[] = [];
  const found = await pool(jobs, 48, async (job) => {
    let resolved = false;
    for (const domain of job.list) {
      if (!(await resolves(domain))) continue;
      resolved = true;
      const host = await verify(domain, job.kind, job.name, province, job.mustProvince);
      if (host) return { domain: host, plate, kind: job.kind, name: job.name } satisfies Site;
    }
    if (resolved && job.kind !== 'belde') unverified.push(`${job.kind}:${job.name}`);
    return null;
  });
  const sites = [...found.filter((s): s is Site => s !== null), ...seedsOf(plate)];
  const seen = new Set<string>();
  return { sites: sites.filter((s) => (seen.has(s.domain.replace(/^www\./, '')) ? false : (seen.add(s.domain.replace(/^www\./, '')), true))), unverified };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const plate = process.argv[2] ?? '20';
  const { sites, unverified } = await discoverPlate(plate, !process.argv.includes('--no-belde'));
  console.log(JSON.stringify(sites.map((s) => `${s.kind}:${s.name}:${s.domain}`)));
  console.log(`${plate}: ${sites.length} site, doğrulanamayan: ${unverified.join(', ')}`);
}
