import { Directory, File, Paths } from 'expo-file-system';
import { openBuildings2 } from '../../../../src/core/address/buildings2';
import { openRegion } from '../../../../src/core/address/pack';
import { createSearch } from '../../../../src/core/address/search';
import { createLearnedLayer } from '../../../../src/core/learned/layer';
import type { PackStore, SqlDb } from '../../../../src/core/ports';
import { embeddedBorders } from '../../../../src/core/region/embedded';
import { createExpoOpener } from '../../../../src/native/platform/sqlite';
import type { DeviceTest } from '../../device-test/types';
import { sandbox } from '../sandbox';

const DATA_VERSION = '20261028.20261030.3';
const DEFAULT_PLATE = '13';
const PARTS = ['directory', 'buildings2'] as const;

type Case = { id: string; text: string; expected: { status: string; top: string } };

const quantile = (values: number[], q: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length === 0 ? 0 : (sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] as number);
};

async function fetchFile(base: string, name: string, dir: Directory): Promise<void> {
  const file = new File(dir, name);
  if (file.exists) file.delete();
  await File.downloadFileAsync(`${base}/${name}`, file);
}

type SqlStat = { n: number; ms: number; rows: number };
function timed(kind: string, db: SqlDb, stats: Map<string, SqlStat>): SqlDb {
  return {
    ...db,
    all: async <T>(sql: string, params?: unknown[]): Promise<T[]> => {
      const started = performance.now();
      const rows = await db.all<T>(sql, params as never);
      const key = `${kind}|${sql.replace(/\?(, \?)+/g, '?…').slice(0, 90)}`;
      const entry = stats.get(key) ?? { n: 0, ms: 0, rows: 0 };
      entry.n += 1;
      entry.ms += performance.now() - started;
      entry.rows += rows.length;
      stats.set(key, entry);
      return rows;
    },
  } as SqlDb;
}

const handed = (): Directory => new Directory(Paths.document, 'hints-input');

async function casesOf(base: string): Promise<{ cases: Case[]; local: boolean } | { error: string }> {
  const given = new File(handed(), 'hints.json');
  if (given.exists) return { cases: JSON.parse(await given.text()) as Case[], local: true };
  const response = await fetch(`${base}/hints.json`);
  if (!response.ok) return { error: `vaka dosyası yok (HTTP ${response.status}); scripts/build-hints-device-set.ts çalıştırılmalı` };
  return { cases: (await response.json()) as Case[], local: false };
}

function leave(result: object): void {
  const out = new File(Paths.document, 'hints-output.json');
  if (!out.exists) out.create();
  out.write(JSON.stringify(result));
}

