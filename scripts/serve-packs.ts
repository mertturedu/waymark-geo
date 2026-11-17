import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { defaultReportDir, processReport } from './device-report';
import { parseRunJob } from '../example/src/sdk-test/autorun';

type Options = { root: string; port: number; host?: string; log?: (line: string) => void; reportDir?: string; fieldDir?: string; now?: () => number; mounts?: Record<string, string> };

export const REPORT_LIMIT = 5 * 1024 * 1024;
export const FIELD_LIMIT = 2000;

export type FieldRecord = { id: string; at: number; text: string; point: [number, number]; source: 'gps' | 'map'; accuracyM: number | null; floor?: string; door?: string; note?: string; device?: string };

const shortText = (value: unknown, max: number): boolean => value === undefined || (typeof value === 'string' && value.length <= max);

export function acceptField(text: string): { ok: true; records: FieldRecord[] } | { ok: false; error: string } {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, error: 'json değil' };
  }
  if (!Array.isArray(value) || value.length === 0 || value.length > FIELD_LIMIT) return { ok: false, error: 'kayıt listesi boş ya da çok uzun' };
  for (const item of value as Record<string, unknown>[]) {
    const point = item.point as unknown;
    const valid =
      typeof item.id === 'string' && item.id.length <= 64 &&
      typeof item.at === 'number' &&
      typeof item.text === 'string' && item.text.trim().length >= 3 && item.text.length <= 300 &&
      Array.isArray(point) && point.length === 2 && typeof point[0] === 'number' && typeof point[1] === 'number' && point[0] >= 25 && point[0] <= 45.5 && point[1] >= 35.5 && point[1] <= 42.5 &&
      (item.source === 'gps' || item.source === 'map') &&
      (item.accuracyM === null || typeof item.accuracyM === 'number') &&
      shortText(item.floor, 12) && shortText(item.door, 12) && shortText(item.note, 200) && shortText(item.device, 60);
    if (!valid) return { ok: false, error: `geçersiz kayıt: ${typeof item.id === 'string' ? item.id : '?'}` };
  }
  return { ok: true, records: value as FieldRecord[] };
}
export const JOB_TTL_MS = 10 * 60 * 1000;

export type JobTarget = 'sim' | 'phone';

export const callerKind = (remote: string, local: string): JobTarget => {
  const clean = (value: string): string => value.replace(/^::ffff:/, '');
  return clean(remote) === clean(local) || clean(remote) === '::1' || clean(remote).startsWith('127.') ? 'sim' : 'phone';
};

export const jobTargetOf = (text: string): JobTarget | null => {
  try {
    const target = (JSON.parse(text) as { target?: unknown }).target;
    return target === 'sim' || target === 'phone' ? target : null;
  } catch {
    return null;
  }
};

export function isLocalAddress(address: string): boolean {
  const ip = address.replace(/^::ffff:/, '');
  if (ip === '::1' || ip.startsWith('127.') || ip.startsWith('10.') || ip.startsWith('192.168.')) return true;
  const match = /^172\.(\d+)\./.exec(ip);
  return match !== null && Number(match[1]) >= 16 && Number(match[1]) <= 31;
}
type Range = { start: number; end: number } | 'unsatisfiable' | null;

export function lanAddress(): string | null {
  try {
    const route = execFileSync('route', ['-n', 'get', 'default'], { encoding: 'utf8' });
    const iface = /interface:\s*(\S+)/.exec(route)?.[1];
    if (!iface) return null;
    return execFileSync('ipconfig', ['getifaddr', iface], { encoding: 'utf8' }).trim() || null;
  } catch {
    return null;
  }
}

function parseRange(header: string | undefined, size: number): Range {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (match[1] === '' && match[2] === '')) return 'unsatisfiable';
  let start: number;
  let end: number;
  if (match[1] === '') {
    const suffix = Number(match[2]);
    if (suffix === 0) return 'unsatisfiable';
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
  }
  return start >= size || start > end ? 'unsatisfiable' : { start, end };
}

function reply(res: http.ServerResponse, status: number, body = '', headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': Buffer.byteLength(body), ...headers });
  res.end(body);
}

