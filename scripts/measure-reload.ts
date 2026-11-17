import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { createGeoServer } from '../server';
import { composeKey, layerKeyOf } from '../src/core/learn/key';
import { LEARNED_SCHEMA } from '../src/core/learned/types';
import type { Place } from '../src/core/address/types';

type Measured = { check: string; pass: boolean; measured: string; numbers?: Record<string, number> };

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const RELEASE = process.env.GEO_PACKS_DIR ?? join(repoRoot, 'dist', 'packs-0.8-adres');
const PLATE = '67';
const KEY = 'yenileme';
const MAX_WAIT_MS = 10_000;

async function reloadCheck(): Promise<Measured> {
  const manifestName = ['manifest-v2.json', 'manifest-v1.json'].find((n) => { try { return statSync(join(RELEASE, n)).isFile(); } catch { return false; } }) as string;
  const full = JSON.parse(readFileSync(join(RELEASE, manifestName), 'utf8')) as { regions: { id: string; files: { kind: string; path: string; size: number; sha256: string }[] }[] };
  const region = full.regions.find((r) => r.id === PLATE) as (typeof full.regions)[number];
  const dir = mkdtempSync(join(tmpdir(), 'reload-'));
  mkdirSync(join(dir, PLATE));
  const kept = region.files.filter((f) => f.kind === 'address' || f.kind === 'buildings2');
  for (const f of kept) copyFileSync(join(RELEASE, f.path), join(dir, f.path));
  const manifest = { ...full, regions: [{ ...region, files: kept }] };
  const writeManifest = (files: typeof kept): void => {
    writeFileSync(join(dir, 'manifest-v2.json'), JSON.stringify({ ...manifest, format: 2, regions: [{ ...region, files }] }));
    const later = new Date(Date.now() + writeManifest.count++ * 3000 + 2000);
    utimesSync(join(dir, 'manifest-v2.json'), later, later);
  };
  writeManifest.count = 1;
  writeManifest(kept);
  const server = createGeoServer({ packsDir: dir, keys: [{ id: 'olcum', secret: KEY, rps: 100000 }] });
  const port = await server.listen(0);
  const base = `http://127.0.0.1:${port}`;
  const ask = async (q: string): Promise<{ status: string; best?: Place }> => (await (await fetch(`${base}/v1/geocode`, { method: 'POST', headers: { 'x-api-key': KEY, 'content-type': 'application/json' }, body: JSON.stringify({ q, city: 'Zonguldak' }) })).json()) as { status: string; best?: Place };
  try {
    const address = new DatabaseSync(join(dir, kept.find((f) => f.kind === 'address')?.path as string), { readOnly: true });
    const doors = address.prepare(`SELECT a.number, s.name AS street, h.name AS hood, d.name AS district FROM address a JOIN street_name s ON s.id = a.street_id JOIN neighbourhood h ON h.id = a.hood_id JOIN district d ON d.id = a.district_id WHERE a.num IS NOT NULL AND a.number NOT GLOB '*[^0-9]*' ORDER BY a.id LIMIT 40`).all() as { number: string; street: string; hood: string; district: string }[];
    address.close();
    let text = '';
    let before: { status: string; best?: Place } = { status: 'not_found' };
    let place: Place | undefined;
    let parts: ReturnType<typeof layerKeyOf> = null;
    for (const door of doors) {
      text = `${door.street} ${door.number} ${door.hood} Mahallesi ${door.district} Zonguldak`;
      before = await ask(text);
      place = before.best;
      parts = place && place.precision === 'address' ? layerKeyOf(PLATE, place.local ?? place.components) : null;
      if (parts) break;
    }
    if (!place) return { check: 'reload', pass: false, measured: 'başlangıç sorgusu sonuç vermedi' };
    if (!parts) return { check: 'reload', pass: false, measured: `öğrenme anahtarı kurulamadı (metin: ${text}, sonuç: ${place.precision} ${place.label})` };
    const moved: [number, number] = [place.coordinate[0] + 0.0006, place.coordinate[1] + 0.0004];
    const learned = join(dir, PLATE, 'learned-yeni.sqlite');
    const db = new DatabaseSync(learned);
    for (const sql of LEARNED_SCHEMA) db.exec(sql);
    db.prepare('INSERT INTO meta VALUES (?, ?)').run('format', '1');
    db.prepare('INSERT INTO door (key, lng, lat, trusted, sources, spread) VALUES (?, ?, ?, ?, ?, ?)').run(composeKey(parts), Math.round(moved[0] * 1e6), Math.round(moved[1] * 1e6), 1, 3, 2);
    db.close();
    const bytes = readFileSync(learned);
    const started = Date.now();
    writeManifest([...kept, { kind: 'learned', path: `${PLATE}/learned-yeni.sqlite`, size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }]);
    let after = before;
    let waited = 0;
    while (waited <= MAX_WAIT_MS) {
      after = await ask(text);
      if (after.best?.source === 'learned') break;
      await new Promise((r) => setTimeout(r, 250));
      waited = Date.now() - started;
    }
    const version = (await (await fetch(`${base}/version`)).json()) as { learned: string | null };
    const hit = after.best?.source === 'learned' && Math.abs((after.best?.coordinate[0] ?? 0) - moved[0]) < 1e-6;
    return {
      check: 'reload',
      pass: hit && waited <= 5000 && version.learned !== null,
      numbers: { waitedMs: waited },
      measured: `yeni öğrenme dosyası ve manifest konunca, sunucu yeniden başlatılmadan ${hit ? `${waited} ms içinde yeni noktayı verdi (önce ${before.best?.source}, sonra ${after.best?.source})` : `${MAX_WAIT_MS} ms içinde yeni noktayı vermedi`}; /version learned: ${version.learned ?? 'yok'}`,
    };
  } finally {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

void (async () => console.log(JSON.stringify(await reloadCheck())))();
