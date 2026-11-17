import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { parseSpeedRow, type SpeedRow } from '../pipeline/build/traffic-profile';

export async function readSpeedRows(files: ReadonlyArray<string>, onRow: (row: SpeedRow) => void): Promise<number> {
  let count = 0;
  for (const file of files) {
    const lines = createInterface({ input: createReadStream(file, 'utf8') });
    let header = true;
    for await (const raw of lines) {
      if (header) {
        header = false;
        continue;
      }
      const row = parseSpeedRow(raw);
      if (row === null) continue;
      onRow(row);
      count += 1;
    }
  }
  return count;
}
