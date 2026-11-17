import fc from 'fast-check';
import { generateKeyPairSync } from 'node:crypto';
import { signManifest } from '../../pipeline/build/manifest';
import { compareVersions, diffManifest, verifyManifest } from '../../src/core/packs/verify';
import { serializeManifest, type Manifest } from '../../src/core/region/manifest';

const sha = (c: string): string => c.repeat(64);

const manifest = (): Manifest => ({
  format: 1,
  minSdk: '0.1.0',
  osm: { file: 'turkey-261020.osm.pbf', time: '2026-10-20T20:23:47Z' },
  tiles: { build: '20261022', time: '2026-10-22T04:00:00Z' },
  base: [{ kind: 'base', path: 'base-20261022/overview.pmtiles', size: 9, sha256: sha('a') }],
  regions: [
    { id: '34', tier: 'full', names: { tr: 'İstanbul' }, bbox: [27.9, 40.7, 30, 41.7], version: '20261020.20261022', stats: { addresses: 1, streets: 2, neighbourhoods: 3 }, files: [{ kind: 'address', path: '34/address-0a0b0c0d.sqlite', size: 5, sha256: sha('b') }] },
    { id: '35', tier: 'full', names: { tr: 'İzmir' }, bbox: [26, 37.8, 28.5, 39.4], version: '20261020.20261022', stats: { addresses: 1, streets: 2, neighbourhoods: 3 }, files: [{ kind: 'address', path: '35/address-1a1b1c1d.sqlite', size: 6, sha256: sha('c') }] },
  ],
});

const keys = () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const privatePem = String(privateKey.export({ type: 'pkcs8', format: 'pem' }));
  const publicPem = String(publicKey.export({ type: 'spki', format: 'pem' }));
  const der = publicKey.export({ type: 'spki', format: 'der' });
  const raw = Buffer.from(der).subarray(der.length - 32).toString('base64');
  return { privatePem, publicPem, raw };
};

const signed = (m: Manifest = manifest()) => {
  const k = keys();
  const text = serializeManifest(m);
  return { ...k, text, signature: signManifest(text, k.privatePem) };
};

const verify = (text: string, signature: string, publicKeys: string[], sdkVersion = '0.1.0') => verifyManifest({ text, signature, publicKeys, sdkVersion });

