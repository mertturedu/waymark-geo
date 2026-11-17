import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { nameKey } from '../src/core/text/fold';
import { openSqlite } from '../src/node/sqlite';
import { ask, MODELS } from '../tools/ollama';
import { rng, shuffle } from '../test/sim/random';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const WORK = join(repoRoot, 'dist', 'work', '261028', 'packs');
export const PLATES = ['34', '06', '35', '16', '41'];
export const MIN_PRECISION = 0.95;
const PER_PLATE = 60;

const SYSTEM = 'You help a Turkish address search engine. Given the official name of a street, list other written forms that people really use for the SAME street: common abbreviations (Cd., Sk., Blv.), spelling variants, shortened names and former names. Do not invent names, do not add numbers or districts. If you do not know a real alternative, return an empty list. Answer JSON.';
const SCHEMA = { type: 'object', properties: { aliases: { type: 'array', items: { type: 'string' }, maxItems: 3 } }, required: ['aliases'] } as const;

export type AliasReport = { streets: number; proposed: number; verified: number; agreed: number; agreedVerified: number; recall: number; precision: number; agreedPrecision: number; samples: string[] };

export async function runAliases(): Promise<{ report: AliasReport; text: string }> {
  const items: { plate: string; name: string; alts: Set<string> }[] = [];
  for (const plate of PLATES) {
    const db = openSqlite(join(WORK, plate, 'address.sqlite'));
    try {
      const rows = await db.all<{ id: number; key: string; name: string | null }>("SELECT ref AS id, key, name FROM search_name WHERE kind = 0 AND lang = 'tr' ORDER BY ref, id");
      const names = new Map((await db.all<{ id: number; name: string }>('SELECT id, name FROM street_name')).map((r) => [r.id, r.name]));
      const byStreet = new Map<number, Set<string>>();
      for (const r of rows) (byStreet.get(r.id) ?? byStreet.set(r.id, new Set()).get(r.id) as Set<string>).add(r.key);
      const withAlt = [...byStreet].filter(([id, keys]) => keys.size > 1 && names.has(id)).map(([id, keys]) => ({ plate, name: names.get(id) as string, alts: new Set([...keys].filter((k) => k !== nameKey(names.get(id) as string))) }));
      items.push(...shuffle(withAlt.filter((i) => i.alts.size > 0), rng(5151 + Number(plate))).slice(0, PER_PLATE));
    } finally {
      await db.close();
    }
  }
  const answers = new Map<string, string[][]>();
  for (const model of MODELS) {
    for (const item of items) {
      const got = await ask<{ aliases: string[] }>(model, SYSTEM, `Street: ${item.name}`, SCHEMA, { numPredict: 120 });
      const keys = (got?.aliases ?? []).map((a) => nameKey(a)).filter((k) => k !== '' && k !== nameKey(item.name));
      const id = `${item.plate}|${item.name}`;
      answers.set(id, [...(answers.get(id) ?? []), keys]);
    }
  }
  let proposed = 0;
  let verified = 0;
  let agreed = 0;
  let agreedVerified = 0;
  let found = 0;
  let wanted = 0;
  const samples: string[] = [];
  for (const item of items) {
    const [first = [], second = []] = answers.get(`${item.plate}|${item.name}`) ?? [];
    const union = new Set([...first, ...second]);
    wanted += item.alts.size;
    for (const key of union) {
      proposed++;
      const ok = item.alts.has(key);
      if (ok) verified++;
      if (first.includes(key) && second.includes(key)) {
        agreed++;
        if (ok) agreedVerified++;
      }
    }
    for (const key of item.alts) if (union.has(key)) found++;
    if (samples.length < 12) samples.push(`${item.name} → önerilen: ${[...union].join(', ') || '(yok)'}; gerçek: ${[...item.alts].join(', ')}`);
  }
  const report: AliasReport = { streets: items.length, proposed, verified, agreed, agreedVerified, recall: wanted === 0 ? 0 : found / wanted, precision: proposed === 0 ? 0 : verified / proposed, agreedPrecision: agreed === 0 ? 0 : agreedVerified / agreed, samples };
  const pct = (n: number): string => `%${(100 * n).toFixed(1)}`;
  const text = ['# Takma ad üretimi (yerel model)', '', `${items.length} sokak (5 il); her birinin OSM'de gerçek takma adı (alt, eski, kısa ad) var ve model bunu görmedi. Modeller: ${MODELS.join(' ve ')}. Doğru sayılan: önerilen yazılışın gizlenmiş gerçek takma adlardan biriyle (anahtarı) aynı olması. OSM'de olmayan ama gerçekten kullanılan bir yazılış yanlış sayılır; bu yüzden kesinlik alt sınırdır, fakat **doğrulanamayan takma ad pakete girmez** (plan ilkesi).`, '', '| Ölçü | Sonuç |', '|---|---|', `| Önerilen takma ad | ${proposed} |`, `| Gerçek takma adla aynı | ${verified} (kesinlik ${pct(report.precision)}) |`, `| İki modelin ikisinin de önerdiği | ${agreed}, gerçekle aynı ${agreedVerified} (kesinlik ${pct(report.agreedPrecision)}) |`, `| Gerçek takma adların bulunma oranı | ${pct(report.recall)} |`, `| Eşik | kesinlik ≥ ${pct(MIN_PRECISION)} |`, '', `**Sonuç:** ${report.agreedPrecision >= MIN_PRECISION && agreed >= 20 ? 'eşik geçildi' : 'eşik geçilmedi, hiçbir model takma adı pakete girmedi'}.`, '', 'Örnekler:', '', ...samples.map((s) => `- ${s}`), ''].join('\n');
  return { report, text };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runAliases().then(({ report, text }) => {
    const dir = join(homedir(), 'Desktop', 'yuksi-geo-raporlar');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'faz-16b-takma-ad.md'), text);
    console.log(JSON.stringify({ ...report, samples: undefined }));
  });
}
