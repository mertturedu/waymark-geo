import { readdirSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createGeoServer, type GeoServer } from '../server';
import { provinceName } from '../src/core/text/admin';
import type { LngLat } from '../src/core/geo/cells';
import { rng, shuffle } from '../test/sim/random';
import { readSet, type TextRecord } from './addr-sets';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
export const CHECKS = ['parity', 'speed', 'resources', 'privacy', 'compare'];
export const PLATES = ['34', '06', '35', '41', '16'];
export const LIMITS = { geocodeP95Ms: 50, autocompleteP95Ms: 20, residentMb: 4096 };
const PACKS = process.env.GEO_PACKS_DIR ?? join(repoRoot, 'dist', 'packs-0.8-adres');
const KEY = 'olcum-anahtari';
const PER_PLATE = 120;
const SEED = 2016;

export type Measured = { check: string; pass: boolean; measured: string; report: string };

const mb = (bytes: number): string => (bytes / 1048576).toFixed(0);
const quantile = (values: number[], q: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length === 0 ? 0 : (sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] as number);
};

type Running = { base: string; server: GeoServer; lines: string[]; stop: () => Promise<void> };

async function start(options: { maxOpen?: number } = {}): Promise<Running> {
  const lines: string[] = [];
  const server = createGeoServer({ packsDir: PACKS, keys: [{ id: 'olcum', secret: KEY, rps: 100_000 }], log: (line) => lines.push(line), ...(options.maxOpen ? { maxOpen: options.maxOpen } : {}) });
  const port = await server.listen(0);
  return { base: `http://127.0.0.1:${port}`, server, lines, stop: () => server.close() };
}

const post = async (base: string, path: string, body: unknown): Promise<unknown> => (await fetch(`${base}${path}`, { method: 'POST', headers: { 'x-api-key': KEY, 'content-type': 'application/json' }, body: JSON.stringify(body) })).json();
const get = async (base: string, path: string): Promise<unknown> => (await fetch(`${base}${path}`, { headers: { 'x-api-key': KEY } })).json();
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(JSON.parse(JSON.stringify(b)));

function texts(): { plate: string; text: string; point: LngLat }[] {
  const out: { plate: string; text: string; point: LngLat }[] = [];
  for (const plate of PLATES) {
    const records = shuffle(readSet<TextRecord>('g2', plate), rng(SEED + Number(plate))).slice(0, PER_PLATE);
    for (const r of records) out.push({ plate, text: r.text, point: [r.lng, r.lat] });
  }
  return out;
}

async function checkParity(): Promise<Measured> {
  const run = await start();
  const items = texts();
  let total = 0;
  let different = 0;
  const kinds = { geocode: 0, validate: 0, autocomplete: 0, reverse: 0, places: 0 };
  const compare = (kind: keyof typeof kinds, ok: boolean): void => {
    total++;
    kinds[kind]++;
    if (!ok) different++;
  };
  try {
    const search = run.server.search;
    for (const item of items) {
      compare('geocode', same(await post(run.base, '/v1/geocode', { q: item.text }), await search.resolve(item.text)));
      compare('validate', same(await post(run.base, '/v1/validate', { q: item.text }), await search.validate(item.text)));
      const prefix = item.text.slice(0, Math.max(3, Math.floor(item.text.length * 0.6)));
      compare('autocomplete', same(await post(run.base, '/v1/autocomplete', { q: prefix }), { places: await search.autocomplete(prefix) }));
      compare('reverse', same(await get(run.base, `/v1/reverse?lng=${item.point[0]}&lat=${item.point[1]}&heading=90&accuracyM=12`), { place: await search.reverse(item.point, { heading: 90, accuracyM: 12 }) }));
    }
    for (const item of items.filter((_, i) => i % 15 === 0)) {
      const query = new URLSearchParams({ lng: String(item.point[0]), lat: String(item.point[1]), group: 'pharmacy', radiusM: '1500', limit: '5' });
      compare('places', same(await get(run.base, `/v1/places?${query}`), { hits: await search.nearby({ point: item.point, group: 'pharmacy', radiusM: 1500, limit: 5 }) }));
    }
  } finally {
    await run.stop();
  }
  const measured = `${total} istek (${Object.entries(kinds).map(([k, n]) => `${k} ${n}`).join(', ')}): sunucu cevabı çekirdekle ${different === 0 ? 'birebir aynı' : `${different} farklı`}`;
  return { check: 'parity', pass: different === 0 && total > 0, measured, report: `# Sunucu eşliği\n\n${measured}\n\nKarşılaştırma: HTTP cevabı (JSON) ile aynı paketlerden kurulmuş çekirdek aramanın sonucu. Telefon ile çekirdek eşliği ayrıca cihaz testlerinde (\`sdk.addr-*\`, Node ile birebir) ve \`sdk.addr-online\` testinde ölçülür.\n` };
}

