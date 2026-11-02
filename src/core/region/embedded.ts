import { base64Decode } from '../packs/base64';
import { createBorders, type Borders } from './borders';
import { BORDERS_BASE64 } from './data/borders-base64';

let cached: Borders | null = null;

export function embeddedBorders(): Borders {
  if (!cached) cached = createBorders(base64Decode(BORDERS_BASE64) as Uint8Array);
  return cached;
}