export const sdkAddrHints: DeviceTest = {
  id: 'sdk.addr-hints',
  title: 'Sokak ipuçları ve rehber kapıları: haritada olmayan sokaklar ilçe yazılı, yazılmadan ve Merkez ilçesinde bulunur; sorgular Node ile birebir ve hız',
  kind: 'auto',
  async run(ctx) {
    const base = `${ctx.packServerUrl}/addr-eval/${DATA_VERSION}/device`;
    const loaded = await casesOf(base);
    if ('error' in loaded) return { outcome: 'fail', note: loaded.error };
    const { cases, local } = loaded;
    const chosen = new File(handed(), 'plate.txt');
    const PLATE = local && chosen.exists ? (await chosen.text()).trim() : DEFAULT_PLATE;
    const dir: Directory = sandbox('addr-hints', false);
    const open = createExpoOpener(dir);
    const dbs: SqlDb[] = [];
    try {
      for (const name of [`hints-${PLATE}-address.sqlite`, `hints-${PLATE}-learned.sqlite`]) {
        if (local) {
          const target = new File(dir, name);
          if (target.exists) target.delete();
          await new File(handed(), name).copy(target);
        } else await fetchFile(base, name, dir);
      }
      const stats = new Map<string, SqlStat>();
      const rawAddress: SqlDb = await open(`hints-${PLATE}-address.sqlite`);
      const rawLearned: SqlDb = await open(`hints-${PLATE}-learned.sqlite`);
      dbs.push(rawAddress, rawLearned);
      const address = timed('address', rawAddress, stats);
      const learned = timed('learned', rawLearned, stats);
      const extra = new Map<string, SqlDb>();
      const broken: string[] = [];
      for (const kind of PARTS) {
        const name = `hints-${PLATE}-${kind}.sqlite`;
        if (local && !new File(handed(), name).exists) continue;
        if (local) {
          const target = new File(dir, name);
          if (target.exists) target.delete();
          await new File(handed(), name).copy(target);
        } else {
          try {
            await fetchFile(base, name, dir);
          } catch {
            continue;
          }
        }
        const db: SqlDb = await open(name);
        dbs.push(db);
        try {
          if (kind === 'directory') await openRegion(db);
          else await openBuildings2(db);
          extra.set(kind, timed(kind, db, stats));
        } catch (error) {
          broken.push(`${kind}: ${String(error).slice(0, 120)}`);
        }
      }
      const store: PackStore = { installed: async () => [PLATE], open: async () => address, openPart: async (_region, kind) => (kind === 'learned' ? learned : (extra.get(kind) ?? null)) };
      const search = createSearch({ store, borders: embeddedBorders(), layers: [createLearnedLayer(store)] });
      const warmStarted = performance.now();
      await search.warm(PLATE);
      const warmMs = Math.round(performance.now() - warmStarted);
      const different: string[] = [];
      const wrong: { id: string; text: string; got: string; expected: string }[] = [];
      const times: number[] = [];
      let learnedHits = 0;
      let listedHits = 0;
      for (const c of cases) await search.resolve(c.text);
      stats.clear();
      for (const c of cases) {
        const started = performance.now();
        const result = await search.resolve(c.text);
        times.push(performance.now() - started);
        const top = (result.status === 'resolved' ? [result.best, ...result.candidates] : result.status === 'ambiguous' ? result.candidates : []).slice(0, 3);
        const got = JSON.stringify(top.map((p) => ({ id: p.id, name: p.label, point: p.coordinate, precision: p.precision, source: p.source, approximate: p.approximate })));
        if (top[0]?.source === 'learned') learnedHits++;
        if (top[0]?.source === 'overture') listedHits++;
        if (result.status !== c.expected.status || got !== c.expected.top) {
          different.push(c.id);
          wrong.push({ id: c.id, text: c.text, got, expected: c.expected.top });
        }
      }
      const p95 = quantile(times, 0.95);
      const note = `${cases.length} sorgu, ipucundan gelen ${learnedHits}, rehberden gelen ${listedHits}, ek parça ${extra.size}; Node ile eşlik ${cases.length - different.length}/${cases.length}${different.length > 0 ? ` (farklı: ${different.slice(0, 5).join(', ')})` : ''}`;
      const outcome = different.length === 0 && learnedHits >= 30 ? 'pass' : 'fail';
      if (local) leave({ outcome, note, p95Ms: Math.round(p95), medianMs: Math.round(quantile(times, 0.5)), cases: cases.length, learnedHits, listedHits, parts: [...extra.keys()], broken, plate: PLATE, warmMs, sqlMs: Math.round([...stats.values()].reduce((a, e) => a + e.ms, 0)), totalMs: Math.round(times.reduce((a, t) => a + t, 0)), sql: [...stats].sort((a, b) => b[1].ms - a[1].ms).slice(0, 14).map(([k, e]) => `${Math.round(e.ms)}ms n${e.n} r${e.rows} ${k}`), wrong: wrong.slice(0, 8), times: times.map((t) => Math.round(t * 10) / 10) });
      return { outcome, value: p95.toFixed(0), unit: 'ms (p95)', note };
    } catch (error) {
      leave({ outcome: 'fail', error: String(error), stack: String((error as Error)?.stack ?? '').slice(0, 600) });
      throw error;
    } finally {
      for (const db of dbs) await db.close();
    }
  },
};
