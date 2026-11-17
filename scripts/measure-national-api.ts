import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createApi, type ApiRequest } from '../server/api';
import type { AdminResult } from '../src/core/address/admin';
import { createSearch } from '../src/core/address/search';
import type { Place } from '../src/core/address/types';
import type { PackStore } from '../src/core/ports';
import { createBorders } from '../src/core/region/borders';
import { openSqlite } from '../src/node/sqlite';
import { rng, shuffle } from '../test/sim/random';
import { readSet, repoRoot, type TextRecord } from './addr-sets';

type Measured = { check: string; pass: boolean; measured: string; numbers?: Record<string, number> };

const PLATES = ['16', '41', '06', '35'];
const KEY = 'olcum';
const packs = join(repoRoot, 'dist', 'work', '261028', 'packs');
const borders = createBorders(readFileSync(join(repoRoot, 'src', 'core', 'region', 'data', 'borders.bin')));
const quantile = (values: number[], q: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length === 0 ? 0 : (sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] as number);
};

function setup() {
  const dbs: { close(): Promise<void> }[] = [];
  const open = (file: string) => {
    const db = openSqlite(file);
    dbs.push(db);
    return db;
  };
  const store: PackStore = {
    installed: async () => PLATES,
    open: async (plate) => open(join(packs, plate, 'address.sqlite')),
    openPart: async (plate, kind) => (kind === 'buildings2' && existsSync(join(packs, plate, 'buildings2.sqlite')) ? open(join(packs, plate, 'buildings2.sqlite')) : null),
  };
  const search = createSearch({ store, borders, maxOpen: 4 });
  const api = createApi({ search, keys: [{ id: 'olcum', secret: KEY, rps: 1_000_000 }], info: { sdk: 'x', data: 'x', format: '2' }, regions: async () => PLATES.length });
  const ask = async <T>(path: string, query: Record<string, string> = {}, body?: unknown): Promise<{ status: number; body: T }> => {
    const request: ApiRequest = { method: body === undefined ? 'GET' : 'POST', path, query, body, headers: { 'x-api-key': KEY }, remote: '127.0.0.1' };
    const response = await api.handle(request);
    return { status: response.status, body: response.body as T };
  };
  return { search, ask, close: async () => { for (const db of dbs) await db.close().catch(() => undefined); } };
}

async function navCheck(): Promise<Measured> {
  const { search, ask, close } = setup();
  let checks = 0;
  let failed = 0;
  let sids = 0;
  const reasons = new Map<string, number>();
  const bad = (ok: boolean, why = ''): void => {
    checks += 1;
    if (!ok) {
      failed += 1;
      reasons.set(why, (reasons.get(why) ?? 0) + 1);
    }
  };
  try {
    const country = await ask<AdminResult>('/v1/admin');
    bad(country.status === 200 && country.body.items.length === 81);
    for (const plate of PLATES) {
      const districts = await ask<AdminResult>('/v1/admin', { province: plate });
      bad(districts.status === 200 && districts.body.items.length > 0);
      for (const d of districts.body.items.slice(0, 3)) {
        const district = await search.lookup(d.id);
        bad(district !== null && district.sid === d.id, 'ilçe kimliği çözülemedi');
        const hoods = await ask<AdminResult>('/v1/admin', { district: d.id });
        bad(hoods.status === 200);
        for (const h of hoods.body.items.slice(0, 4)) {
          sids += 1;
          const hood = await search.lookup(h.id);
          bad(hood !== null && hood.sid === h.id, `mahalle kimliği çözülemedi (kaynak ${h.source ?? '?'})`);
          const streets = await ask<AdminResult>('/v1/admin', { hood: h.id });
          bad(streets.status === 200);
          for (const s of streets.body.items.slice(0, 3)) {
            sids += 1;
            const street = await search.lookup(s.id);
            if (street === null && process.env.DEBUG_NAV) console.log('çözülemedi', plate, s.id, s.name, JSON.stringify((await search.resolve(`${s.name} ${district?.label ?? ''}`, { limit: 5 }) as { candidates?: Place[]; best?: Place }).best?.id ?? null));
            bad(street !== null && street.sid === s.id, 'sokak kimliği çözülemedi');
            const detail = await ask<AdminResult>('/v1/admin', { street: s.id });
            const direct = await search.admin({ street: s.id });
            bad(detail.status === 200 && JSON.stringify(detail.body) === JSON.stringify(direct), 'sokak ayrıntısı');
            const range = await ask<{ ranges: unknown[] }>('/v1/range', { street: s.id });
            bad(range.status === 200 && JSON.stringify(range.body.ranges) === JSON.stringify(direct?.ranges ?? []));
          }
        }
      }
    }
  } finally {
    await close();
  }
  return { check: 'nav', pass: checks > 0 && failed === 0, numbers: { checks, failed }, measured: `${[...reasons].map(([k, v]) => `${k}: ${v}`).join('; ')} | ${PLATES.length} il, ülke → il → ilçe → mahalle → sokak gezinmesi: ${checks} kontrol, ${sids} kimlik çözüldü, uyumsuz ${failed}; uçlar doğrudan arama ile ${failed === 0 ? '%100' : 'farklı'} aynı` };
}

async function batchCheck(): Promise<Measured> {
  const { search, ask, close } = setup();
  const times: number[] = [];
  let compared = 0;
  let different = 0;
  try {
    for (const plate of PLATES) {
      const records = shuffle(readSet<TextRecord>('g2', plate), rng(9000 + Number(plate))).slice(0, 100);
      const texts = records.map((r) => r.text);
      const started = performance.now();
      const batch = await ask<{ results: unknown[] }>('/v1/geocode/batch', {}, { queries: texts, city: records[0]?.province });
      times.push(performance.now() - started);
      for (const [i, text] of texts.entries()) {
        const one = await search.resolve(text, { hints: { city: records[0]?.province as string } });
        compared += 1;
        if (JSON.stringify(batch.body.results[i]) !== JSON.stringify(JSON.parse(JSON.stringify(one)))) different += 1;
      }
    }
    const csv = await ask<{ rows: unknown[] }>('/v1/validate/csv', {}, { csv: 'adres\nbahariye caddesi 14 kadıköy\nmoda caddesi 5 kadıköy' });
    compared += 1;
    if (csv.status !== 200 || csv.body.rows.length !== 2) different += 1;
  } finally {
    await close();
  }
  const p95 = quantile(times, 0.95);
  return { check: 'batch', pass: compared > 0 && different === 0, numbers: { different, compared, p95 }, measured: `${times.length} toplu istek (100 sorgu): her sonuç tek tek geocode ile ${compared - different}/${compared} aynı; toplu istek süresi p95 ${p95.toFixed(0)} ms (sorgu başına ${(p95 / 100).toFixed(1)} ms); CSV doğrulama çalışıyor` };
}

const check = process.argv.find((a) => a.startsWith('--check='))?.slice(8) ?? 'nav';
void (async () => console.log(JSON.stringify(check === 'batch' ? await batchCheck() : await navCheck())))();
