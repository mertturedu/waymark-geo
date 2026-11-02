import { readRoutePack } from '../src/core/route/format';
import { createPlanner } from '../src/core/route/planner';
import type { Snap } from '../src/core/route/snap';

declare const PACK_B64: string;
declare const print: ((text: string) => void) | undefined;

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function decode(text: string): Uint8Array {
  const lookup = new Uint8Array(128);
  for (let i = 0; i < ALPHABET.length; i++) lookup[ALPHABET.charCodeAt(i)] = i;
  const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0;
  const out = new Uint8Array((text.length / 4) * 3 - padding);
  let at = 0;
  for (let i = 0; i < text.length; i += 4) {
    const n = ((lookup[text.charCodeAt(i)] as number) << 18) | ((lookup[text.charCodeAt(i + 1)] as number) << 12) | ((lookup[text.charCodeAt(i + 2)] as number) << 6) | (lookup[text.charCodeAt(i + 3)] as number);
    if (at < out.length) out[at++] = (n >> 16) & 255;
    if (at < out.length) out[at++] = (n >> 8) & 255;
    if (at < out.length) out[at++] = n & 255;
  }
  return out;
}

let state = 20261027;
const random = (): number => {
  state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
  return state / 0x100000000;
};

const loadStart = Date.now();
const pack = readRoutePack(decode(PACK_B64));
const planner = createPlanner(pack);
const loadMs = Date.now() - loadStart;

const snap = (): Snap => {
  const edge = Math.floor(random() * pack.edges.count);
  return { edge, offsetM: random() * (pack.edges.length[edge] as number), distanceM: 0, point: [0, 0] };
};

const side = 50;
const times: number[] = [];
for (let run = 0; run < 3; run++) {
  const from = Array.from({ length: side }, snap);
  const to = Array.from({ length: side }, snap);
  const started = Date.now();
  planner.matrix(from, to);
  times.push(Date.now() - started);
}
const routes: number[] = [];
for (let i = 0; i < 100; i++) {
  const a = snap();
  const b = snap();
  const started = Date.now();
  planner.route(a, b);
  routes.push(Date.now() - started);
}
routes.sort((x, y) => x - y);
const text = JSON.stringify({ loadMs, matrixMs: times, routeP95Ms: routes[Math.floor(routes.length * 0.95)], edges: pack.edges.count });
if (typeof print === 'function') print(text);
else console.log(text);