async function checkSpeed(): Promise<Measured> {
  const run = await start();
  const items = texts();
  try {
    const cold: Record<string, number> = {};
    for (const plate of PLATES) {
      const first = items.find((i) => i.plate === plate) as { text: string };
      const started = performance.now();
      await post(run.base, '/v1/geocode', { q: first.text });
      cold[plate] = performance.now() - started;
    }
    const geocode: number[] = [];
    const autocomplete: number[] = [];
    const unhinted: number[] = [];
    const typing = rng(SEED);
    for (const item of items) {
      let started = performance.now();
      await post(run.base, '/v1/geocode', { q: item.text });
      geocode.push(performance.now() - started);
      const upTo = Math.min(40, item.text.length);
      const prefix = item.text.slice(0, 3 + Math.floor(typing() * Math.max(1, upTo - 3)));
      started = performance.now();
      await post(run.base, '/v1/autocomplete', { q: prefix, city: provinceName(item.plate) });
      autocomplete.push(performance.now() - started);
      started = performance.now();
      await post(run.base, '/v1/autocomplete', { q: prefix });
      unhinted.push(performance.now() - started);
    }
    const started = performance.now();
    const queue = [...items];
    const workers = Array.from({ length: 8 }, async () => {
      for (let item = queue.pop(); item; item = queue.pop()) await post(run.base, '/v1/geocode', { q: item.text });
    });
    await Promise.all(workers);
    const perSecond = (items.length / (performance.now() - started)) * 1000;
    const measured = `${items.length} sorgu (5 il, ısınmış): geocode p50 ${quantile(geocode, 0.5).toFixed(1)} ms, p95 ${quantile(geocode, 0.95).toFixed(1)} ms; autocomplete (il ipucuyla) p50 ${quantile(autocomplete, 0.5).toFixed(1)} ms, p95 ${quantile(autocomplete, 0.95).toFixed(1)} ms, ipucusuz p95 ${quantile(unhinted, 0.95).toFixed(1)} ms; 8 eşzamanlı istemci ${perSecond.toFixed(0)} geocode/sn; ilk istek (il açılışı) ${Object.entries(cold).map(([p, ms]) => `${p}: ${ms.toFixed(0)} ms`).join(', ')}`;
    const pass = quantile(geocode, 0.95) <= LIMITS.geocodeP95Ms && quantile(autocomplete, 0.95) <= LIMITS.autocompleteP95Ms;
    return { check: 'speed', pass, measured, report: `# Sunucu hızı\n\n${measured}\n\nSüre istemci tarafında ölçülür (yerel HTTP dahil). Autocomplete ipucu olarak city verilir (gerçek istemci il ya da konum bilir); ipucusuz sorgu 81 il kurulu olduğunda ilk 12 ili tarar ve yavaştır. Autocomplete metni: adresin ilk 3-40 harfinden rastgele uzunlukta bir önek (yazarken gelen metin gibi). Sınır: geocode p95 ≤ ${LIMITS.geocodeP95Ms} ms, autocomplete p95 ≤ ${LIMITS.autocompleteP95Ms} ms.\n` };
  } finally {
    await run.stop();
  }
}

function diskBytes(dir: string): { plain: number; packed: number } {
  let plain = 0;
  let packed = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    const size = statSync(join(entry.parentPath, entry.name)).size;
    if (entry.name.endsWith('.zst')) packed += size;
    else if (entry.name.endsWith('.sqlite')) plain += size;
  }
  return { plain, packed };
}

