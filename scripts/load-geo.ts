import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rng, shuffle } from '../test/sim/random';
import { readSet, type TextRecord } from './addr-sets';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const arg = (name: string, fallback: string): string => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;

const WORKERS = Number(arg('workers', '1'));
const CLIENTS = Number(arg('clients', '8'));
const SECONDS = Number(arg('seconds', '60'));
const MAX_OPEN = Number(arg('maxopen', '12'));
const PLATES = arg('plates', '34,06,35,41,16').split(',');
const PORT = Number(arg('port', '8197'));
const PACKS = process.env.GEO_PACKS_DIR ?? join(repoRoot, 'dist', 'packs-0.8-adres');
const KEY = 'yuk-anahtari';

const quantile = (values: number[], q: number): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length === 0 ? 0 : (sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] as number);
};

type Job = { kind: string; path: string; body?: unknown };

function jobs(): Job[] {
  const out: Job[] = [];
  for (const plate of PLATES) {
    const records = shuffle(readSet<TextRecord>('g2', plate).length > 0 ? readSet<TextRecord>('g2', plate) : [], rng(77 + Number(plate))).slice(0, 150);
    for (const r of records) {
      out.push({ kind: 'geocode', path: '/v1/geocode', body: { q: r.text, city: r.province } });
      out.push({ kind: 'geocode', path: '/v1/geocode', body: { q: r.text, city: r.province } });
      out.push({ kind: 'autocomplete', path: '/v1/autocomplete', body: { q: r.text.slice(0, Math.max(6, Math.floor(r.text.length * 0.6))), city: r.province } });
      out.push({ kind: 'reverse', path: `/v1/reverse?lng=${r.lng}&lat=${r.lat}` });
      if (out.length % 7 === 0) out.push({ kind: 'places', path: `/v1/places?lng=${r.lng}&lat=${r.lat}&group=pharmacy&radiusM=600` });
      if (out.length % 9 === 0) out.push({ kind: 'geometry-geocode', path: '/v1/geocode', body: { q: r.text, city: r.province, geometry: true } });
    }
  }
  return shuffle(out, rng(5));
}

function rssMb(pid: number): number {
  const pids = [pid];
  try {
    pids.push(...execFileSync('pgrep', ['-P', String(pid)], { encoding: 'utf8' }).split('\n').filter(Boolean).map(Number));
  } catch {
    pids.length = 1;
  }
  let kb = 0;
  for (const p of pids) {
    try {
      kb += Number(execFileSync('ps', ['-o', 'rss=', '-p', String(p)], { encoding: 'utf8' }).trim() || 0);
    } catch {
      continue;
    }
  }
  return kb / 1024;
}

const sizeOf = (dir: string): number => {
  let total = 0;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    total += st.isDirectory() ? sizeOf(full) : st.size;
  }
  return total;
};

async function main(): Promise<void> {
  if (!existsSync(join(repoRoot, 'dist', 'geo-server.mjs'))) throw new Error('önce: npm run build:server');
  const child = spawn('node', [join(repoRoot, 'dist', 'geo-server.mjs')], { env: { ...process.env, GEO_PACKS_DIR: PACKS, GEO_API_KEYS: `yuk:${KEY}:1000000`, PORT: String(PORT), HOST: '127.0.0.1', GEO_MAX_OPEN: String(MAX_OPEN), GEO_WORKERS: String(WORKERS) }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.resume();
  child.stderr.resume();
  const base = `http://127.0.0.1:${PORT}`;
  for (let i = 0; i < 100; i++) {
    if (await fetch(`${base}/health`).then((r) => r.ok).catch(() => false)) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  const work = jobs();
  const times = new Map<string, number[]>();
  let errors = 0;
  let total = 0;
  const deadline = Date.now() + SECONDS * 1000;
  const samples: { t: number; mb: number }[] = [];
  const sampler = setInterval(() => samples.push({ t: Math.round((Date.now() - (deadline - SECONDS * 1000)) / 1000), mb: Math.round(rssMb(child.pid as number)) }), 10_000);
  const run = async (client: number): Promise<void> => {
    let i = client * 37;
    while (Date.now() < deadline) {
      const job = work[i++ % work.length] as Job;
      const started = performance.now();
      try {
        const response = await fetch(`${base}${job.path}`, { method: job.body ? 'POST' : 'GET', headers: { 'x-api-key': KEY, ...(job.body ? { 'content-type': 'application/json' } : {}) }, ...(job.body ? { body: JSON.stringify(job.body) } : {}) });
        await response.text();
        if (!response.ok) errors++;
      } catch {
        errors++;
      }
      const list = times.get(job.kind) ?? [];
      list.push(performance.now() - started);
      times.set(job.kind, list);
      total++;
    }
  };
  const started = Date.now();
  await Promise.all(Array.from({ length: CLIENTS }, (_, c) => run(c)));
  clearInterval(sampler);
  const seconds = (Date.now() - started) / 1000;
  samples.push({ t: Math.round(seconds), mb: Math.round(rssMb(child.pid as number)) });
  const metrics = await fetch(`${base}/metrics`, { headers: { 'x-api-key': KEY } }).then((r) => r.text()).catch(() => '');
  child.kill('SIGTERM');
  const geocode = [...(times.get('geocode') ?? []), ...(times.get('geometry-geocode') ?? [])];
  const all = [...times.values()].flat();
  const result = {
    workers: WORKERS, clients: CLIENTS, seconds: Math.round(seconds), maxOpen: MAX_OPEN, plates: PLATES.length, requests: total, errors,
    perSecond: Math.round(total / seconds), geocodePerSecond: Math.round(geocode.length / seconds),
    geocodeP50: Math.round(quantile(geocode, 0.5) * 10) / 10, geocodeP95: Math.round(quantile(geocode, 0.95) * 10) / 10, allP95: Math.round(quantile(all, 0.95) * 10) / 10,
    byKind: Object.fromEntries([...times].map(([k, v]) => [k, { n: v.length, p50: Math.round(quantile(v, 0.5) * 10) / 10, p95: Math.round(quantile(v, 0.95) * 10) / 10 }])),
    rssMb: samples, packsMb: Math.round(sizeOf(PACKS) / 1048576), metricsLines: metrics.split('\n').length,
  };
  console.log(JSON.stringify(result));
}

void main();