describe('verifyManifest', () => {
  it('accepts a manifest signed the way the build signs it', () => {
    const s = signed();
    const result = verify(s.text, s.signature, [s.publicPem]);
    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect(result.manifest.regions.map((r) => r.id)).toEqual(['34', '35']);
  });

  it('accepts a raw base64 key as well as a PEM key', () => {
    const s = signed();
    expect(verify(s.text, s.signature, [s.raw]).ok).toBe(true);
  });

  it('passes when any one of several keys matches, skipping unusable ones', () => {
    const s = signed();
    const other = keys();
    expect(verify(s.text, s.signature, [other.publicPem, 'not a key', '', s.raw]).ok).toBe(true);
  });

  it('rejects a signature made with another key', () => {
    const s = signed();
    const other = keys();
    expect(verify(s.text, s.signature, [other.publicPem])).toEqual({ ok: false, code: 'signature' });
  });

  it('rejects a manifest changed by one byte, including extra whitespace', () => {
    const s = signed();
    expect(verify(s.text.replace('"34"', '"43"'), s.signature, [s.publicPem])).toEqual({ ok: false, code: 'signature' });
    expect(verify(`${s.text} `, s.signature, [s.publicPem])).toEqual({ ok: false, code: 'signature' });
  });

  it('rejects a missing, short or garbled signature and no keys at all', () => {
    const s = signed();
    expect(verify(s.text, '', [s.publicPem])).toEqual({ ok: false, code: 'signature' });
    expect(verify(s.text, 'AAAA', [s.publicPem])).toEqual({ ok: false, code: 'signature' });
    expect(verify(s.text, '<html>sign in</html>', [s.publicPem])).toEqual({ ok: false, code: 'signature' });
    expect(verify(s.text, s.signature, [])).toEqual({ ok: false, code: 'signature' });
  });

  it('calls empty, cut and html text malformed', () => {
    const s = signed();
    expect(verify('', s.signature, [s.publicPem])).toEqual({ ok: false, code: 'malformed' });
    expect(verify(s.text.slice(0, 200), s.signature, [s.publicPem])).toEqual({ ok: false, code: 'malformed' });
    expect(verify('<html><body>Wi-Fi login</body></html>', s.signature, [s.publicPem])).toEqual({ ok: false, code: 'malformed' });
  });

  it('calls a signed but structurally wrong manifest malformed', () => {
    const k = keys();
    const text = '{"format":1}\n';
    expect(verify(text, signManifest(text, k.privatePem), [k.publicPem])).toEqual({ ok: false, code: 'malformed' });
  });

  it('reports a newer format as manifest-newer once the signature holds', () => {
    const k = keys();
    const text = serializeManifest({ ...manifest(), format: 2 } as unknown as Manifest);
    expect(verify(text, signManifest(text, k.privatePem), [k.publicPem])).toEqual({ ok: false, code: 'manifest-newer' });
    expect(verify(text, signManifest(text, k.privatePem), [keys().publicPem])).toEqual({ ok: false, code: 'signature' });
  });

  it('reports sdk-too-old when minSdk is above the running version', () => {
    const k = keys();
    const text = serializeManifest({ ...manifest(), minSdk: '0.2.0' });
    const signature = signManifest(text, k.privatePem);
    expect(verify(text, signature, [k.publicPem], '0.1.9')).toEqual({ ok: false, code: 'sdk-too-old' });
    expect(verify(text, signature, [k.publicPem], '0.2.0').ok).toBe(true);
    expect(verify(text, signature, [k.publicPem], '1.0.0').ok).toBe(true);
  });

  it('skips keys with characters outside base64 and keys that only look like a certificate', () => {
    const s = signed();
    const raw = Buffer.from(s.raw, 'base64');
    const wrongPrefix = Buffer.concat([Buffer.alloc(12), raw]).toString('base64');
    expect(verify(s.text, s.signature, ['%%%%', '****', wrongPrefix])).toEqual({ ok: false, code: 'signature' });
    expect(verify(s.text, s.signature, ['%%%%', s.raw]).ok).toBe(true);
  });

  it('rejects a signature of the wrong length even when it is valid base64', () => {
    const s = signed();
    const raw = Buffer.from(s.signature.trim(), 'base64');
    expect(verify(s.text, raw.subarray(0, 63).toString('base64'), [s.publicPem])).toEqual({ ok: false, code: 'signature' });
    expect(verify(s.text, Buffer.concat([raw, Buffer.from([0])]).toString('base64'), [s.publicPem])).toEqual({ ok: false, code: 'signature' });
  });

  it('calls valid JSON that is not an object malformed', () => {
    const k = keys();
    for (const text of ['null', '5', '"x"', '[]', '[{"format":1}]', 'true']) expect(verify(text, signManifest(text, k.privatePem), [k.publicPem])).toEqual({ ok: false, code: 'malformed' });
  });

  it('does not read a text format or text minSdk as a version', () => {
    const k = keys();
    const base = JSON.parse(serializeManifest(manifest())) as Record<string, unknown>;
    const run = (patch: Record<string, unknown>) => {
      const text = JSON.stringify({ ...base, ...patch });
      return verify(text, signManifest(text, k.privatePem), [k.publicPem]);
    };
    expect(run({ format: '2' })).toEqual({ ok: false, code: 'malformed' });
    expect(run({ minSdk: 9 })).toEqual({ ok: false, code: 'malformed' });
    expect(run({ minSdk: '9.x' })).toEqual({ ok: false, code: 'malformed' });
  });

  it('never throws on random bytes as signature or key', () => {
    const s = signed();
    fc.assert(
      fc.property(fc.string(), fc.string(), (signature, key) => {
        const result = verify(s.text, signature, [key]);
        return result.ok === false;
      }),
      { numRuns: 300 },
    );
  });
});

describe('compareVersions', () => {
  it('orders numerically, not as text', () => {
    expect(compareVersions('0.10.0', '0.9.0')).toBe(1);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('0.1.9', '0.2.0')).toBe(-1);
    expect(compareVersions('2.0.0', '1.99.99')).toBe(1);
  });
});

describe('diffManifest', () => {
  it('lists added, removed and changed regions with the changed file kinds', () => {
    const old = manifest();
    const next = manifest();
    next.regions = [
      { ...(next.regions[0] as Manifest['regions'][number]), version: '20261101.20261022', files: [{ kind: 'address', path: '34/address-ffffffff.sqlite', size: 5, sha256: sha('d') }] },
      { ...(next.regions[1] as Manifest['regions'][number]), id: '41', names: { tr: 'Kocaeli' } },
    ];
    expect(diffManifest(old, next)).toEqual({ added: ['41'], removed: ['35'], changed: [{ id: '34', kinds: ['address'] }], baseChanged: false });
  });

  it('notices a changed base pack and nothing else when regions match', () => {
    const old = manifest();
    const next = manifest();
    next.base = [{ kind: 'base', path: 'base-20261029/overview.pmtiles', size: 9, sha256: sha('e') }];
    expect(diffManifest(old, next)).toEqual({ added: [], removed: [], changed: [], baseChanged: true });
    expect(diffManifest(old, manifest())).toEqual({ added: [], removed: [], changed: [], baseChanged: false });
  });
});
