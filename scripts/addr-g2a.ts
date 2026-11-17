import { pathToFileURL } from 'node:url';
import aliases from '../src/core/text/data/admin-aliases.json';
import { nameKey } from '../src/core/text/fold';
import { editDistance } from '../src/core/address/names';
import { readSet, seeded, pick, seedOf, updateManifest, writeSet, type TextRecord } from './addr-sets';

const SUFFIX = /\s+(mahallesi|mahalle|mah\.?|mh\.?|köyü|köy)$/;
const hoodData = aliases.hood as Record<string, Record<string, Record<string, string[]>>>;
const title = (key: string): string => key.split(' ').map((w) => w.charAt(0).toLocaleUpperCase('tr-TR') + w.slice(1)).join(' ');

export function oldNameRecords(plate: string, limit: number): TextRecord[] {
  const rng = seeded(seedOf(`g2a:${plate}`));
  const byHood = hoodData[plate] ?? {};
  const out: TextRecord[] = [];
  for (const r of readSet<TextRecord>('g2', plate)) {
    if (out.length >= limit) break;
    if (!r.hood || r.ops.includes('hood_drop') || r.ops.includes('hood_typo') || r.ops.includes('district_wrong')) continue;
    const list = byHood[nameKey(r.district)]?.[nameKey(r.hood.toLocaleLowerCase('tr-TR').replace(SUFFIX, ''))];
    if (!list) continue;
    const own = nameKey(r.hood);
    const far = list.filter((a) => a.replace(/ /g, '') !== own.replace(/ /g, '') && editDistance(a.replace(/ /g, ''), own.replace(/ /g, ''), 2) > 1);
    if (far.length === 0) continue;
    const alias = title(pick(rng, far));
    const re = new RegExp(r.hood.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    if (!re.test(r.text)) continue;
    out.push({ ...r, id: `${r.id}:g2a`, text: r.text.replace(re, alias), ops: [...r.ops, 'old_name'] });
  }
  return out;
}

async function main(): Promise<void> {
  const hashes: { [plate: string]: string } = {};
  for (const plate of Object.keys(hoodData).filter((p) => p.length === 2)) {
    const records = oldNameRecords(plate, 400);
    if (records.length < 20) continue;
    hashes[plate] = writeSet('g2a', plate, records);
  }
  updateManifest('g2a', hashes, { note: 'G2 kayıtlarında mahalle adı eski/takma adıyla değiştirildi (admin-aliases.json)' });
  console.log(`${Object.keys(hashes).length} il`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
