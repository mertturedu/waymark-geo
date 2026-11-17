import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildDirectoryPack, loadModelGroups } from '../pipeline/build/directory';
import { GROUPS, MODEL_FILE } from './enrich-categories';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const WORK = join(repoRoot, 'dist', 'work', '261028');
export const PLATES = ['41', '16', '06'];
const COORDINATE = /-?\d{1,3}\.\d{3,}/;

export type Audit = { check: string; pass: boolean; measured: string; report: string };

function dump(db: DatabaseSync, sql: string): string {
  return JSON.stringify(db.prepare(sql).all());
}

export async function runAudit(): Promise<Audit> {
  const problems: string[] = [];
  const file = JSON.parse(readFileSync(MODEL_FILE, 'utf8')) as { groups: Record<string, string> };
  const entries = Object.entries(file.groups);
  for (const [cat, group] of entries) {
    if (!/^[a-z][a-z0-9_]*$/.test(cat)) problems.push(`kategori adı geçersiz: ${cat}`);
    if (!(GROUPS as readonly string[]).includes(group)) problems.push(`grup geçersiz: ${cat} → ${group}`);
    if (COORDINATE.test(cat) || COORDINATE.test(group)) problems.push(`koordinat benzeri metin: ${cat}`);
  }
  const groups = loadModelGroups();
  let changed = 0;
  let checked = 0;
  for (const plate of PLATES) {
    const work = mkdtempSync(join(tmpdir(), 'audit-'));
    mkdirSync(join(work, 'admin-pack'), { recursive: true });
    mkdirSync(join(work, 'overture'), { recursive: true });
    symlinkSync(join(WORK, 'admin-pack', `${plate}.jsonl`), join(work, 'admin-pack', `${plate}.jsonl`));
    symlinkSync(join(WORK, 'overture', `${plate}.rows.jsonl`), join(work, 'overture', `${plate}.rows.jsonl`));
    const plain = join(work, 'plain.sqlite');
    const modelled = join(work, 'model.sqlite');
    const stats = await buildDirectoryPack({ province: plate, workDir: work, outFile: plain, osmTimestamp: 't', modelGroups: {} });
    const withModel = await buildDirectoryPack({ province: plate, workDir: work, outFile: modelled, osmTimestamp: 't', modelGroups: groups });
    const a = new DatabaseSync(plain, { readOnly: true });
    const b = new DatabaseSync(modelled, { readOnly: true });
    const same = (sql: string, label: string): void => {
      if (dump(a, sql) !== dump(b, sql)) problems.push(`${plate}: ${label} değişti`);
    };
    const key = 'SELECT p.name, p.lon, p.lat, p.district_id, p.hood_id, i.cat, i.brand, i.street, i.number, i.postcode, i.conf FROM poi p JOIN poi_info i ON i.id = p.id ORDER BY p.name, p.lon, p.lat, i.cat';
    same(key, 'işletme adı, konumu, bilgileri');
    same('SELECT * FROM address ORDER BY id', 'kapılar');
    same('SELECT * FROM street_name ORDER BY id', 'sokak adları');
    const moved = Number((b.prepare('SELECT COUNT(*) AS n FROM poi_info WHERE msrc = 1').get() as { n: number }).n);
    const stray = Number((a.prepare('SELECT COUNT(*) AS n FROM poi_info WHERE msrc = 1').get() as { n: number }).n);
    if (moved !== withModel.modelKinds) problems.push(`${plate}: işaretli ${moved} ≠ sayılan ${withModel.modelKinds}`);
    if (stray !== 0) problems.push(`${plate}: modelsiz pakette işaretli kayıt var`);
    const kinds = (db: DatabaseSync): string => dump(db, 'SELECT p.name, p.lon, p.lat, k.name AS kind FROM poi p JOIN poi_kind k ON k.id = p.kind ORDER BY p.name, p.lon, p.lat, p.id');
    const diffA = new Map((JSON.parse(kinds(a)) as { name: string; lon: number; lat: number; kind: string }[]).map((r, i) => [`${r.name}|${r.lon}|${r.lat}|${i}`, r.kind]));
    const rowsB = JSON.parse(kinds(b)) as { name: string; lon: number; lat: number; kind: string }[];
    rowsB.forEach((r, i) => {
      if (diffA.get(`${r.name}|${r.lon}|${r.lat}|${i}`) !== r.kind) changed++;
    });
    checked += stats.places;
    a.close();
    b.close();
    rmSync(work, { recursive: true, force: true });
  }
  const measured = `${entries.length} model eşlemesi (yalnız kategori → grup; ${GROUPS.length} izinli grup); ${PLATES.join(', ')} illerinde ${checked} işletme modelsiz ve modelli derlendi: ad, konum, kapı, sokak, bilgi alanları birebir aynı, yalnız grup değişti (${changed} kayıt); koordinat ya da kapı üretimi bulgusu ${problems.length}`;
  const report = ['# Model çıktısı denetimi', '', measured, '', problems.length === 0 ? 'Bulgu yok.' : problems.map((p) => `- ${p}`).join('\n'), ''].join('\n');
  return { check: 'audit', pass: problems.length === 0, measured, report };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runAudit().then((result) => {
    const dir = join(homedir(), 'Desktop', 'yuksi-geo-raporlar');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'faz-16b-denetim.md'), result.report);
    console.log(JSON.stringify({ check: result.check, pass: result.pass, measured: result.measured }));
    process.exit(result.pass ? 0 : 1);
  });
}