async function checkResources(): Promise<Measured> {
  const manifest = JSON.parse((await import('node:fs')).readFileSync(join(PACKS, 'manifest-v2.json'), 'utf8')) as { regions: { id: string; bbox: [number, number, number, number] }[] };
  const rows: string[] = [];
  let peak = 0;
  for (const maxOpen of [6, 12]) {
    const run = await start({ maxOpen });
    try {
      const before = process.memoryUsage().rss;
      let high = before;
      for (let round = 0; round < 2; round++) {
        for (const region of manifest.regions) {
          const lng = (region.bbox[0] + region.bbox[2]) / 2;
          const lat = (region.bbox[1] + region.bbox[3]) / 2;
          await get(run.base, `/v1/reverse?lng=${lng}&lat=${lat}`);
          await post(run.base, '/v1/geocode', { q: `${region.id} merkez` });
          high = Math.max(high, process.memoryUsage().rss);
        }
      }
      peak = Math.max(peak, high);
      rows.push(`| ${maxOpen} | ${mb(before)} | ${mb(high)} | ${run.server.store.handles()} |`);
    } finally {
      await run.stop();
    }
    if (global.gc) global.gc();
  }
  const disk = diskBytes(PACKS);
  const measured = `81 il iki tur gezildi: bellek tepe ${mb(peak)} MB (en çok 6 ve 12 açık il); disk: açılmış paketler ${mb(disk.plain)} MB, sıkıştırılmış ${mb(disk.packed)} MB`;
  const report = ['# Sunucu bellek ve disk', '', 'Her il için bir ters arama ve bir arama (il merkezi); 81 il art arda, iki tur. Bellek: işlem RSS (ölçüm betiği ve sunucu aynı işlemde).', '', '| En çok açık il | Başlangıç MB | Tepe MB | Sonda açık parça |', '|---|---|---|---|', ...rows, '', measured, '', 'Disk: sunucu paketleri `.sqlite` olarak açar (sıkıştırılmışsa bir kez açılır); yalnız açılmış dosyalar yeterlidir, `.zst` kopyaları ve yamalar sunucu için gerekmez.', ''].join('\n');
  return { check: 'resources', pass: peak > 0 && peak / 1048576 <= LIMITS.residentMb, measured, report };
}

const PHONE = /(?:\+?90|0)?\s*5\d{2}[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}/;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/;
const ID_NUMBER = /\b\d{11}\b/;

async function checkPrivacy(): Promise<Measured> {
  const run = await start();
  const items = texts().slice(0, 150);
  const secrets = ['05321234567', 'ayse.yilmaz@ornek.com', '12345678901', 'Zeynep Karaca'];
  try {
    for (const [i, item] of items.entries()) {
      const text = `${item.text} ${secrets[i % secrets.length]}`;
      await post(run.base, '/v1/geocode', { q: text });
      await post(run.base, '/v1/autocomplete', { q: text });
      await get(run.base, `/v1/geocode?q=${encodeURIComponent(text)}`);
      await get(run.base, `/v1/reverse?lng=${item.point[0]}&lat=${item.point[1]}`);
    }
    await fetch(`${run.base}/v1/geocode`, { method: 'POST', headers: { 'x-api-key': 'yanlis-anahtar', 'content-type': 'application/json' }, body: JSON.stringify({ q: secrets[0] }) });
    await post(run.base, '/v1/geocode', { q: 'x'.repeat(900), language: secrets[3] });
    const log = run.lines.join('\n');
    const words = new Set(items.flatMap((i) => i.text.split(/\s+/)).filter((w) => w.length >= 5 && /^[\p{L}]+$/u.test(w) && !/geocode|autocomplete|reverse|health|version/i.test(w)));
    const leaked = [...words].filter((w) => log.toLowerCase().includes(w.toLowerCase()));
    const findings = [PHONE.test(log), EMAIL.test(log), ID_NUMBER.test(log), secrets.some((s) => log.includes(s)), log.includes(KEY), log.includes('yanlis-anahtar')].filter(Boolean).length + leaked.length;
    const measured = `${run.lines.length} günlük satırı, ${items.length * 4 + 2} istek (adres metni, telefon, e-posta, kimlik no ve ad içeren): kişisel veri ya da adres sözcüğü bulgusu ${findings}; satır biçimi: zaman, yöntem, yol, durum, süre, anahtar adı`;
    return { check: 'privacy', pass: findings === 0 && run.lines.length > 0, measured, report: `# Sunucu günlüğü\n\n${measured}\n\nGünlükte sorgu metni, sorgu dizisi, gövde, anahtar değeri ve istemci adresi yok. Hata cevapları da gelen metni geri yazmaz (\`test/server/api.test.ts\`).\n` };
  } finally {
    await run.stop();
  }
}

