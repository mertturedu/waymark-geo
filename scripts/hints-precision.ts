import { existsSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { distanceM } from '../src/core/geo/distance';
import { nameKey } from '../src/core/text/fold';
import { streetKey } from '../src/core/text/street';
import { repoRoot } from './addr-sets';
import { partsOf } from './hints-geo';
import { hoodGeos, knownStreets, loadRaw, tight, type RawHint } from './hints-build';

type Raw = RawHint & { quotes?: string[]; via?: string[]; pages?: string[]; portal?: string };
export type Stat = { n: number; right: number };

const COMPACT_M = 3000;
const packs = join(repoRoot, 'dist', 'work', '261028', 'packs');
const add = (m: Map<string, Stat>, key: string, right: boolean): void => {
  const s = m.get(key) ?? { n: 0, right: 0 };
  s.n++;
  if (right) s.right++;
  m.set(key, s);
};

export function measure(): { all: Map<string, Stat>; wrong: { plate: string; hood: string; street: string; quote: string; kind: string }[] } {
  const all = new Map<string, Stat>();
  const wrong: { plate: string; hood: string; street: string; quote: string; kind: string }[] = [];
  for (let i = 1; i <= 81; i++) {
    const plate = String(i).padStart(2, '0');
    const file = join(packs, plate, 'address.sqlite');
    if (!existsSync(file)) continue;
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      const bySid = new Map(hoodGeos(db).filter((h) => h.sid).map((h) => [h.sid as string, h]));
      const known = knownStreets(db);
      const parts = partsOf(db);
      const raw = loadRaw(plate, false, true) as Raw[];
      const hoodsOf = new Map<string, Set<string>>();
      for (const h of raw) {
        const hood = h.sid ? bySid.get(h.sid) : undefined;
        if (hood) hoodsOf.set(`${nameKey(hood.district)}|${streetKey(h.street).key}`, (hoodsOf.get(`${nameKey(hood.district)}|${streetKey(h.street).key}`) ?? new Set()).add(hood.sid as string));
      }
      for (const h of raw) {
        const hood = h.sid ? bySid.get(h.sid) : undefined;
        if (!hood) continue;
        const key = streetKey(h.street).key;
        if ((hoodsOf.get(`${nameKey(hood.district)}|${key}`)?.size ?? 0) > 1) continue;
        if (!known.byDistrict.has(`${nameKey(hood.district)}|${key}`)) continue;
        const located = parts.get(`${nameKey(hood.district)}|${key}`) ?? [];
        const flat = located.flatMap((p) => p.points);
        const compact = flat.length > 0 && flat.every((pt) => distanceM(flat[0]!, pt) <= COMPACT_M);
        const near = located.some((p) => p.points.some((pt) => distanceM(hood.centre, pt) <= hood.radiusM + 200));
        const right = known.byHood.has(`${hood.id}|${key}`) || near;
        const quote = (h.quotes ?? [])[0] ?? '';
        const isTight = !!h.source || (h.quotes ?? []).some((q) => tight(q, h.hood, h.street));
        const kind = h.source === 'bekleyen' ? `bekleyen ${h.portal ?? ''}` : h.source ? 'açık veri' : h.via?.includes('liste') ? 'liste' : h.via?.includes('qwen') ? 'qwen' : 'kural';
        if (!compact) continue;
        add(all, `${kind} / ${/^\d/.test(h.street) ? 'sayı adlı' : 'adlı'}`, right);
        const crowded = (nameKey(quote).match(/\b(?:mah|mahallesi|mahalle|mh)\b/g) ?? []).length > 1;
        for (const k of [`${kind} / bitişik=${isTight} / ${crowded ? 'çok mahalle' : 'tek mahalle'}`, `${kind} / bitişik=${isTight} / ${(h.sources ?? 1) >= 3 ? '≥3 kaynak' : '<3 kaynak'}`, `${kind} / bitişik=${isTight} / ${h.pages?.some((u) => /\.pdf/i.test(u)) ? 'pdf' : 'sayfa'}`]) add(all, k, right);
        for (const k of [`${kind} / tümü`, `${kind} / ${isTight ? 'bitişik' : 'bitişik değil'}`, `${kind} / ${isTight ? 'bitişik' : 'bitişik değil'} / ${(h.sources ?? 1) >= 2 ? '≥2 kaynak' : '1 kaynak'}`, 'hepsi', isTight ? 'hepsi bitişik' : 'hepsi bitişik değil']) add(all, k, right);
        if (!right && isTight && wrong.length < 400) wrong.push({ plate, hood: h.hood, street: h.street, quote, kind });
      }
    } finally {
      db.close();
    }
  }
  return { all, wrong };
}

const pct = (s: Stat): string => (s.n ? `%${((100 * s.right) / s.n).toFixed(1)}` : '-');

async function main(): Promise<void> {
  const { all, wrong } = measure();
  const rows = [...all.entries()].sort().map(([k, s]) => `| ${k} | ${s.n} | ${s.right} | ${pct(s)} |`);
  const sample = wrong.filter((_, i) => i % Math.max(1, Math.floor(wrong.length / 30)) === 0).slice(0, 30).map((w) => `| ${w.plate} | ${w.kind} | ${w.hood} | ${w.street} | ${w.quote.slice(0, 160).replace(/\|/g, '/')} |`);
  const out = `# İpucu doğruluk ölçümü\n\nGüncelleme: ${new Date().toISOString()}\n\nYöntem: sokak adı paket verisinde ilçe genelinde bulunan ve tek bir yerde duran (tüm parçalar birbirine 3 km içinde) ve ilçede yalnızca bir mahalleye bağlanan iddialar sınanır; çok mahalleli aynı adlı sokaklar (Atatürk Caddesi gibi) ürüne zaten girmediği için dışarıda tutulur. Paket o sokağı iddia edilen mahallede gösteriyorsa ya da sokağın bir parçası mahallenin çevresine (mahalle yarıçapı + 200 m) düşüyorsa "doğru" sayılır. OSM eksik olduğu ve aynı adı taşıyan başka sokaklar bulunduğu için bu değer gerçek doğruluğun alt sınırıdır.\n\n| Küme | Sınanan | Doğru | Oran |\n|---|---|---|---|\n${rows.join('\n')}\n\n## Bitişik olduğu halde paketle uyuşmayan örnekler\n\n| İl | Tür | Mahalle | Sokak | Alıntı |\n|---|---|---|---|---|\n${sample.join('\n')}\n`;
  writeFileSync(join(homedir(), 'Desktop', 'yuksi-geo-raporlar', 'faz-19', 'ipucu-dogruluk.md'), out);
  for (const [k, s] of [...all.entries()].sort()) console.log(`${k}: ${s.right}/${s.n} ${pct(s)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
