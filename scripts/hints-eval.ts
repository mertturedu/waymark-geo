import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { createSearch } from '../src/core/address/search';
import { distanceM } from '../src/core/geo/distance';
import { createLearnedLayer } from '../src/core/learned/layer';
import type { PackStore } from '../src/core/ports';
import { createBorders } from '../src/core/region/borders';
import { nameKey } from '../src/core/text/fold';
import { streetKey } from '../src/core/text/street';
import { openSqlite } from '../src/node/sqlite';
import { repoRoot } from './addr-sets';
import { knownStreets } from './hints-build';

type Probe = { plate: string; district: string; street: string; number: string; point: [number, number]; radius: number };
type Row = { level: string; error: number; learned: boolean };

const packs = join(repoRoot, 'dist', 'work', '261028', 'packs');
const PER_PLATE = Number(process.env.EVAL_PER_PLATE ?? 40);
const DOORS = Number(process.env.EVAL_DOORS ?? 15);
const borders = createBorders(readFileSync(join(repoRoot, 'src', 'core', 'region', 'data', 'borders.bin')));

const pct = (list: number[], p: number): number => (list.length ? [...list].sort((a, b) => a - b)[Math.min(list.length - 1, Math.floor((list.length * p) / 100))]! : NaN);
const share = (n: number, d: number): string => (d ? `%${((100 * n) / d).toFixed(1)}` : '-');

async function pick(search: ReturnType<typeof createSearch>, text: string): Promise<{ point: [number, number]; level: string; learned: boolean } | null> {
  const r = await search.resolve(text);
  const best = r.status === 'resolved' ? r.best : r.status === 'ambiguous' ? r.candidates[0] : undefined;
  return best ? { point: best.coordinate as [number, number], level: best.components.street ? 'sokak' : best.components.neighbourhood ? 'mahalle' : 'ilçe', learned: best.source === 'learned' } : null;
}

