import { createReadStream, createWriteStream, rmSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { abbreviateName } from '../../src/native/map/abbreviate';
import { placeProps } from '../../src/native/map/poi-glyphs';

type Feature = { properties?: Record<string, unknown> };

export function annotateLine(line: string): string {
  if (line.trim() === '') return line;
  const feature = JSON.parse(line) as Feature;
  const properties = feature.properties ?? {};
  const name = typeof properties.name === 'string' ? properties.name : '';
  const props = placeProps(typeof properties.cat === 'string' ? properties.cat : undefined, typeof properties.g === 'string' ? properties.g : undefined, name);
  const short = name === '' ? name : abbreviateName(name);
  const kept = { ...properties };
  delete kept.cat;
  feature.properties = { ...kept, k: props.k, t: props.t, grp: props.grp, ...(short !== name ? { ns: short } : {}) };
  return JSON.stringify(feature);
}

export async function annotateFile(input: string, output: string): Promise<number> {
  const out = createWriteStream(output);
  let failure: Error | null = null;
  out.on('error', (error) => void (failure = error));
  let count = 0;
  try {
    for await (const line of createInterface({ input: createReadStream(input), crlfDelay: Infinity })) {
      if (line.trim() === '') continue;
      if (!out.write(`${annotateLine(line)}\n`)) await new Promise<void>((resolve) => out.once('drain', resolve));
      count += 1;
    }
    await new Promise<void>((resolve) => out.end(resolve));
    if (failure) throw failure;
  } catch (error) {
    out.destroy();
    rmSync(output, { force: true });
    throw error;
  }
  return count;
}
