import { pathToFileURL } from 'node:url';
import { parseAddress } from '../src/core/text/parse';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createSearch } from '../src/core/address/search';
import { createBorders } from '../src/core/region/borders';
import { createRouter } from '../src/core/route/router';
import { createNodePackStore, createNodeRouteStore } from '../src/node/pack-store';
import { formatParsed } from './try-parse';
import { planCommands } from './try-plan';
import { routeCommands } from './try-route';
import { searchCommands } from './try-search';

export type TryCommands = Record<string, (args: string[]) => Promise<void>>;

const openSearch = async (packs?: string) => {
  const dir = packs ?? join(process.cwd(), 'dist', 'packs');
  const borders = createBorders(readFileSync(join(process.cwd(), 'src', 'core', 'region', 'data', 'borders.bin')));
  return createSearch({ store: await createNodePackStore(dir), borders });
};

const openRoute = async (packs?: string) => {
  const dir = packs ?? join(process.cwd(), 'dist', 'packs');
  const borders = createBorders(readFileSync(join(process.cwd(), 'src', 'core', 'region', 'data', 'borders.bin')));
  return { search: await openSearch(packs), router: createRouter({ store: await createNodeRouteStore(dir), borders }) };
};

export const commands: TryCommands = {
  ...searchCommands(openSearch),
  ...routeCommands(openRoute),
  ...planCommands(openRoute),
  async parse(args) {
    const json = args.includes('--json');
    const parsed = parseAddress(args.filter((arg) => arg !== '--json').join(' '));
    if (json) console.log(JSON.stringify(parsed, null, 2));
    else for (const line of formatParsed(parsed)) console.log(line);
  },
};

export async function runTry(argv: string[], registry: TryCommands): Promise<{ code: number; message: string }> {
  const [name, ...args] = argv;
  const known = Object.keys(registry).join(', ') || '(none yet)';
  if (!name || !registry[name]) return { code: 2, message: `unknown command${name ? ` "${name}"` : ''}. commands: ${known}` };
  await (registry[name] as (args: string[]) => Promise<void>)(args);
  return { code: 0, message: '' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runTry(process.argv.slice(2), commands).then(({ code, message }) => {
    if (message) console.error(message);
    process.exit(code);
  });
}
