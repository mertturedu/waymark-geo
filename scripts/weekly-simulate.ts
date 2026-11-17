import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { mayPromote } from './data-release';
import { DATA_VERSION, repoRoot } from './addr-sets';
import { measure } from './weekly';
import { compareWeekly } from './weekly-lib';

type Measured = { check: string; pass: boolean; measured: string };

const PLATES = ['34', '06'];
const CAP = 80;
const SHARE = 8;

export function degrade(file: string): number {
  const db = new DatabaseSync(file);
  try {
    db.exec(`DELETE FROM search_name WHERE kind = 0 AND ref % ${SHARE} = 0`);
    const gone = (db.prepare(`SELECT COUNT(*) n FROM street_name WHERE id % ${SHARE} = 0`).get() as { n: number }).n;
    db.exec(`DELETE FROM street_name WHERE id % ${SHARE} = 0`);
    return gone;
  } finally {
    db.close();
  }
}

export async function simulate(tag = DATA_VERSION): Promise<Measured> {
  const releases = join(repoRoot, 'dist', 'releases', tag, 'packs');
  const sim = join(repoRoot, 'dist', 'eval-packs', 'regress-sim');
  rmSync(sim, { recursive: true, force: true });
  const scratch = mkdtempSync(join(tmpdir(), 'weekly-sim-'));
  try {
    const baseline = await measure(tag, PLATES, CAP);
    let removed = 0;
    for (const plate of PLATES) {
      mkdirSync(join(sim, plate), { recursive: true });
      const name = readdirSync(join(releases, plate)).find((f) => f.startsWith('address-') && f.endsWith('.sqlite') && !f.endsWith('.zst')) as string;
      copyFileSync(join(releases, plate, name), join(sim, plate, 'address.sqlite'));
      removed += degrade(join(sim, plate, 'address.sqlite'));
    }
    process.env.ADDR_PACKS = 'regress-sim';
    const broken = await measure(tag, PLATES, CAP);
    delete process.env.ADDR_PACKS;
    const violations = compareWeekly(baseline, broken);
    const stopped = !mayPromote({ comparisonFailed: false, weeklyFailed: violations.length > 0, approve: false });
    return {
      check: 'simulate',
      pass: violations.length > 0 && stopped,
      measured: `sokakların 1/${SHARE}'i silindi (${removed}); G2 ≤30 m ${baseline.sets.g2.within30} → ${broken.sets.g2.within30}, sokak doğru ${baseline.sets.g2.streetOk} → ${broken.sets.g2.streetOk}; ${violations.length} gerileme (${violations.map((v) => v.metric).join(', ')}); yayın ${stopped ? 'durdu' : 'DURMADI'}`,
    };
  } finally {
    delete process.env.ADDR_PACKS;
    rmSync(sim, { recursive: true, force: true });
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  simulate().then((result) => {
    console.log(JSON.stringify(result));
    process.exit(result.pass ? 0 : 1);
  });
}
