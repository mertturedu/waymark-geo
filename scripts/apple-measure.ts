import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import type { LngLat } from '../src/core/geo/cells';
import { distanceM } from '../src/core/geo/distance';
import { wayPoint } from '../src/core/learned/way';
import { streetKey } from '../src/core/text/street';
import { provinceName } from '../src/core/text/admin';
import { repoRoot } from './addr-sets';
import { matchStreet, type Raw } from './apple-judge';

const work = join(repoRoot, 'dist', 'work', '261028', 'packs');
const oldRelease = join(repoRoot, 'dist', 'packs-0.16-tek');
const dir = join(repoRoot, 'dist', 'apple');
export const MEASURE_DIRS = { queries: join(dir, 'queries-olcum'), raw: join(dir, 'raw-olcum') };
const SCALE = 1e6;
const HELD_OUT_PER_WAY = 8;
const FRESH_PER_WAY = 2;
const FRESH_RADIUS_M = 1500;

type Row = { district: string; name: string; lng: number; lat: number; radius: number; sources: number; origin: number };
export type Held = { plate: string; district: string; name: string; number: number; truth: LngLat };
export type Case = { plate: string; district: string; name: string; centre: LngLat; radiusM: number; way: { line: LngLat[]; doors: [number, number][] } | null; held: Held[]; nearestM: number | null; old: { centre: LngLat; radiusM: number; way: boolean } | null };

const point = (lng: number, lat: number): LngLat => [lng / SCALE, lat / SCALE];
const quantile = (list: number[], q: number): number | null => (list.length === 0 ? null : [...list].sort((a, b) => a - b)[Math.min(list.length - 1, Math.floor(q * list.length))]!);
const fmt = (v: number | null): string => (v === null ? '-' : `${Math.round(v)} m`);
const pct = (n: number, d: number): string => (d === 0 ? '-' : `%${((100 * n) / d).toFixed(1)}`);
const jsonl = <T>(file: string): T[] => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as T) : []);

function oldFile(plate: string): string | null {
  const d = join(oldRelease, plate);
  if (!existsSync(d)) return null;
  const f = readdirSync(d).find((n) => /^learned-[0-9a-f]+\.sqlite$/.test(n));
  return f ? join(d, f) : null;
}

export function casesOf(plate: string): Case[] {
  const file = join(work, plate, 'learned.sqlite');
  const dirFile = join(work, plate, 'directory.sqlite');
  if (!existsSync(file) || !existsSync(dirFile)) return [];
  const db = new DatabaseSync(file, { readOnly: true });
  const dir = new DatabaseSync(dirFile, { readOnly: true });
  const oldPath = oldFile(plate);
  const old = oldPath ? new DatabaseSync(oldPath, { readOnly: true }) : null;
  try {
    const rows = db.prepare('SELECT district, name, lng, lat, radius, sources, origin FROM hint WHERE origin = 1 ORDER BY district, name').all() as Row[];
    const ways = new Map((db.prepare('SELECT district, name, line, doors FROM way').all() as { district: string; name: string; line: string; doors: string }[]).map((w) => [`${w.district}|${w.name}`, w]));
    const out: Case[] = [];
    for (const r of rows) {
      const w = ways.get(`${r.district}|${r.name}`);
      const way = w ? { line: JSON.parse(w.line) as number[][], doors: JSON.parse(w.doors) as [number, number][] } : null;
      const line = way ? way.line.map(([x, y]): LngLat => point(x!, y!)) : [];
      const used = new Set(way?.doors.map(([n]) => n) ?? []);
      const key = streetKey(r.name).key;
      const held = (dir.prepare('SELECT a.num num, a.lon lon, a.lat lat FROM address a JOIN street_name s ON s.id = a.street_id JOIN district d ON d.id = a.district_id WHERE d.key = ? AND s.key = ? AND a.num IS NOT NULL ORDER BY a.num').all(r.district, key) as { num: number; lon: number; lat: number }[])
        .filter((a) => !used.has(a.num))
        .map((a): Held => ({ plate, district: r.district, name: r.name, number: a.num, truth: point(a.lon, a.lat) }));
      const seen = new Set<number>();
      const pick = held.filter((h) => (seen.has(h.number) ? false : (seen.add(h.number), true)));
      const step = Math.max(1, Math.floor(pick.length / HELD_OUT_PER_WAY));
      const o = old ? (old.prepare('SELECT lng, lat, radius FROM hint WHERE district = ? AND name = ?').get(r.district, r.name) as { lng: number; lat: number; radius: number } | undefined) : undefined;
      const oWay = old ? (old.prepare('SELECT 1 x FROM way WHERE district = ? AND name = ?').get(r.district, r.name) as { x: number } | undefined) : undefined;
      out.push({
        plate,
        district: r.district,
        name: r.name,
        centre: point(r.lng, r.lat),
        radiusM: r.radius,
        way: way ? { line, doors: way.doors } : null,
        held: pick.filter((_, i) => i % step === 0).slice(0, HELD_OUT_PER_WAY),
        nearestM: held.length > 0 ? Math.min(...held.map((h) => distanceM(point(r.lng, r.lat), h.truth))) : null,
        old: o ? { centre: point(o.lng, o.lat), radiusM: o.radius, way: Boolean(oWay) } : null,
      });
    }
    return out;
  } finally {
    db.close();
    dir.close();
    old?.close();
  }
}

