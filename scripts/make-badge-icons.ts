import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GLYPH_TABLE, LEGEND_GLYPH } from '../src/native/map/poi-glyphs';

const root = fileURLToPath(new URL('..', import.meta.url));
const folders: Record<string, string> = {
  maki: join(root, 'node_modules', '@mapbox', 'maki', 'icons'),
  temaki: join(root, 'node_modules', '@rapideditor', 'temaki', 'icons'),
};
const out = join(root, 'src', 'native', 'map', 'icons');

const svgOf = (source: string): string => {
  const [set, file] = source.split(':') as [string, string];
  const svg = join(folders[set]!, `${file}.svg`);
  if (!existsSync(svg)) throw new Error(`simge yok: ${source}`);
  return svg;
};

const legendNames = [...new Set(Object.values(LEGEND_GLYPH))];
const pairs = [
  ...GLYPH_TABLE.map((row) => `${row.name}=${svgOf(row.source)}`),
  ...legendNames.map((name) => `legend-${name}=${svgOf(GLYPH_TABLE.find((row) => row.name === name)!.source)}`),
];

const work = mkdtempSync(join(tmpdir(), 'badge-'));
try {
  const binary = join(work, 'make-badge-icons');
  execFileSync('xcrun', ['swiftc', '-O', join(root, 'scripts', 'make-badge-icons.swift'), '-o', binary, '-framework', 'AppKit'], { stdio: 'inherit' });
  execFileSync(binary, [out, ...pairs], { stdio: 'inherit' });
} finally {
  rmSync(work, { recursive: true, force: true });
}

const names = GLYPH_TABLE.map((row) => row.name);
const variable = (name: string): string => `badge_${name.replace(/-/g, '_')}`;
const lines = [
  '/// <reference path="./assets.d.ts" />',
  ...names.map((name) => `import ${variable(name)} from '../map/icons/geo-badge-${name}.png';`),
  '',
  'export const BADGE_IMAGES: Record<string, { source: number; sdf: true }> = {',
  ...names.map((name) => `  'geo-badge-${name}': { source: ${variable(name)}, sdf: true },`),
  '};',
  '',
];
writeFileSync(join(root, 'src', 'native', 'platform', 'badge-images.ts'), lines.join('\n'));

const legendLines = [
  '/// <reference path="./assets.d.ts" />',
  ...legendNames.map((name) => `import legend_${name.replace(/-/g, '_')} from '../map/icons/legend-${name}.png';`),
  '',
  'export const LEGEND_IMAGES: Record<string, number> = {',
  ...legendNames.map((name) => `  'legend-${name}': legend_${name.replace(/-/g, '_')},`),
  '};',
  '',
];
writeFileSync(join(root, 'src', 'native', 'platform', 'legend-images.ts'), legendLines.join('\n'));
console.log(`${names.length} rozet üretildi`);
