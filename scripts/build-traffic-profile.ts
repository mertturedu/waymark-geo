import { writeFileSync } from 'node:fs';
import { createProfileBuilder } from '../pipeline/build/traffic-profile';
import { readSpeedRows } from './traffic-rows';

const out = process.argv[2];
const files = process.argv.slice(3);
if (!out || files.length === 0) {
  console.error('kullanım: build-traffic-profile <çıktı.json> <aylık.csv...>');
  process.exit(1);
}

const builder = createProfileBuilder();
await readSpeedRows(files, (row) => builder.add(row));
const profile = builder.profile();
writeFileSync(out, JSON.stringify(profile));
console.log(`${Object.keys(profile.cells).length} hücre yazıldı: ${out}`);