type Engine = { name: string; ask: (text: string) => Promise<void> };

async function timed(engine: Engine, items: { text: string }[], workers: number): Promise<{ p50: number; p95: number; perSecond: number }> {
  const times: number[] = [];
  const queue = [...items];
  const started = performance.now();
  await Promise.all(
    Array.from({ length: workers }, async () => {
      for (let item = queue.pop(); item; item = queue.pop()) {
        const at = performance.now();
        await engine.ask(item.text);
        times.push(performance.now() - at);
      }
    }),
  );
  return { p50: quantile(times, 0.5), p95: quantile(times, 0.95), perSecond: (items.length / (performance.now() - started)) * 1000 };
}

async function checkCompare(): Promise<Measured> {
  const run = await start();
  const items = texts();
  const live = async (url: string): Promise<boolean> => fetch(url).then((r) => r.ok).catch(() => false);
  const engines: Engine[] = [
    { name: 'yuksi-geo sunucusu', ask: async (text) => void (await post(run.base, '/v1/geocode', { q: text, limit: 1 })) },
    ...((await live('http://127.0.0.1:8088/search?q=kadikoy&format=json&limit=1')) ? [{ name: 'Nominatim', ask: async (text: string) => void (await (await fetch(`http://127.0.0.1:8088/search?${new URLSearchParams({ q: text, format: 'jsonv2', limit: '1', countrycodes: 'tr' })}`)).json()) }] : []),
    ...((await live('http://127.0.0.1:2322/api?q=kadikoy&limit=1')) ? [{ name: 'Photon', ask: async (text: string) => void (await (await fetch(`http://127.0.0.1:2322/api?${new URLSearchParams({ q: text, limit: '1' })}`)).json()) }] : []),
  ];
  try {
    for (const item of items.slice(0, 40)) await post(run.base, '/v1/geocode', { q: item.text, limit: 1 });
    const rows: string[] = [];
    for (const engine of engines) {
      const one = await timed(engine, items, 1);
      const many = await timed(engine, items, 8);
      rows.push(`| ${engine.name} | ${one.p50.toFixed(1)} | ${one.p95.toFixed(1)} | ${one.perSecond.toFixed(0)} | ${many.p50.toFixed(1)} | ${many.p95.toFixed(1)} | ${many.perSecond.toFixed(0)} |`);
    }
    const measured = `${items.length} aynı sorgu, ${engines.length} motor (aynı makine, ısınmış): ${rows.map((r) => r.split('|').slice(1, 5).map((c) => c.trim()).join(' ')).join('; ')}`;
    const report = ['# Sunucu kıyası (aynı makinede)', '', `${items.length} dağınık adres metni (5 il). Motorlar aynı makinede çalışır; Nominatim ve Photon yerel kurulumdur (Faz 1). Süreler ms, istemci tarafı.`, '', '| Motor | 1 istemci p50 | p95 | istek/sn | 8 istemci p50 | p95 | istek/sn |', '|---|---|---|---|---|---|---|', ...rows, '', 'Bu bir hız karşılaştırmasıdır, doğruluk değil (doğruluk Faz 3-11 raporlarında). Nominatim ve Photon yerel ayarsız çalışır; sonuçlar kurulumlarına bağlıdır.', ''].join('\n');
    return { check: 'compare', pass: engines.length > 0, measured, report };
  } finally {
    await run.stop();
  }
}

export async function runServerCheck(check: string): Promise<Measured | null> {
  if (check === 'parity') return checkParity();
  if (check === 'speed') return checkSpeed();
  if (check === 'resources') return checkResources();
  if (check === 'privacy') return checkPrivacy();
  if (check === 'compare') return checkCompare();
  return null;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const at = process.argv.indexOf('--check');
  const check = at >= 0 ? process.argv[at + 1] : undefined;
  (check ? runServerCheck(check) : Promise.resolve(null)).then((result) => {
    if (!result) {
      console.error(`kullanım: --check ${CHECKS.join('|')}`);
      process.exit(2);
    }
    const dir = join(homedir(), 'Desktop', 'yuksi-geo-raporlar');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `faz-16-${result.check}.md`), result.report);
    console.log(JSON.stringify({ check: result.check, pass: result.pass, measured: result.measured }));
    process.exit(result.pass ? 0 : 1);
  });
}
