import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { correctionLines, reviewImport } from '../src/core/learn/corrections';
import { defaultReportDir } from './device-report';

export type ImportArgs = { files: string[]; approve: boolean; includeSingle: boolean; outDir: string; reportDir: string; date: string };
export type ImportOutcome = { reportPath: string; correctionsPath: string | null; accepted: number; flagged: number };

export function parseArgs(argv: string[], today: string = new Date().toISOString().slice(0, 10)): ImportArgs | string {
  const [command, ...rest] = argv;
  if (command !== 'import') return 'usage: npm run corrections -- import <dosya...> [--approve] [--include-single] [--out <klasör>]';
  const args: ImportArgs = { files: [], approve: false, includeSingle: false, outDir: join('dist', 'corrections'), reportDir: defaultReportDir(), date: today };
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i] as string;
    if (arg === '--approve') args.approve = true;
    else if (arg === '--include-single') args.includeSingle = true;
    else if (arg === '--out') {
      const value = rest[++i];
      if (!value || value.startsWith('--')) return '--out için klasör gerekli';
      args.outDir = value;
    } else if (arg.startsWith('--')) return `bilinmeyen seçenek: ${arg}`;
    else args.files.push(arg);
  }
  return args.files.length === 0 ? 'en az bir dışa aktarım dosyası gerekli' : args;
}

export function runImport(args: ImportArgs): ImportOutcome {
  const missing = args.files.filter((f) => !existsSync(f));
  if (missing.length > 0) throw new Error(`dosya yok: ${missing.join(', ')}`);
  const review = reviewImport(args.files.map((f) => readFileSync(f, 'utf8').replace(/^\uFEFF/, '').split('\n')), { includeSingle: args.includeSingle });
  mkdirSync(args.reportDir, { recursive: true });
  const reportPath = join(args.reportDir, `duzeltme-aykiri-${args.date}.md`);
  writeFileSync(reportPath, review.report);
  let correctionsPath: string | null = null;
  if (args.approve && review.accepted.length > 0) {
    mkdirSync(args.outDir, { recursive: true });
    correctionsPath = join(args.outDir, `corrections-${args.date}.jsonl`);
    for (let n = 2; existsSync(correctionsPath); n++) correctionsPath = join(args.outDir, `corrections-${args.date}-${n}.jsonl`);
    writeFileSync(correctionsPath, correctionLines(review.accepted).map((l) => `${l}\n`).join(''));
  }
  return { reportPath, correctionsPath, accepted: review.accepted.length, flagged: review.flagged.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = parseArgs(process.argv.slice(2));
  if (typeof args === 'string') {
    console.error(args);
    process.exit(2);
  }
  try {
    const outcome = runImport(args);
    console.log(`rapor: ${outcome.reportPath}`);
    console.log(outcome.correctionsPath ? `düzeltme dosyası: ${outcome.correctionsPath}` : 'düzeltme dosyası yazılmadı, raporu inceleyip --approve ile yeniden çalıştırın');
    console.log(`${outcome.accepted} anahtar kabul, ${outcome.flagged} uyarı`);
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
}
