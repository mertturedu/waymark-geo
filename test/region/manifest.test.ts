import { parseManifest, serializeManifest, type Manifest } from '../../src/core/region/manifest';

const sha = (c: string): string => c.repeat(64);

const valid = (): Manifest => ({
  format: 1,
  minSdk: '0.1.0',
  osm: { file: 'turkey-261020.osm.pbf', time: '2026-10-20T20:23:47Z' },
  tiles: { build: '20261022', time: '2026-10-22T04:00:00Z' },
  base: [
    { kind: 'base', path: 'base-20261022/overview.pmtiles', size: 9_000_000, sha256: sha('a') },
    { kind: 'base', path: 'base-20261022/sprites/v4/light.json', size: 120, sha256: sha('b') },
  ],
  regions: [
    {
      id: '06',
      tier: 'basic',
      names: { tr: 'Ankara', en: 'Ankara', ar: 'أنقرة' },
      bbox: [31.2, 38.9, 34.0, 40.6],
      version: '20261020.20261022',
      stats: { addresses: 22128, streets: 12973, neighbourhoods: 1059 },
      files: [
        { kind: 'address', path: '06/address-1a2b3c4d.sqlite', size: 5_920_000, sha256: sha('c') },
        { kind: 'tiles', path: '06/tiles-5e6f7a8b.pmtiles', size: 51_900_000, sha256: sha('d') },
      ],
    },
    {
      id: '34',
      tier: 'full',
      names: { tr: 'İstanbul' },
      bbox: [27.9, 40.7, 30.0, 41.7],
      version: '20261020.20261022',
      stats: { addresses: 43264, streets: 26269, neighbourhoods: 974 },
      files: [{ kind: 'address', path: '34/address-0a0b0c0d.sqlite', size: 13_350_000, sha256: sha('e') }],
    },
  ],
});

type Loose = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const edit = (change: (m: Loose) => void): string => {
  const copy = JSON.parse(JSON.stringify(valid())) as Loose;
  change(copy);
  return JSON.stringify(copy);
};

describe('the places overlay file kind', () => {
  it('is accepted in a region of either tier', () => {
    const m = valid();
    const places = { kind: 'places' as const, path: '06/places-0a1b2c3d.pmtiles', size: 1_800_000, sha256: sha('f') };
    (m.regions[0] as { files: unknown[] }).files.push(places);
    (m.regions[1] as { files: unknown[] }).files.push({ ...places, path: '34/places-0a1b2c3e.pmtiles' });
    const parsed = parseManifest(serializeManifest(m));
    expect(parsed.regions[0]?.files.some((f) => f.kind === 'places')).toBe(true);
    expect(parsed.regions[1]?.files.some((f) => f.kind === 'places')).toBe(true);
  });

  it('is not allowed in the base list', () => {
    const m = valid();
    (m.base[0] as { kind: string }).kind = 'places';
    expect(() => parseManifest(serializeManifest(m))).toThrow(/dosya türü geçersiz: places/);
  });
});

describe('manifest format 2 and kinds this SDK does not know', () => {
  it('reads format 2 and keeps it', () => {
    const m = valid();
    (m as { format: number }).format = 2;
    expect(parseManifest(serializeManifest(m)).format).toBe(2);
  });

  it('skips a file of a kind it does not know, in the base list and in a region, and keeps the rest', () => {
    const m = valid();
    const text = JSON.parse(serializeManifest(m));
    text.base.push({ kind: 'video', path: 'base-1/v.bin', size: 1, sha256: 'a'.repeat(64) });
    text.regions[0].files.push({ kind: 'holograms', path: '34/holograms-1.bin', size: 1, sha256: 'b'.repeat(64) });
    const parsed = parseManifest(JSON.stringify(text));
    expect(parsed.base).toEqual(m.base);
    expect(parsed.regions[0]?.files).toEqual(m.regions[0]?.files);
  });

  it('reads the learned kind in a region', () => {
    const m = valid();
    const text = JSON.parse(serializeManifest(m));
    text.regions[0].files.push({ kind: 'learned', path: '34/learned-1.sqlite', size: 5, sha256: 'd'.repeat(64) });
    expect(parseManifest(JSON.stringify(text)).regions[0]?.files.map((f) => f.kind)).toContain('learned');
  });

  it('reads the buildings2 kind in a full or a basic region', () => {
    const m = valid();
    const text = JSON.parse(serializeManifest(m));
    text.regions[0].files.push({ kind: 'buildings2', path: '34/buildings2-1.sqlite', size: 5, sha256: 'c'.repeat(64) });
    expect(parseManifest(JSON.stringify(text)).regions[0]?.files.some((f) => f.kind === 'buildings2')).toBe(true);
    text.regions[0].tier = 'basic';
    expect(parseManifest(JSON.stringify(text)).regions[0]?.files.some((f) => f.kind === 'buildings2')).toBe(true);
  });
});

