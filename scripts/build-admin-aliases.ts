import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { nameKey } from '../src/core/text/fold';
import { repoRoot } from './addr-sets';

export type AliasFile = {
  province: Record<string, string[]>;
  district: Record<string, Record<string, string[]>>;
  hood: Record<string, Record<string, Record<string, string[]>>>;
};

const SUFFIX = /\s+(mahallesi|mahalle|mah\.?|mh\.?|köyü|köy|belediyesi|beldesi)$/;
const LATIN = /^[A-Za-zÇĞİÖŞÜâîûÂÎÛçğıöşü0-9 .'’-]+$/;
const MAX_WORDS = 4;

export const shortKey = (name: string): string => nameKey(name.toLocaleLowerCase('tr-TR').replace(SUFFIX, ''));

type Raw = { kind: 'province' | 'district' | 'hood'; plate: string; district: string | null; name: string; aliases: string[] };

export function buildAliases(rows: Raw[], common: Set<string> = new Set()): AliasFile {
  const out: AliasFile = { province: {}, district: {}, hood: {} };
  const add = (list: string[], key: string, own: string): void => {
    if (key.length >= 3 && key !== own && key.split(' ').length <= MAX_WORDS && !list.includes(key)) list.push(key);
  };
  for (const row of rows) {
    const aliases = row.aliases.filter((a) => LATIN.test(a));
    if (aliases.length === 0) continue;
    const own = row.kind === 'hood' ? shortKey(row.name) : nameKey(row.name);
    if (row.kind === 'province') {
      const list = (out.province[row.plate] ??= []);
      for (const a of aliases) if (!common.has(nameKey(a))) add(list, nameKey(a), own);
    } else if (row.kind === 'district') {
      const list = ((out.district[row.plate] ??= {})[own] ??= []);
      for (const a of aliases) if (!common.has(nameKey(a))) add(list, nameKey(a), own);
    } else if (row.district) {
      const list = (((out.hood[row.plate] ??= {})[nameKey(row.district)] ??= {})[own] ??= []);
      for (const a of aliases) add(list, shortKey(a), own);
    }
  }
  for (const plate of Object.keys(out.hood)) {
    for (const district of Object.keys(out.hood[plate] as object)) {
      const hoods = (out.hood[plate] as Record<string, Record<string, string[]>>)[district] as Record<string, string[]>;
      for (const key of Object.keys(hoods)) if ((hoods[key] as string[]).length === 0) delete hoods[key];
      if (Object.keys(hoods).length === 0) delete (out.hood[plate] as Record<string, unknown>)[district];
    }
    if (Object.keys(out.hood[plate] as object).length === 0) delete out.hood[plate];
  }
  for (const plate of Object.keys(out.district)) {
    const districts = out.district[plate] as Record<string, string[]>;
    for (const key of Object.keys(districts)) if ((districts[key] as string[]).length === 0) delete districts[key];
    if (Object.keys(districts).length === 0) delete out.district[plate];
  }
  for (const plate of Object.keys(out.province)) if ((out.province[plate] as string[]).length === 0) delete out.province[plate];
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const input = process.argv[2] ?? join(repoRoot, 'dist', 'work', '261028', 'aliases.jsonl');
  const rows = readFileSync(input, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as Raw);
  const admin = join(repoRoot, 'dist', 'work', '261028', 'admin-full.jsonl');
  const common = new Set<string>();
  for (const line of readFileSync(admin, 'utf8').split('\n').filter(Boolean)) {
    const row = JSON.parse(line) as { level: number; names: { tr?: string } };
    if (row.names.tr && row.level >= 6) common.add(row.level === 8 ? shortKey(row.names.tr) : nameKey(row.names.tr));
  }
  const file = buildAliases(rows, common);
  const text = JSON.stringify(file);
  writeFileSync(join(repoRoot, 'src', 'core', 'text', 'data', 'admin-aliases.json'), text + '\n');
  const hoods = Object.values(file.hood).flatMap((d) => Object.values(d).flatMap((h) => Object.values(h))).reduce((n, list) => n + list.length, 0);
  console.log(`${(text.length / 1e3).toFixed(0)} KB; il ${Object.keys(file.province).length}, ilçe ${Object.values(file.district).reduce((n, d) => n + Object.keys(d).length, 0)}, mahalle takma adı ${hoods}`);
}
