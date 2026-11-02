import { createFakeEnv } from '../helpers/fake-env';

const bytes = (n: number, seed = 1): Uint8Array => Uint8Array.from({ length: n }, (_, i) => (i * 7 + seed) & 255);

async function drain(body: AsyncIterable<Uint8Array>): Promise<number[]> {
  const out: number[] = [];
  for await (const chunk of body) out.push(...chunk);
  return out;
}

describe('fake file system', () => {
  it('shows either the old or the new file around a move, never a mix', async () => {
    const env = createFakeEnv();
    await env.fs.append('a/new.bin', bytes(10, 2));
    await env.fs.append('a/old.bin', bytes(10, 1));
    await env.fs.move('a/new.bin', 'a/old.bin');
    expect(Array.from(await env.fs.read('a/old.bin', 0, 10))).toEqual(Array.from(bytes(10, 2)));
    expect(await env.fs.exists('a/new.bin')).toBe(false);
  });

  it('reports free space that shrinks with writes and grows with removals', async () => {
    const env = createFakeEnv({ capacity: 100 });
    expect(await env.fs.freeBytes()).toBe(100);
    await env.fs.append('x', bytes(40));
    expect(await env.fs.freeBytes()).toBe(60);
    await env.fs.remove('x');
    expect(await env.fs.freeBytes()).toBe(100);
  });

  it('refuses a write that does not fit and leaves the file as it was', async () => {
    const env = createFakeEnv({ capacity: 50 });
    await env.fs.append('x', bytes(40));
    await expect(env.fs.append('x', bytes(20))).rejects.toMatchObject({ code: 'no-space' });
    expect(await env.fs.size('x')).toBe(40);
  });

  it('lists files below a folder and reads ranges', async () => {
    const env = createFakeEnv();
    await env.fs.append('p/1/a.bin', bytes(5));
    await env.fs.append('p/2/b.bin', bytes(5));
    await env.fs.append('q/c.bin', bytes(5));
    expect((await env.fs.list('p')).sort()).toEqual(['p/1/a.bin', 'p/2/b.bin']);
    expect(Array.from(await env.fs.read('p/1/a.bin', 2, 2))).toEqual(Array.from(bytes(5)).slice(2, 4));
  });

  it('writes text atomically and returns null for a missing file', async () => {
    const env = createFakeEnv();
    expect(await env.fs.readText('s.json')).toBeNull();
    await env.fs.writeAtomic('s.json', '{"a":1}');
    expect(await env.fs.readText('s.json')).toBe('{"a":1}');
  });
});

describe('fake network', () => {
  const url = 'https://packs.example/f.bin';

  it('serves a range from the requested byte with status 206', async () => {
    const env = createFakeEnv();
    env.server.put(url, bytes(100));
    const response = await env.net.get(url, { rangeStart: 30 });
    expect(response.status).toBe(206);
    expect(await drain(response.body)).toEqual(Array.from(bytes(100)).slice(30));
  });

  it('serves the whole file with status 200 when no range is asked', async () => {
    const env = createFakeEnv();
    env.server.put(url, bytes(10));
    const response = await env.net.get(url);
    expect(response.status).toBe(200);
    expect(await drain(response.body)).toEqual(Array.from(bytes(10)));
  });

  it('cuts the connection after the planned number of bytes, once', async () => {
    const env = createFakeEnv();
    env.server.put(url, bytes(100));
    env.server.inject({ effect: { kind: 'cut', afterBytes: 40 }, times: 1 });
    const first = await env.net.get(url);
    const got: number[] = [];
    await expect(
      (async () => {
        for await (const chunk of first.body) got.push(...chunk);
      })(),
    ).rejects.toThrow();
    expect(got.length).toBe(40);
    const second = await env.net.get(url, { rangeStart: 40 });
    expect((await drain(second.body)).length).toBe(60);
  });

  it('answers with injected statuses and unknown paths with 404', async () => {
    const env = createFakeEnv();
    env.server.put(url, bytes(10));
    env.server.inject({ effect: { kind: 'status', status: 503 }, times: 2 });
    expect((await env.net.get(url)).status).toBe(503);
    expect((await env.net.get(url)).status).toBe(503);
    expect((await env.net.get(url)).status).toBe(200);
    expect((await env.net.get('https://packs.example/none')).status).toBe(404);
  });

  it('ignores the range when told to and rejects when offline', async () => {
    const env = createFakeEnv();
    env.server.put(url, bytes(10));
    env.server.inject({ effect: { kind: 'no-range' }, times: 1 });
    const whole = await env.net.get(url, { rangeStart: 4 });
    expect(whole.status).toBe(200);
    expect((await drain(whole.body)).length).toBe(10);
    env.server.inject({ effect: { kind: 'offline' }, times: 1 });
    await expect(env.net.get(url)).rejects.toThrow();
  });

  it('records every request in order', async () => {
    const env = createFakeEnv();
    env.server.put(url, bytes(10));
    await env.net.get(url);
    await env.net.getText('https://packs.example/missing');
    expect(env.server.log.map((r) => r.url)).toEqual([url, 'https://packs.example/missing']);
  });

  it('returns text and the hash of a stored file', async () => {
    const env = createFakeEnv();
    env.server.put('https://packs.example/m.json', new TextEncoder().encode('{"ok":true}'));
    expect(await env.net.getText('https://packs.example/m.json')).toEqual({ status: 200, text: '{"ok":true}' });
    await env.fs.append('h.bin', new TextEncoder().encode('abc'));
    expect(await env.hash.sha256File('h.bin')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