describe('serializeManifest and parseManifest', () => {
  it('write keys in sorted order with a closing newline and read back the same manifest', () => {
    const text = serializeManifest(valid());
    expect(text.endsWith('}\n')).toBe(true);
    expect(Object.keys(JSON.parse(text))).toEqual(['base', 'format', 'minSdk', 'osm', 'regions', 'tiles']);
    expect(parseManifest(text)).toEqual(valid());
    expect(serializeManifest(parseManifest(text))).toBe(text);
  });

  it('give the same text whatever the order of keys in the input object', () => {
    const shuffled = JSON.parse(JSON.stringify(valid()), (_k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).reverse()) : v));
    expect(serializeManifest(shuffled)).toBe(serializeManifest(valid()));
  });

  it('keep the order of the regions and files as given', () => {
    const swapped = valid();
    swapped.regions.reverse();
    expect(parseManifest(serializeManifest(swapped)).regions.map((r) => r.id)).toEqual(['34', '06']);
  });

  it.each([
    ['text that is not JSON', () => 'oops', /^manifest: JSON okunamadı$/],
    ['an array', () => '[]', /^manifest: kök nesne olmalı$/],
    ['null', () => 'null', /^manifest: kök nesne olmalı$/],
    ['another format', () => edit((m) => (m.format = 3 as never)), /^manifest: biçim sürümü desteklenmiyor$/],
    ['no format', () => edit((m) => delete m.format), /^manifest: biçim sürümü desteklenmiyor$/],
    ['a short minSdk', () => edit((m) => (m.minSdk = '1.0')), /^manifest: minSdk geçersiz$/],
    ['a minSdk with a fourth part', () => edit((m) => (m.minSdk = '1.0.0.0')), /^manifest: minSdk geçersiz$/],
    ['a minSdk with a prefix', () => edit((m) => (m.minSdk = 'v1.0.0')), /^manifest: minSdk geçersiz$/],
    ['a minSdk with a suffix', () => edit((m) => (m.minSdk = '1.0.0-beta')), /^manifest: minSdk geçersiz$/],
    ['a minSdk with two dots in the first part', () => edit((m) => (m.minSdk = '1..0.0')), /^manifest: minSdk geçersiz$/],
    ['a missing osm', () => edit((m) => delete m.osm), /^manifest: osm nesne olmalı$/],
    ['an empty osm file', () => edit((m) => (m.osm.file = '')), /^manifest: osm dosyası geçersiz$/],
    ['a missing osm time', () => edit((m) => delete m.osm.time), /^manifest: osm zamanı geçersiz$/],
    ['a missing tiles', () => edit((m) => delete m.tiles), /^manifest: tiles nesne olmalı$/],
    ['a dashed build date', () => edit((m) => (m.tiles.build = '2026-10-22')), /^manifest: karo derlemesi geçersiz$/],
    ['a long build date', () => edit((m) => (m.tiles.build = '202610221')), /^manifest: karo derlemesi geçersiz$/],
    ['a build date with a prefix', () => edit((m) => (m.tiles.build = 'x20261022')), /^manifest: karo derlemesi geçersiz$/],
    ['a build date with a suffix', () => edit((m) => (m.tiles.build = '20261022x')), /^manifest: karo derlemesi geçersiz$/],
    ['an empty tiles time', () => edit((m) => (m.tiles.time = '')), /^manifest: karo zamanı geçersiz$/],
    ['base that is not a list', () => edit((m) => (m.base = {})), /^manifest: base dizi olmalı$/],
    ['regions that are not a list', () => edit((m) => (m.regions = 'x')), /^manifest: regions dizi olmalı$/],
    ['files that are not a list', () => edit((m) => (m.regions[0].files = {})), /^manifest: dosyalar dizi olmalı$/],
    ['a file that is not an object', () => edit((m) => (m.base = ['x'])), /^manifest: dosya nesne olmalı$/],
    ['a file with no kind', () => edit((m) => delete m.base[0].kind), /^manifest: dosya türü geçersiz$/],
    ['a base kind in a region', () => edit((m) => (m.regions[0].files[0].kind = 'base')), /^manifest: dosya türü geçersiz: base$/],
    ['an address kind in the base list', () => edit((m) => (m.base[0].kind = 'address')), /^manifest: dosya türü geçersiz: address$/],
    ['an empty path', () => edit((m) => (m.base[0].path = '')), /^manifest: dosya yolu geçersiz$/],
    ['a path that climbs out', () => edit((m) => (m.base[0].path = '../etc/passwd')), /^manifest: yol geçersiz: \.\.\/etc\/passwd$/],
    ['a path with a middle climb', () => edit((m) => (m.regions[0].files[0].path = '06/../../x')), /^manifest: yol geçersiz: 06/],
    ['a path with a dot piece', () => edit((m) => (m.base[0].path = 'a/./b')), /^manifest: yol geçersiz: a\/\.\/b$/],
    ['a path starting with a dot piece', () => edit((m) => (m.base[0].path = './a')), /^manifest: yol geçersiz: \.\/a$/],
    ['an absolute path', () => edit((m) => (m.base[0].path = '/abs/overview.pmtiles')), /^manifest: yol geçersiz: \/abs/],
    ['a backslash path', () => edit((m) => (m.base[0].path = 'a\\b')), /^manifest: yol geçersiz: a/],
    ['a path with an encoded dot piece', () => edit((m) => (m.base[0].path = '%2e%2e/%2e%2e/etc/passwd')), /^manifest: yol geçersiz: %2e/],
    ['a path with a query', () => edit((m) => (m.base[0].path = 'a.bin?x=1')), /^manifest: yol geçersiz: a\.bin\?x=1$/],
    ['a path with a fragment', () => edit((m) => (m.base[0].path = 'a.bin#x')), /^manifest: yol geçersiz: a\.bin#x$/],
    ['an empty path piece', () => edit((m) => (m.base[0].path = 'a//b')), /^manifest: yol geçersiz: a\/\/b$/],
    ['a path ending in a slash', () => edit((m) => (m.base[0].path = 'a/')), /^manifest: yol geçersiz: a\/$/],
    ['a path used twice', () => edit((m) => (m.regions[1].files[0].path = m.regions[0].files[0].path)), /^manifest: yol iki kez: 06\/address-1a2b3c4d\.sqlite$/],
    ['a short digest', () => edit((m) => (m.base[0].sha256 = 'abc')), /^manifest: sha256 geçersiz$/],
    ['a capital letter digest', () => edit((m) => (m.base[0].sha256 = 'A'.repeat(64))), /^manifest: sha256 geçersiz$/],
    ['a digest with a prefix', () => edit((m) => (m.base[0].sha256 = 'x' + 'a'.repeat(64))), /^manifest: sha256 geçersiz$/],
    ['a digest with a suffix', () => edit((m) => (m.base[0].sha256 = 'a'.repeat(64) + 'x')), /^manifest: sha256 geçersiz$/],
    ['a negative size', () => edit((m) => (m.base[0].size = -1)), /^manifest: boyut geçersiz$/],
    ['a fractional size', () => edit((m) => (m.base[0].size = 1.5)), /^manifest: boyut geçersiz$/],
    ['a size written as text', () => edit((m) => (m.base[0].size = '5')), /^manifest: boyut geçersiz$/],
    ['a region that is not an object', () => edit((m) => (m.regions = [5])), /^manifest: bölge nesne olmalı$/],
    ['a region id used twice', () => edit((m) => (m.regions[1].id = '06')), /^manifest: bölge iki kez: 06$/],
    ['a region id with one digit', () => edit((m) => (m.regions[0].id = '6')), /^manifest: bölge kimliği geçersiz$/],
    ['a region id with three digits', () => edit((m) => (m.regions[0].id = '106')), /^manifest: bölge kimliği geçersiz$/],
    ['a region id with a prefix', () => edit((m) => (m.regions[0].id = ' 06')), /^manifest: bölge kimliği geçersiz$/],
    ['names that are not an object', () => edit((m) => (m.regions[0].names = [])), /^manifest: adlar nesne olmalı$/],
    ['a name that is not text', () => edit((m) => (m.regions[0].names.en = 5)), /^manifest: ad en geçersiz$/],
    ['an empty name', () => edit((m) => (m.regions[0].names.de = '')), /^manifest: ad de geçersiz$/],
    ['a region with no Turkish name', () => edit((m) => delete m.regions[0].names.tr), /^manifest: Türkçe ad yok$/],
    ['an inverted box', () => edit((m) => (m.regions[0].bbox = [34, 38.9, 31.2, 40.6])), /^manifest: bbox ters$/],
    ['a box with no width', () => edit((m) => (m.regions[0].bbox = [31.2, 38.9, 31.2, 40.6])), /^manifest: bbox ters$/],
    ['a box with no height', () => edit((m) => (m.regions[0].bbox = [31.2, 38.9, 34, 38.9])), /^manifest: bbox ters$/],
    ['a box turned upside down', () => edit((m) => (m.regions[0].bbox = [31.2, 40.6, 34, 38.9])), /^manifest: bbox ters$/],
    ['a box with a missing number', () => edit((m) => (m.regions[0].bbox = [1, 2, 3])), /^manifest: bbox geçersiz$/],
    ['a box with five numbers', () => edit((m) => (m.regions[0].bbox = [1, 2, 3, 4, 5])), /^manifest: bbox geçersiz$/],
    ['a box with text', () => edit((m) => (m.regions[0].bbox = [1, 2, 3, '4'])), /^manifest: bbox geçersiz$/],
    ['a box with an infinite number', () => edit((m) => (m.regions[0].bbox = [1, 2, 3, 'INF'])).replace('"INF"', '1e999'), /^manifest: bbox geçersiz$/],
    ['a box that is not a list', () => edit((m) => (m.regions[0].bbox = 'x')), /^manifest: bbox dizi olmalı$/],
    ['no tier', () => edit((m) => delete m.regions[0].tier), /^manifest: katman geçersiz$/],
    ['an unknown tier', () => edit((m) => (m.regions[0].tier = 'gold')), /^manifest: katman geçersiz$/],
    ['a buildings file in a basic region', () => edit((m) => (m.regions[0].files[0].kind = 'buildings')), /^manifest: basic bölgede buildings dosyası olamaz: 06$/],
    ['an empty version', () => edit((m) => (m.regions[0].version = '')), /^manifest: sürüm geçersiz$/],
    ['stats that are not an object', () => edit((m) => (m.regions[0].stats = 1)), /^manifest: sayılar nesne olmalı$/],
    ['a negative address count', () => edit((m) => (m.regions[0].stats.addresses = -3)), /^manifest: adres sayısı geçersiz$/],
    ['a negative street count', () => edit((m) => (m.regions[0].stats.streets = -3)), /^manifest: sokak sayısı geçersiz$/],
    ['a negative neighbourhood count', () => edit((m) => (m.regions[0].stats.neighbourhoods = -3)), /^manifest: mahalle sayısı geçersiz$/],
  ])('refuse %s', (_name, text, message) => {
    expect(() => parseManifest(text())).toThrow(message);
  });

  it('accepts a buildings file in a full region and keeps the tier', () => {
    const text = edit((m) => m.regions[1].files.push({ kind: 'buildings', path: '34/buildings-0a0b0c0d.sqlite', size: 7, sha256: 'f'.repeat(64) }));
    const manifest = parseManifest(text);
    expect(manifest.regions.map((r) => r.tier)).toEqual(['basic', 'full']);
    expect(manifest.regions[1]?.files.map((f) => f.kind)).toEqual(['address', 'buildings']);
  });

  it('accept the edges of what is allowed', () => {
    const text = edit((m) => {
      m.minSdk = '10.20.30';
      m.base[0].size = 0;
      m.regions[0].files[0].kind = 'route';
      m.regions[0].bbox = [-1.5, -2.5, -1, -2];
      m.regions[0].stats = { addresses: 0, streets: 0, neighbourhoods: 0 };
    });
    const manifest = parseManifest(text);
    expect(manifest.minSdk).toBe('10.20.30');
    expect(manifest.base[0]?.size).toBe(0);
    expect(manifest.regions[0]?.files[0]?.kind).toBe('route');
    expect(manifest.regions[0]?.bbox).toEqual([-1.5, -2.5, -1, -2]);
    expect(parseManifest(edit((m) => (m.regions[0].files[1].kind = 'tiles'))).regions[0]?.files[1]?.kind).toBe('tiles');
  });

  it('accept extra fields from a newer writer and drop them', () => {
    const text = edit((m) => {
      m.future = { a: 1 };
      m.regions[0].note = 'x';
    });
    expect(parseManifest(text)).toEqual(valid());
  });
});