type Fresh = { id: string; plate: string; set: 'olcum'; text: string; district: string; center: LngLat; hood: null; street: string; number: string | null; truth: null; ours: null };

function plan(plates: string[]): void {
  mkdirSync(MEASURE_DIRS.queries, { recursive: true });
  let total = 0;
  for (const plate of plates) {
    const province = provinceName(plate) ?? plate;
    const out: Fresh[] = [];
    for (const c of casesOf(plate)) {
      const idBase = `o-${plate}-${out.length}`;
      if (c.way) {
        const have = new Set(c.way.doors.map(([n]) => n));
        const numbers = c.held.map((h) => h.number).filter((n) => !have.has(n));
        const lo = Math.min(...c.way.doors.map(([n]) => n));
        const hi = Math.max(...c.way.doors.map(([n]) => n));
        const fallback = [Math.round((lo + hi) / 2) | 1, Math.round((lo + hi) / 2 + 3) | 1].filter((n) => !have.has(n));
        for (const n of (numbers.length >= FRESH_PER_WAY ? [numbers[0]!, numbers[numbers.length - 1]!] : [...numbers, ...fallback]).slice(0, FRESH_PER_WAY)) {
          out.push({ id: `${idBase}-${n}`, plate, set: 'olcum', text: `${c.name} No:${n} ${c.district} ${province}`, district: c.district, center: c.centre, hood: null, street: c.name, number: String(n), truth: null, ours: null });
        }
      } else {
        out.push({ id: `${idBase}-s`, plate, set: 'olcum', text: `${c.name}, ${c.district}, ${province}`, district: c.district, center: c.centre, hood: null, street: c.name, number: null, truth: null, ours: null });
      }
    }
    if (out.length > 0) writeFileSync(join(MEASURE_DIRS.queries, `${plate}.jsonl`), out.map((q) => JSON.stringify(q)).join('\n') + '\n');
    total += out.length;
  }
  console.log(JSON.stringify({ queries: total }));
}

function summary(list: number[]): string {
  return `${list.length} | ${fmt(quantile(list, 0.5))} | ${fmt(quantile(list, 0.9))} | ${pct(list.filter((e) => e <= 50).length, list.length)} | ${pct(list.filter((e) => e <= 100).length, list.length)}`;
}