export async function startServer(options: Options): Promise<{ url: string; close(): Promise<void> }> {
  const baseRoot = realpathSync(resolve(options.root));
  const mounts = Object.entries(options.mounts ?? {}).map(([prefix, dir]) => ({ prefix: prefix.replace(/\/+$/, ''), dir: realpathSync(resolve(dir)) }));
  const cutDone = new Set<string>();

  let job: { text: string; at: number } | null = null;
  const marks: { id: string; at: number }[] = [];
  const now = options.now ?? Date.now;

  const receiveJob = (req: http.IncomingMessage, res: http.ServerResponse): void => {
    if (!options.reportDir) return reply(res, 404, 'not found');
    if (!isLocalAddress(req.socket.remoteAddress ?? '')) return reply(res, 403, 'forbidden');
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (text.length > 64 * 1024 || parseRunJob(text) === null) return reply(res, 400, 'bad job');
      job = { text, at: now() };
      options.log?.('run job queued');
      reply(res, 200, 'queued');
    });
  };

  const handOutJob = (req: http.IncomingMessage, res: http.ServerResponse): void => {
    if (!options.reportDir || !isLocalAddress(req.socket.remoteAddress ?? '')) return reply(res, 404, 'not found');
    if (job !== null && now() - job.at > JOB_TTL_MS) job = null;
    if (job === null) return reply(res, 204);
    const wanted = jobTargetOf(job.text);
    if (wanted !== null && wanted !== callerKind(req.socket.remoteAddress ?? '', req.socket.localAddress ?? '')) return reply(res, 204);
    const body = job.text;
    job = null;
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' });
    res.end(body);
  };

  const receiveReport = (req: http.IncomingMessage, res: http.ServerResponse): void => {
    if (!options.reportDir) return reply(res, 404, 'not found');
    if (!isLocalAddress(req.socket.remoteAddress ?? '')) return reply(res, 403, 'forbidden');
    const chunks: Buffer[] = [];
    let size = 0;
    let refused = false;
    req.on('data', (chunk: Buffer) => {
      if (refused) return;
      size += chunk.length;
      if (size > REPORT_LIMIT) {
        refused = true;
        reply(res, 413, 'too large', { Connection: 'close' });
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (refused) return;
      const result = processReport(Buffer.concat(chunks).toString('utf8'), options.reportDir!);
      if (!result.ok) return reply(res, 400, `report rejected: ${result.error}`);
      options.log?.(`report saved ${result.jsonPath}`);
      reply(res, 200, result.jsonPath);
    });
  };

  const receiveField = (req: http.IncomingMessage, res: http.ServerResponse): void => {
    if (!options.fieldDir) return reply(res, 404, 'not found');
    if (!isLocalAddress(req.socket.remoteAddress ?? '')) return reply(res, 403, 'forbidden');
    const chunks: Buffer[] = [];
    let size = 0;
    let refused = false;
    req.on('data', (chunk: Buffer) => {
      if (refused) return;
      size += chunk.length;
      if (size > REPORT_LIMIT) {
        refused = true;
        reply(res, 413, 'too large', { Connection: 'close' });
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (refused) return;
      const result = acceptField(Buffer.concat(chunks).toString('utf8'));
      if (!result.ok) return reply(res, 400, `field rejected: ${result.error}`);
      mkdirSync(options.fieldDir!, { recursive: true });
      const stamp = new Date(options.now ? options.now() : Date.now()).toISOString().replace(/[-:]/g, '').replace(/\..*/, '');
      const path = join(options.fieldDir!, `${stamp}-${result.records.length}.json`);
      writeFileSync(path, JSON.stringify(result.records, null, 1));
      options.log?.(`field saved ${path}`);
      reply(res, 200, String(result.records.length));
    });
  };

  const handle = (req: http.IncomingMessage, res: http.ServerResponse): void => {
    if (options.log) {
      const remote = (req.socket.remoteAddress ?? '?').replace(/^::ffff:/, '');
      const range = req.headers.range ? ` ${req.headers.range}` : '';
      res.on('close', () => options.log?.(`${req.method} ${req.url} ${res.statusCode} ${remote}${range}`));
    }
    const url = new URL(req.url ?? '/', 'http://local');
    if (req.method === 'POST' && url.pathname === '/report') return receiveReport(req, res);
    if (req.method === 'POST' && url.pathname === '/saha') return receiveField(req, res);
    if (req.method === 'POST' && url.pathname === '/run') return receiveJob(req, res);
    if (options.reportDir && url.pathname.startsWith('/mark/') && isLocalAddress(req.socket.remoteAddress ?? '')) {
      marks.push({ id: decodeURIComponent(url.pathname.slice(6)).slice(0, 80), at: now() });
      return reply(res, 200, 'ok');
    }
    if (options.reportDir && req.method === 'GET' && url.pathname === '/marks' && isLocalAddress(req.socket.remoteAddress ?? '')) return reply(res, 200, JSON.stringify(marks), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    if (req.method === 'GET' && url.pathname === '/run') return handOutJob(req, res);
    if (req.method !== 'GET' && req.method !== 'HEAD') return reply(res, 405, 'method not allowed', { Allow: 'GET, HEAD' });
    let pathname: string;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      return reply(res, 400, 'bad request');
    }
    if (pathname.includes('\0')) return reply(res, 400, 'bad request');
    if (pathname === '/health') return reply(res, 200, 'ok');

    const mount = mounts.find((m) => pathname === m.prefix || pathname.startsWith(`${m.prefix}/`));
    const root = mount ? mount.dir : baseRoot;
    const target = resolve(root, '.' + (mount ? pathname.slice(mount.prefix.length) : pathname));
    if (target !== root && !target.startsWith(root + sep)) return reply(res, 403, 'forbidden');
    let real: string;
    try {
      real = realpathSync(target);
    } catch {
      return reply(res, 404, 'not found');
    }
    if (!real.startsWith(root + sep)) return reply(res, 403, 'forbidden');
    const stat = statSync(real);
    if (!stat.isFile()) return reply(res, 404, 'not found');

    const size = stat.size;
    const base = { 'Accept-Ranges': 'bytes', ETag: `"${size}-${Math.floor(stat.mtimeMs)}"`, 'Content-Type': 'application/octet-stream' };
    if (req.method === 'HEAD') {
      res.writeHead(200, { ...base, 'Content-Length': size });
      return void res.end();
    }

    const range = parseRange(req.headers.range, size);
    if (range === 'unsatisfiable') return reply(res, 416, '', { 'Content-Range': `bytes */${size}` });
    const start = range ? range.start : 0;
    const end = range ? range.end : size - 1;
    const length = end - start + 1;
    if (range) res.writeHead(206, { ...base, 'Content-Length': length, 'Content-Range': `bytes ${start}-${end}/${size}` });
    else res.writeHead(200, { ...base, 'Content-Length': length });

    const rate = Number(url.searchParams.get('rate'));
    if (rate > 0) {
      const slow = createReadStream(real, { start, end, highWaterMark: Math.max(1024, Math.floor(rate / 10)) });
      slow.on('error', () => res.destroy());
      slow.on('data', (chunk) => {
        slow.pause();
        res.write(chunk, () => setTimeout(() => slow.resume(), 100));
      });
      slow.on('end', () => res.end());
      res.on('close', () => slow.destroy());
      return;
    }
    const cut = Number(url.searchParams.get('cut'));
    const shouldCut = cut > 0 && cut < 1 && !cutDone.has(real);
    if (shouldCut) cutDone.add(real);
    const last = shouldCut ? start + Math.max(0, Math.floor(length * cut) - 1) : end;
    const stream = createReadStream(real, { start, end: last });
    stream.on('error', () => res.destroy());
    if (!shouldCut) return void stream.pipe(res);
    stream.on('data', (chunk) => res.write(chunk));
    stream.on('end', () => res.write('', () => res.socket?.destroy()));
  };

  const server = http.createServer(handle);
  await new Promise<void>((done) => server.listen(options.port, options.host ?? '0.0.0.0', done));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : options.port;
  const host = options.host && options.host !== '0.0.0.0' ? options.host : (lanAddress() ?? '127.0.0.1');
  return {
    url: `http://${host}:${port}`,
    close: () =>
      new Promise<void>((done, fail) => {
        server.closeAllConnections();
        server.close((error) => (error ? fail(error) : done()));
      }),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const repo = fileURLToPath(new URL('..', import.meta.url));
  const root = process.argv[2] ?? join(repo, 'dist', 'test-data');
  const oldPacks = join(repo, 'dist', 'test-data', 'old');
  const altPacks = join(repo, 'dist', 'packs-k');
  const evalSets = join(repo, 'dist', 'addr-eval');
  const adresRelease = join(repo, 'dist', 'packs-0.8-adres');
  const learnedRelease = join(repo, 'dist', 'packs-learned-test');
  const mounts: Record<string, string> = {
    ...(existsSync(oldPacks) && resolve(root) !== resolve(oldPacks) ? { '/old': oldPacks } : {}),
    ...(existsSync(altPacks) && resolve(root) !== resolve(altPacks) ? { '/k': altPacks } : {}),
    ...(existsSync(evalSets) ? { '/addr-eval': evalSets } : {}),
    ...(existsSync(adresRelease) && resolve(root) !== resolve(adresRelease) ? { '/adres-release': adresRelease } : {}),
    ...(existsSync(learnedRelease) ? { '/learned-release': learnedRelease } : {}),
  };
  startServer({ root, mounts, port: Number(process.env.PORT ?? 8090), reportDir: join(defaultReportDir(), 'cihaz'), fieldDir: join(homedir(), '.yuksi-geo', 'saha'), log: (line) => console.log(`${new Date().toISOString().slice(11, 19)} ${line}`) }).then((server) => {
    console.log(`serving ${root}${Object.keys(mounts).map((prefix) => ` (+ ${prefix})`).join('')}`);
    console.log(`phone address: ${server.url}`);
  });
}