describe('encoded files', () => {
  const base = (encoded: unknown) => ({
    format: 1,
    minSdk: '0.5.0',
    osm: { file: 'a.pbf', time: 't' },
    tiles: { build: '20261030', time: 't' },
    base: [],
    regions: [{ id: '34', tier: 'full', names: { tr: 'İstanbul' }, bbox: [28, 40, 30, 42], version: 'v', stats: { addresses: 1, streets: 1, neighbourhoods: 1 }, files: [{ kind: 'address', path: '34/a.sqlite', size: 100, sha256: 'a'.repeat(64), ...(encoded === undefined ? {} : { encoded }) }] }],
  });
  const good = { codec: 'zstd', path: '34/a.sqlite.zst', size: 40, sha256: 'b'.repeat(64) };

  it('reads a zstd file next to the real file and keeps the real file fields', () => {
    const file = parseManifest(JSON.stringify(base(good))).regions[0]!.files[0]!;
    expect(file.encoded).toEqual(good);
    expect(file).toMatchObject({ path: '34/a.sqlite', size: 100 });
    expect(parseManifest(JSON.stringify(base(undefined))).regions[0]!.files[0]!.encoded).toBeUndefined();
  });

  it.each([
    [{ ...good, codec: 'gzip' }, /sıkıştırma türü/],
    [{ ...good, path: '34/a.sqlite' }, /yol iki kez/],
    [{ ...good, path: '../x.zst' }, /yol geçersiz/],
    [{ ...good, size: 0 }, /sıkıştırılmış boyut sıfır/],
    [{ ...good, size: 1.5 }, /sıkıştırılmış boyut geçersiz/],
    [{ ...good, sha256: 'xyz' }, /sıkıştırılmış sha256 geçersiz/],
    ['text', /sıkıştırılmış dosya nesne olmalı/],
  ])('refuses %j', (encoded, message) => {
    expect(() => parseManifest(JSON.stringify(base(encoded)))).toThrow(message);
  });
});