function score(plates: string[]): void {
  const waysNew: number[] = [];
  const waysOld: number[] = [];
  const centreNew: number[] = [];
  const nearNew: number[] = [];
  const nearOld: number[] = [];
  const nearest: number[] = [];
  const better: number[] = [];
  const newNoOld: number[] = [];
  let wayCases = 0;
  let wayWithHeld = 0;
  let hintOnly = 0;
  let hintOnlyHeld = 0;
  let oldHadWay = 0;
  const circleErr: number[] = [];
  const circleIn: number[] = [];
  const freshWay: number[] = [];
  const freshHint: number[] = [];
  let freshAsked = 0;
  let freshAnswered = 0;
  let freshRejected = 0;
  const perPlate: string[] = [];
  for (const plate of plates) {
    const cases = casesOf(plate);
    if (cases.length === 0) continue;
    for (const c of cases) {
      if (c.way) {
        wayCases++;
        if (c.old?.way) oldHadWay++;
        if (c.held.length > 0) wayWithHeld++;
        for (const h of c.held) {
          const p = wayPoint({ line: c.way.line, doors: c.way.doors }, h.number);
          if (!p) continue;
          const eNew = distanceM(p, h.truth);
          waysNew.push(eNew);
          centreNew.push(distanceM(c.centre, h.truth));
          if (c.old) {
            const eOld = distanceM(c.old.centre, h.truth);
            if (distanceM(c.centre, h.truth) <= c.radiusM + 300) {
              nearNew.push(eNew);
              nearOld.push(eOld);
            }
            waysOld.push(eOld);
            better.push(eNew < eOld ? 1 : 0);
          } else newNoOld.push(eNew);
        }
      } else {
        hintOnly++;
        if (c.held.length > 0) hintOnlyHeld++;
        if (c.nearestM !== null) nearest.push(c.nearestM);
        for (const h of c.held) {
          const e = distanceM(c.centre, h.truth);
          circleErr.push(e);
          circleIn.push(e <= c.radiusM ? 1 : 0);
        }
      }
    }
    const byId = new Map(cases.map((c) => [`${c.district}|${c.name}`, c]));
    const fresh = jsonl<{ id: string; district: string; street: string; number: string | null }>(join(MEASURE_DIRS.queries, `${plate}.jsonl`));
    const raws = new Map(jsonl<Raw>(join(MEASURE_DIRS.raw, `${plate}.jsonl`)).map((r) => [r.id, r]));
    for (const q of fresh) {
      const r = raws.get(q.id);
      const c = byId.get(`${q.district}|${q.street}`);
      if (c) freshAsked++;
      if (!r || r.status !== 'ok' || !r.results?.length || !c) continue;
      freshAnswered++;
        const hit = r.results.find((x) => x.lat !== undefined && x.lng !== undefined && matchStreet(q.street, x.thoroughfare) === 'exact' && (q.number === null || x.subThoroughfare === q.number) && distanceM([x.lng!, x.lat!], c.centre) <= FRESH_RADIUS_M);
      if (!hit) {
        freshRejected++;
        continue;
      }
      const p: LngLat = [hit.lng!, hit.lat!];
      if (q.number !== null && c.way) {
        const w = wayPoint({ line: c.way.line, doors: c.way.doors }, Number(q.number));
        if (w) freshWay.push(distanceM(w, p));
      } else freshHint.push(distanceM(c.centre, p));
    }
    perPlate.push(`${plate}: ${cases.length}`);
  }
  const text = [
    '# Apple verisinin bağımsız ölçümü (0.17-apple)',
    '',
    `Güncelleme: ${new Date().toISOString()}`,
    '',
    'İki ölçü kullanıldı. **A (Apple dışı)**: Overture rehberinde bu sokakta kapı numarası olan, Apple çizgisinin kurulmasında kullanılmayan (sorulmayan) numaralar. Doğru nokta Overture rehber noktasıdır (OSM kapılarına göre ortanca 15 m sapma, bu yüzden küçük hatalar gürültüdür). **B (yeni Apple sorgusu)**: beslemede kullanılmamış yeni numara ve yazımla Apple\'a sorulan sorgular. B yalnızca Apple ile tutarlılığı gösterir, doğruluk kanıtı değildir.',
    '',
    `Apple kaynaklı ipucu: ${wayCases + hintOnly} (çizgili ${wayCases}, yalnız daire ${hintOnly}). Çizgili olanlardan Overture'da boşta numarası olan: ${wayWithHeld}. Yalnız daire olanlardan Overture'da sokak kapısı olan: ${hintOnlyHeld}. Eski pakette (0.16) zaten ipucu olup çizgiyle değişen: ${oldHadWay}.`,
    '',
    '## A: Apple çizgisinin sorulmamış numaralarda hatası (Overture noktasına göre)',
    '',
    '| Yöntem | Örnek | Ortanca | %90 | 50 m içinde | 100 m içinde |',
    '|---|---|---|---|---|---|',
    `| Yeni: Apple çizgisinden kapı konumu | ${summary(waysNew)} |`,
    `| Yeni ipucunun merkezi (daire merkezi) | ${summary(centreNew)} |`,
    `| Eski paket (0.16) ipucu merkezi (çizgi olmadan) | ${summary(waysOld)} |`,
    `| Aynı sokak adının başka mahalledeki noktaları elenmiş (ipucu merkezine ≤ yarıçap + 300 m): yeni çizgi | ${summary(nearNew)} |`,
    `| Aynı elenmiş örnekler: eski paket ipucu merkezi | ${summary(nearOld)} |`,
    '',
    `Eski pakette ipucu olan ve çizgiyle değişen: ${waysOld.length > 0 ? `${better.length} karşılaştırma, çizgi daha yakın: ${pct(better.reduce((a, b) => a + b, 0), better.length)}` : '-'}. Eski pakette hiç ipucu olmayan sokaklarda (yeni kapsam) çizgi hatası: ${newNoOld.length} örnek, ortanca ${fmt(quantile(newNoOld, 0.5))}.`,
    '',
    '## A2: Yalnız daire olan Apple ipuçlarının Overture ile çelişkisi (süzgeçten sonra 0 olmalı)',
    '',
    '| Ölçü | Örnek | Ortanca | %90 | 50 m içinde | 100 m içinde |',
    '|---|---|---|---|---|---|',
    `| Daire merkezi ile Overture kapı noktası arası | ${summary(circleErr)} |`,
    '',
    `Aynı adlı sokağın Overture'daki en yakın kapısı ipucu merkezine: ortanca ${fmt(quantile(nearest, 0.5))}, %90 ${fmt(quantile(nearest, 0.9))}, daire yarıçapı içinde ya da 300 m içinde: ${pct(nearest.filter((e) => e <= 300).length, nearest.length)} (${nearest.length} sokak).`,
    '',
    `Overture noktası ipucu dairesinin içinde: ${pct(circleIn.reduce((a, b) => a + b, 0), circleIn.length)} (${circleIn.length} örnek, ${hintOnlyHeld} sokak).`,
    '',
    '## B: Yeni Apple sorgularıyla tutarlılık',
    '',
    `Sorulan: ${freshAsked}, cevap gelen: ${freshAnswered}, doğrulamadan geçmeyen (başka sokak, numara ya da ${FRESH_RADIUS_M} m dışı): ${freshRejected}.`,
    '',
    '| Ölçü | Örnek | Ortanca | %90 | 50 m içinde | 100 m içinde |',
    '|---|---|---|---|---|---|',
    `| Çizgi tahmini ile yeni Apple kapısı arası | ${summary(freshWay)} |`,
    `| Yalnız daire merkezi ile yeni Apple sokak cevabı arası (aynı servis aynı soruya aynı cevabı verdiği için bilgi vermez) | ${summary(freshHint)} |`,
    '',
  ].join('\n');
  writeFileSync(join(homedir(), 'Desktop', 'yuksi-geo-raporlar', 'faz-19', 'apple-bagimsiz-olcum.md'), text);
  console.log(text);
}

function main(): void {
  const mode = process.argv[2];
  const only = process.argv.slice(3).filter((a) => /^\d{2}$/.test(a));
  const plates = only.length ? only : Array.from({ length: 81 }, (_, i) => String(i + 1).padStart(2, '0'));
  if (mode === 'plan') plan(plates);
  else if (mode === 'score') score(plates);
  else console.error('kullanım: apple-measure.ts plan|score [plaka...]');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
