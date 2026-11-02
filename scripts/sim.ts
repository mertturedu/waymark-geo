import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runCheck, type Measured, type Neighbours } from './measure-learning';

export const SIM_CHECKS = ['delivery1', 'delivery3', 'delivery5', 'pin', 'outlier', 'sparse'];

export function simReport(results: Measured[], date: string, neighbours: Neighbours): string {
  const head = [`# Öğrenme simülasyonu ${date}`, '', `Komşu noktalar: ${neighbours}. Beş il, her ilde adreslerin yüzde 20si gizli.`, '', '| Ölçüm | Sonuç | Durum |', '|---|---|---|'];
  const rows = results.map((r) => `| ${r.check} | ${r.measured} | ${r.pass ? 'geçti' : 'tutmadı'} |`);
  return [...head, ...rows, '', ...results.flatMap((r) => [r.report.trim(), ''])].join('\n');
}

export async function runSim(neighbours: Neighbours, only: string[] = SIM_CHECKS): Promise<Measured[]> {
  const out: Measured[] = [];
  for (const check of only) {
    const result = await runCheck(check, { neighbours });
    if (result) out.push(result);
  }
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const at = process.argv.indexOf('--neighbours');
  const neighbours: Neighbours = at >= 0 && process.argv[at + 1] === 'trusted' ? 'trusted' : 'all';
  const date = new Date().toISOString().slice(0, 10);
  runSim(neighbours).then((results) => {
    const dir = join(homedir(), 'Desktop', 'yuksi-geo-raporlar');
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `ogrenme-${date}.md`);
    writeFileSync(path, simReport(results, date, neighbours));
    console.log(path);
    for (const r of results) console.log(`${r.pass ? 'geçti ' : 'tutmadı'} ${r.check}: ${r.measured}`);
    process.exit(results.every((r) => r.pass) ? 0 : 1);
  });
}
