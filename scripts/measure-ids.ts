import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildAddressPack } from '../pipeline/build/address-pack';
import { assignId, loadRegistry } from '../pipeline/build/id-registry';
import { repoRoot } from './addr-sets';

type Measured = { check: string; pass: boolean; measured: string; numbers?: Record<string, number> };

const work = join(repoRoot, 'dist', 'work', '261028');
const PLATES = Array.from({ length: 81 }, (_, i) => String(i + 1).padStart(2, '0'));
const pct = (a: number, b: number): string => (b === 0 ? '-' : `%${((a / b) * 100).toFixed(2)}`);

const sidsOf = (file: string): { streets: Map<string, string>; hoods: Map<string, string> } => {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return {
      streets: new Map((db.prepare("SELECT key || '|' || COALESCE(kind, '') AS k, sid FROM street_name").all() as { k: string; sid: string }[]).map((r) => [r.k, r.sid])),
      hoods: new Map((db.prepare("SELECT district_id || '|' || key AS k, sid FROM neighbourhood").all() as { k: string; sid: string }[]).map((r) => [r.k, r.sid])),
    };
  } finally {
    db.close();
  }
};

async function stableCheck(plates: string[]): Promise<Measured> {
  const temp = mkdtempSync(join(tmpdir(), 'ids-'));
  let streets = 0;
  let sameStreets = 0;
  let hoods = 0;
  let sameHoods = 0;
  let renamed = 0;
  let kept = 0;
  let missing = 0;
  try {
    for (const plate of plates) {
      if (!existsSync(join(work, 'packs', plate, 'address.sqlite'))) continue;
      const registryDir = join(temp, 'registry');
      mkdirSync(registryDir, { recursive: true });
      if (existsSync(join(work, 'id-registry', `${plate}.jsonl`))) cpSync(join(work, 'id-registry', `${plate}.jsonl`), join(registryDir, `${plate}.jsonl`));
      const a = join(temp, `${plate}-a.sqlite`);
      const b = join(temp, `${plate}-b.sqlite`);
      await buildAddressPack({ province: plate, workDir: work, outFile: a, osmTimestamp: 'x', registryDir });
      await buildAddressPack({ province: plate, workDir: work, outFile: b, osmTimestamp: 'x', registryDir });
      const first = sidsOf(a);
      const second = sidsOf(b);
      for (const [k, sid] of first.streets) {
        streets += 1;
        if (second.streets.get(k) === sid) sameStreets += 1;
        else missing += 1;
      }
      for (const [k, sid] of first.hoods) {
        hoods += 1;
        if (second.hoods.get(k) === sid) sameHoods += 1;
      }
      const registry = loadRegistry(registryDir, plate);
      const claimed = new Set<string>();
      for (const entry of [...registry.byKey.values()].filter((e) => e.ways.length > 0)) {
        renamed += 1;
        if (assignId(registry, claimed, `${entry.k}~yeniad`, entry.ways, () => 'yeni') === entry.sid) kept += 1;
      }
      rmSync(a, { force: true });
      rmSync(b, { force: true });
    }
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
  const same = (sameStreets + sameHoods) / Math.max(1, streets + hoods);
  return {
    check: 'stable',
    pass: same >= 0.999 && missing === 0,
    numbers: { same, kept: renamed === 0 ? 0 : kept / renamed },
    measured: `${plates.length} il iki derleme: sokak kimliği aynı ${pct(sameStreets, streets)} (${streets}), mahalle kimliği aynı ${pct(sameHoods, hoods)} (${hoods}); adı değiştirilen ve yol parçası olan ${renamed} sokaktan kimliğini koruyan ${pct(kept, renamed)}`,
  };
}

const arg = process.argv.find((a) => a.startsWith('--plates='))?.slice(9);
if (process.argv[1]?.endsWith('measure-ids.ts')) void (async () => console.log(JSON.stringify(await stableCheck(arg ? arg.split(',') : PLATES))))();