describe('patches', () => {
  const doc = (patches: unknown, extra: Record<string, unknown> = {}) => ({
    format: 1,
    minSdk: '0.5.0',
    osm: { file: 'a.pbf', time: 't' },
    tiles: { build: '20261030', time: 't' },
    base: [],
    regions: [{ id: '34', tier: 'full', names: { tr: 'İstanbul' }, bbox: [28, 40, 30, 42], version: 'v', stats: { addresses: 1, streets: 1, neighbourhoods: 1 }, files: [{ kind: 'tiles', path: '34/t.pmtiles', size: 100, sha256: 'a'.repeat(64), ...(patches === undefined ? {} : { patches }) }] }],
    ...extra,
  });
  const good = { from: 'c'.repeat(64), codec: 'zstd-patch-seg', path: '34/patches/a-from-c.zpatch', size: 40, sha256: 'b'.repeat(64), segment: 8_388_608, margin: 4_194_304 };
  const read = (patches: unknown) => parseManifest(JSON.stringify(doc(patches))).regions[0]!.files[0]!;

  it('reads a patch next to the file and keeps the file fields', () => {
    const file = read([good]);
    expect(file.patches).toEqual([good]);
    expect(file).toMatchObject({ path: '34/t.pmtiles', size: 100 });
    expect(read(undefined).patches).toBeUndefined();
  });

  it('survives a round trip through serialize', () => {
    const first = parseManifest(JSON.stringify(doc([good])));
    expect(parseManifest(serializeManifest(first))).toEqual(first);
  });

  it('reads a manifest with patches and unknown fields without changing the file list', () => {
    const plain = parseManifest(JSON.stringify(doc(undefined)));
    const patched = parseManifest(JSON.stringify(doc([good], { future: { x: 1 } })));
    expect(patched.regions[0]!.files[0]).toEqual({ ...plain.regions[0]!.files[0], patches: [good] });
  });

  it.each([
    ['a wrong codec', { ...good, codec: 'bsdiff' }],
    ['a malformed source hash', { ...good, from: 'xyz' }],
    ['a source equal to the file itself', { ...good, from: 'a'.repeat(64) }],
    ['a malformed patch hash', { ...good, sha256: 'xyz' }],
    ['a missing path', { ...good, path: undefined }],
    ['a path that climbs out', { ...good, path: '../x.zpatch' }],
    ['the file path reused', { ...good, path: '34/t.pmtiles' }],
    ['a zero size', { ...good, size: 0 }],
    ['a fractional size', { ...good, size: 1.5 }],
    ['a zero segment', { ...good, segment: 0 }],
    ['a fractional segment', { ...good, segment: 1.5 }],
    ['a text size', { ...good, size: '40' }],
    ['a missing patch hash', { ...good, sha256: undefined }],
    ['a missing source', { ...good, from: undefined }],
    ['a numeric path', { ...good, path: 7 }],
    ['a list', [good]],
    ['a source given as a list', { ...good, from: ['c'.repeat(64)] }],
    ['a missing margin', { ...good, margin: undefined }],
    ['a negative margin', { ...good, margin: -1 }],
    ['text instead of an object', 'text'],
    ['null', null],
  ])('drops only the patch with %s', (_name, bad) => {
    const other = { ...good, from: 'd'.repeat(64), path: '34/patches/a-from-d.zpatch' };
    const file = read([bad, other]);
    expect(file.patches).toEqual([other]);
    expect(file.path).toBe('34/t.pmtiles');
  });

  describe('block hashes of a patch', () => {
    const blocks = { size: 20, sha256: ['d'.repeat(64), 'e'.repeat(64)] };

    it('keeps them and survives a round trip', () => {
      expect(read([{ ...good, blocks }]).patches).toEqual([{ ...good, blocks }]);
      const first = parseManifest(JSON.stringify(doc([{ ...good, blocks }])));
      expect(parseManifest(serializeManifest(first))).toEqual(first);
    });

    it.each([
      ['a block count that does not fit the size', { size: 20, sha256: ['d'.repeat(64)] }],
      ['too many blocks', { size: 20, sha256: ['d'.repeat(64), 'e'.repeat(64), 'f'.repeat(64)] }],
      ['a malformed block hash', { size: 20, sha256: ['d'.repeat(64), 'xyz'] }],
      ['a zero block size', { size: 0, sha256: [] }],
      ['a fractional block size', { size: 1.5, sha256: ['d'.repeat(64)] }],
      ['hashes that are not a list', { size: 20, sha256: 'd'.repeat(64) }],
      ['no hashes', { size: 20 }],
      ['text instead of an object', 'blocks'],
      ['null', null],
    ])('drops the patch with %s', (_name, bad) => {
      const other = { ...good, from: 'd'.repeat(64), path: '34/patches/a-from-d.zpatch' };
      expect(read([{ ...good, blocks: bad }, other]).patches).toEqual([other]);
    });
  });

  it('leaves no patches field when none are usable', () => {
    expect(read([{ ...good, size: 0 }]).patches).toBeUndefined();
    expect(read('nope').patches).toBeUndefined();
    expect(read({}).patches).toBeUndefined();
    expect(read([]).patches).toBeUndefined();
  });

  it('keeps the first of two patches from the same source or on the same path', () => {
    const sameFrom = { ...good, path: '34/patches/other.zpatch' };
    const samePath = { ...good, from: 'd'.repeat(64) };
    expect(read([good, sameFrom]).patches).toEqual([good]);
    expect(read([good, samePath]).patches).toEqual([good]);
  });

  it('keeps every distinct usable patch in order, and accepts a zero margin', () => {
    const second = { ...good, from: 'd'.repeat(64), path: '34/patches/a-from-d.zpatch', margin: 0 };
    const third = { ...good, from: 'e'.repeat(64), path: '34/patches/a-from-e.zpatch' };
    expect(read([good, second, third]).patches).toEqual([good, second, third]);
  });

  it('keeps a patch that can sit beside an encoded file', () => {
    const withEncoded = doc([good]);
    (withEncoded.regions[0]!.files[0] as Record<string, unknown>).encoded = { codec: 'zstd', path: '34/t.pmtiles.zst', size: 40, sha256: 'e'.repeat(64) };
    expect(parseManifest(JSON.stringify(withEncoded)).regions[0]!.files[0]!.patches).toEqual([good]);
    (withEncoded.regions[0]!.files[0] as { patches: unknown[] }).patches = [{ ...good, path: '34/t.pmtiles.zst' }];
    expect(parseManifest(JSON.stringify(withEncoded)).regions[0]!.files[0]!.patches).toBeUndefined();
  });
});
