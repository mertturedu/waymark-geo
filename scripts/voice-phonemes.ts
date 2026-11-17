import { readFileSync, writeFileSync } from 'node:fs';
import { speechPhonemes } from '../src/core/voice';

const [input, output, configPath] = process.argv.slice(2);
if (!input || !output) {
  console.error('kullanım: voice-phonemes.ts <metadata.csv> <çıktı.csv> [config.json]');
  process.exit(2);
}

const map = configPath ? (JSON.parse(readFileSync(configPath, 'utf8')) as { phoneme_id_map: Record<string, number[]> }).phoneme_id_map : null;
const missing: Record<string, number> = {};
const rows: string[] = [];
for (const line of readFileSync(input, 'utf8').split('\n')) {
  if (!line) continue;
  const at = line.indexOf('|');
  const phonemes = speechPhonemes(line.slice(at + 1));
  if (map) for (const ch of phonemes) if (!map[ch]) missing[ch] = (missing[ch] ?? 0) + 1;
  rows.push(`${line.slice(0, at)}|${phonemes}`);
}
writeFileSync(output, `${rows.join('\n')}\n`);
console.log(`${rows.length} satır -> ${output}`);
if (map) console.log(Object.keys(missing).length ? `tabloda olmayan semboller: ${JSON.stringify(missing)}` : 'tüm semboller tabloda');
