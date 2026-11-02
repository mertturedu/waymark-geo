import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { createReadStream, realpathSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

type Options = { root: string; port: number; host?: string; log?: (line: string) => void };
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
  const root = realpathSync(resolve(options.root));
  const cutDone = new Set<string>();

  const handle = (req: http.IncomingMessage, res: http.ServerResponse): void => {
    if (options.log) {
      const remote = (req.socket.remoteAddress ?? '?').replace(/^::ffff:/, '');
      const range = req.headers.range ? ` ${req.headers.range}` : '';
      res.on('close', () => options.log?.(`${req.method} ${req.url} ${res.statusCode} ${remote}${range}`));
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return reply(res, 405, 'method not allowed', { Allow: 'GET, HEAD' });
    const url = new URL(req.url ?? '/', 'http://local');
    let pathname: string;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      return reply(res, 400, 'bad request');
    }
    if (pathname.includes('\0')) return reply(res, 400, 'bad request');
    if (pathname === '/health') return reply(res, 200, 'ok');

    const target = resolve(root, '.' + pathname);
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
  const root = process.argv[2] ?? join(fileURLToPath(new URL('..', import.meta.url)), 'dist', 'test-data');
  startServer({ root, port: Number(process.env.PORT ?? 8090), log: (line) => console.log(`${new Date().toISOString().slice(11, 19)} ${line}`) }).then((server) => {
    console.log(`serving ${root}`);
    console.log(`phone address: ${server.url}`);
  });
}