export async function evaluate(): Promise<{ lines: string[]; totals: Record<string, number> }> {
  const totals = { missing: 0, covered: 0, within: 0, plates: 0, probes: 0, doors: 0, doorsSame: 0 };
  const hintErrors: number[] = [];
  const before: Row[] = [];
  const after: Row[] = [];
  const perPlate: string[] = [];
  for (let i = 1; i <= 81; i++) {
    const plate = String(i).padStart(2, '0');
    const dir = join(packs, plate);
    if (!existsSync(join(dir, 'learned.sqlite')) || !existsSync(join(dir, 'directory.sqlite'))) continue;
    const addr = new DatabaseSync(join(dir, 'address.sqlite'), { readOnly: true });
    const directory = new DatabaseSync(join(dir, 'directory.sqlite'), { readOnly: true });
    const learned = new DatabaseSync(join(dir, 'learned.sqlite'), { readOnly: true });
    try {
      const known = knownStreets(addr);
      const hints = new Map<string, { lng: number; lat: number; radius: number }>();
      for (const h of learned.prepare('SELECT district, name, lng, lat, radius FROM hint').all() as { district: string; name: string; lng: number; lat: number; radius: number }[]) hints.set(`${h.district}|${streetKey(h.name).key}`, h);
      const rows = directory.prepare('SELECT p.lon lon, p.lat lat, d.name district, t.text street, i.number number FROM poi p JOIN poi_info i ON i.id = p.id JOIN info_text t ON t.id = i.street JOIN district d ON d.id = p.district_id WHERE i.number IS NOT NULL').all() as { lon: number; lat: number; district: string; street: string; number: string }[];
      let missing = 0;
      let covered = 0;
      const probes: Probe[] = [];
      const seen = new Set<string>();
      for (const r of rows) {
        const key = streetKey(r.street).key;
        if (key === '') continue;
        const id = `${nameKey(r.district)}|${key}`;
        if (known.byDistrict.has(id)) continue;
        missing++;
        const h = hints.get(id);
        if (!h) continue;
        covered++;
        const point: [number, number] = [r.lon / 1e6, r.lat / 1e6];
        const err = distanceM(point, [h.lng / 1e6, h.lat / 1e6]);
        hintErrors.push(err);
        if (err <= h.radius) totals.within++;
        if (!seen.has(`${id}|${r.number}`)) {
          seen.add(`${id}|${r.number}`);
          probes.push({ plate, district: r.district, street: r.street, number: r.number, point, radius: h.radius });
        }
      }
      totals.missing += missing;
      totals.covered += covered;
      totals.plates++;
      const base: PackStore = { installed: async () => [plate], open: async () => openSqlite(join(dir, 'address.sqlite')), openPart: async () => null };
      const withHints: PackStore = { ...base, openPart: async (_r, kind) => (kind === 'learned' ? openSqlite(join(dir, 'learned.sqlite')) : null) };
      const without = createSearch({ store: base, borders });
      const withLayer = createSearch({ store: withHints, borders, layers: [createLearnedLayer(withHints)] });
      const step = Math.max(1, Math.floor(probes.length / PER_PLATE));
      for (let k = 0; k < probes.length && k / step < PER_PLATE; k += step) {
        const p = probes[k]!;
        const text = `${p.street} No:${p.number} ${p.district}`;
        const a = await pick(without, text);
        const b = await pick(withLayer, text);
        totals.probes++;
        before.push({ level: a?.level ?? 'yok', error: a ? distanceM(a.point, p.point) : Infinity, learned: false });
        after.push({ level: b?.level ?? 'yok', error: b ? distanceM(b.point, p.point) : Infinity, learned: !!b?.learned });
      }
      const doors = addr.prepare('SELECT n.name street, a.number number, d.name district FROM address a JOIN street_name n ON n.id = a.street_id JOIN district d ON d.id = a.district_id WHERE a.number IS NOT NULL ORDER BY (a.id * 2654435761) % 1000003 LIMIT ?').all(DOORS) as { street: string; number: string; district: string }[];
      for (const d of doors) {
        const text = `${d.street} No:${d.number} ${d.district}`;
        const a = await pick(without, text);
        const b = await pick(withLayer, text);
        totals.doors++;
        if ((!a && !b) || (a && b && distanceM(a.point, b.point) < 1 && a.level === b.level)) totals.doorsSame++;
        else console.error(`değişen: ${plate} ${text} | önce ${a?.level} ${a?.point} | sonra ${b?.level} ${b?.point} ${b?.learned}`);
      }
      perPlate.push(`| ${plate} | ${missing} | ${covered} | ${share(covered, missing)} |`);
    } finally {
      addr.close();
      directory.close();
      learned.close();
    }
  }
  const level = (rows: Row[]): string => ['sokak', 'mahalle', 'ilçe', 'yok'].map((l) => `${l} ${share(rows.filter((r) => r.level === l).length, rows.length)}`).join(', ');
  const errs = (rows: Row[]): number[] => rows.map((r) => r.error).filter((e) => Number.isFinite(e));
  const within = (rows: Row[], m: number): string => share(rows.filter((r) => r.error <= m).length, rows.length);
  const lines = [
    `# Paket testi (bağımsız ölçü: Overture işletme adresleri)`,
    ``,
    `Güncelleme: ${new Date().toISOString()}`,
    ``,
    `Yöntem: rehber paketindeki (Overture) işletmelerden, sokağı adres paketinde ilçe genelinde bulunmayanlar seçilir. İpucu paketinde o sokak varsa, işletmenin gerçek konumu ile ipucu konumu karşılaştırılır. Belediye ve açık veri kaynaklarından bağımsız bir ölçüdür. Not: Overture işletmelerinden çıkarılan ipuçları aynı işletmelerle sınandığı için bölüm 1 onlar için bağımsız değildir; onların bağımsız ölçüsü overture-ipucu.md içindedir (OSM'deki gerçek sokaklarla karşılaştırma).`,
    ``,
    `## 1. İpucu paketi boşlukların ne kadarını dolduruyor?`,
    ``,
    `- Sokağı adres paketinde olmayan işletme sayısı: ${totals.missing} (${totals.plates} il)`,
    `- Bunlardan ipucu paketinde sokağı olan: ${totals.covered} (${share(totals.covered, totals.missing)})`,
    `- İpucu konumu işletmenin gerçek konumunu kapsıyor (yarıçap içinde): ${share(totals.within, totals.covered)}`,
    `- İpucu ile gerçek konum arası uzaklık: ortanca ${Math.round(pct(hintErrors, 50))} m, %90'ı ${Math.round(pct(hintErrors, 90))} m altında`,
    ``,
    `## 2. Arama sonucu: ipucu yokken ve varken (${totals.probes} sorgu, "sokak No:x ilçe")`,
    ``,
    `| | İpucu yok | İpucu var |`,
    `|---|---|---|`,
    `| Bulunan düzey | ${level(before)} | ${level(after)} |`,
    `| Gerçek konuma 500 m içinde | ${within(before, 500)} | ${within(after, 500)} |`,
    `| 1 km içinde | ${within(before, 1000)} | ${within(after, 1000)} |`,
    `| 2 km içinde | ${within(before, 2000)} | ${within(after, 2000)} |`,
    `| Ortanca hata | ${Math.round(pct(errs(before), 50))} m | ${Math.round(pct(errs(after), 50))} m |`,
    `| %90'ı şu uzaklığın altında | ${Math.round(pct(errs(before), 90))} m | ${Math.round(pct(errs(after), 90))} m |`,
    `| "learned" kaynaklı sonuç | - | ${share(after.filter((r) => r.learned).length, after.length)} |`,
    ``,
    `## 3. Mevcut sonuçlar bozuldu mu? (pakette olan sokaklar)`,
    ``,
    `${totals.doors} kapı sorgusunda ipucu paketi açıkken sonuç değişmedi: ${totals.doorsSame} (${share(totals.doorsSame, totals.doors)})`,
    ``,
    `## İl bazında kapsama`,
    ``,
    `| İl | Sokağı pakette olmayan işletme | İpucu olan | Oran |`,
    `|---|---|---|---|`,
    ...perPlate,
  ];
  writeFileSync(join(homedir(), 'Desktop', 'yuksi-geo-raporlar', 'faz-19', 'paket-testi.md'), lines.join('\n') + '\n');
  return { lines, totals };
}

async function main(): Promise<void> {
  const { lines } = await evaluate();
  console.log(lines.slice(0, 31).join('\n'));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
