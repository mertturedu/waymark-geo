import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const kiyasDir = (): string => process.env.YUKSI_GEO_KIYAS ?? join(homedir(), '.yuksi-geo', 'kiyas');

export const measuresFile = (): string => join(kiyasDir(), 'olcum', 'faz1.json');

export function readMeasures(): Record<string, unknown> {
  const file = measuresFile();
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function recordMeasure(key: string, value: unknown): void {
  const file = measuresFile();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ ...readMeasures(), [key]: value }, null, 1));
}
