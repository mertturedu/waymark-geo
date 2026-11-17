import fc from 'fast-check';
import { REGION_STATES } from '../../src';
import { nextAttribution } from '../../src/native/logic/attribution';
import { createAutoRegion } from '../../src/native/logic/auto-region';
import { createCoalescer } from '../../src/native/logic/coalesce';
import { describeRegion, formatMegabytes, formatVersionDate, orderRegions, plannedBytes } from '../../src/native/logic/region-view';
import type { RegionStatus } from '../../src/core/packs/manager';
import type { ManifestRegion } from '../../src/core/region/manifest';

const sha = 'a'.repeat(64);
const region: ManifestRegion = {
  id: '34',
  tier: 'full',
  names: { tr: 'İstanbul', en: 'Istanbul', ar: 'إسطنبول' },
  bbox: [27, 40, 30, 42],
  version: '1',
  stats: { addresses: 1, streets: 1, neighbourhoods: 1 },
  files: [
    { kind: 'address', path: '34/a', size: 13_350_000, sha256: sha },
    { kind: 'tiles', path: '34/t', size: 84_500_000, sha256: sha },
    { kind: 'buildings', path: '34/b', size: 4_400_000, sha256: sha },
  ],
};

const status = (extra: Partial<RegionStatus> = {}): RegionStatus => ({ id: '34', state: 'none', progress: null, error: null, waitingWifi: false, installedVersion: null, availableVersion: null, installedParts: [], updateBytes: null, lastUpdate: null, ...extra });

describe('formatMegabytes', () => {
  it('shows one decimal below ten megabytes and whole numbers above', () => {
    expect(formatMegabytes(0)).toBe('0');
    expect(formatMegabytes(1_500_000)).toBe('1.5');
    expect(formatMegabytes(9_940_000)).toBe('9.9');
    expect(formatMegabytes(9_960_000)).toBe('10');
    expect(formatMegabytes(12_600_000)).toBe('13');
    expect(formatMegabytes(97_850_000)).toBe('98');
  });

  it('does not break on odd numbers', () => {
    for (const bad of [Number.NaN, -5, Infinity]) expect(formatMegabytes(bad)).toBe('0');
  });
});

describe('plannedBytes', () => {
  it('adds the address and map parts and the base pack that is still missing', () => {
    expect(plannedBytes(region, status(), 12_600_000)).toBe(13_350_000 + 84_500_000 + 12_600_000);
    expect(plannedBytes(region, status(), 0)).toBe(13_350_000 + 84_500_000);
  });

  it('counts only the parts of an installed region that is being updated', () => {
    expect(plannedBytes(region, status({ state: 'update-available', installedParts: ['address'] }), 12_600_000)).toBe(13_350_000);
    expect(plannedBytes(region, status({ state: 'installed', installedParts: ['address', 'tiles', 'buildings'] }), 0)).toBe(13_350_000 + 84_500_000 + 4_400_000);
  });

  it('counts the places overlay of the region with the default parts', () => {
    const withPlaces = { ...region, files: [...region.files, { kind: 'places' as const, path: '34/p', size: 18_900_000, sha256: sha }] };
    expect(plannedBytes(withPlaces, status(), 12_600_000)).toBe(13_350_000 + 84_500_000 + 18_900_000 + 12_600_000);
  });

  it('leaves out parts the manifest does not have', () => {
    expect(plannedBytes({ ...region, files: [region.files[0] as ManifestRegion['files'][number]] }, status(), 12_600_000)).toBe(13_350_000);
  });
});

describe('describeRegion for an update', () => {
  const base = { region, baseBytes: 12_600_000, lang: 'tr' };

  it('shows what the update will really download when that is known, and the plan otherwise', () => {
    const update = { state: 'update-available' as const, installedParts: ['address' as const] };
    expect(describeRegion({ ...base, status: status({ ...update, updateBytes: 2_400_000 }) }).sizeText).toBe('2.4 MB');
    expect(describeRegion({ ...base, status: status({ ...update, updateBytes: 0 }) }).sizeText).toBe('0 MB');
    expect(describeRegion({ ...base, status: status({ ...update, updateBytes: null }) }).sizeText).toBe('13 MB');
    expect(describeRegion({ ...base, status: status({ state: 'none', updateBytes: 2_400_000 }) }).sizeText).toBe('110 MB');
  });
});

describe('describeRegion', () => {
  const base = { region, baseBytes: 12_600_000, lang: 'tr' };

  it('offers a download for a region that is not installed', () => {
    expect(describeRegion({ ...base, status: status() })).toMatchObject({ id: '34', name: 'İstanbul', sizeText: '110 MB', statusText: 'İndirilmedi', errorText: null, progressPercent: null, actions: ['download'], busy: false, rtl: false });
  });

  it('shows the name and direction of the language, falling back to English then Turkish', () => {
    expect(describeRegion({ ...base, lang: 'ar', status: status() })).toMatchObject({ name: 'إسطنبول', rtl: true });
    expect(describeRegion({ ...base, lang: 'de', status: status() }).name).toBe('Istanbul');
    expect(describeRegion({ ...base, region: { ...region, names: { tr: 'İstanbul' } }, lang: 'ru', status: status() }).name).toBe('İstanbul');
  });

  it.each([
    ['queued', ['pause'], true],
    ['downloading', ['pause'], true],
    ['verifying', [], true],
    ['paused', ['resume', 'remove'], false],
    ['installed', ['remove'], false],
    ['update-available', ['update', 'remove'], false],
    ['error', ['retry', 'remove'], false],
  ] as const)('gives the actions of %s', (state, actions, busy) => {
    expect(describeRegion({ ...base, status: status({ state, installedParts: state === 'installed' || state === 'update-available' ? ['address'] : [] }) })).toMatchObject({ actions, busy });
  });

  it('knows an action for every state', () => {
    for (const state of REGION_STATES) expect(describeRegion({ ...base, status: status({ state }) }).actions).toBeDefined();
  });

  it('shows progress as a whole percent between 0 and 100', () => {
    expect(describeRegion({ ...base, status: status({ state: 'downloading', progress: { done: 50, total: 200 } }) }).progressPercent).toBe(25);
    expect(describeRegion({ ...base, status: status({ state: 'downloading', progress: { done: 199, total: 200 } }) }).progressPercent).toBe(99);
    expect(describeRegion({ ...base, status: status({ state: 'downloading', progress: { done: 500, total: 200 } }) }).progressPercent).toBe(100);
    expect(describeRegion({ ...base, status: status({ state: 'downloading', progress: { done: 0, total: 0 } }) }).progressPercent).toBeNull();
    expect(describeRegion({ ...base, status: status({ state: 'downloading', progress: { done: -3, total: 100 } }) }).progressPercent).toBe(0);
  });

  it('says it waits for Wi-Fi and offers mobile data', () => {
    const row = describeRegion({ ...base, status: status({ state: 'queued', waitingWifi: true }) });
    expect(row.statusText).toBe('Wi-Fi bekleniyor');
    expect(row.actions).toEqual(['pause', 'cellular']);
  });

  it('explains an error in the language of the person', () => {
    const row = describeRegion({ ...base, lang: 'en', status: status({ state: 'error', error: { code: 'no-space', message: 'x' } }) });
    expect(row.errorText).toBe('Not enough free space on the phone.');
    expect(row.statusText).toBe('Error');
  });

  it('shows the installed size when installed', () => {
    const row = describeRegion({ ...base, status: status({ state: 'installed', installedParts: ['address', 'tiles'] }) });
    expect(row.sizeText).toBe('Kurulu: 98 MB');
  });
});

describe('orderRegions', () => {
  it('puts what is installed or in motion first, then the rest by plate', () => {
    const make = (id: string): ManifestRegion => ({ ...region, id });
    const states: Record<string, RegionStatus['state']> = { '06': 'none', '10': 'installed', '34': 'downloading', '35': 'none', '41': 'update-available', '58': 'error' };
    const ordered = orderRegions(Object.keys(states).map(make), (id) => status({ id, state: states[id] as RegionStatus['state'] }));
    expect(ordered.map((r) => r.id)).toEqual(['10', '34', '41', '58', '06', '35']);
  });
});

describe('nextAttribution', () => {
  it('collapses when the map is used and opens again on a tap', () => {
    expect(nextAttribution('expanded', 'interact')).toBe('collapsed');
    expect(nextAttribution('collapsed', 'interact')).toBe('collapsed');
    expect(nextAttribution('collapsed', 'toggle')).toBe('expanded');
    expect(nextAttribution('expanded', 'toggle')).toBe('collapsed');
    expect(nextAttribution('collapsed', 'show')).toBe('expanded');
    expect(nextAttribution('expanded', 'show')).toBe('expanded');
  });
});

describe('createCoalescer', () => {
  function timers() {
    let now = 0;
    const queue: { at: number; run: () => void; id: number }[] = [];
    let id = 0;
    return {
      now: () => now,
      set: (run: () => void, ms: number) => {
        queue.push({ at: now + ms, run, id: ++id });
        return id;
      },
      clear: (handle: number) => {
        const at = queue.findIndex((q) => q.id === handle);
        if (at >= 0) queue.splice(at, 1);
      },
      advance(ms: number) {
        now += ms;
        for (const due of queue.filter((q) => q.at <= now).sort((a, b) => a.at - b.at)) {
          queue.splice(queue.indexOf(due), 1);
          due.run();
        }
      },
      pending: () => queue.length,
    };
  }

  it('runs at once for the first call and then at most once per interval, with a final run', () => {
    const t = timers();
    let runs = 0;
    const coalesce = createCoalescer(() => void (runs += 1), 200, t);
    coalesce.notify();
    expect(runs).toBe(1);
    for (let i = 0; i < 50; i++) coalesce.notify();
    expect(runs).toBe(1);
    t.advance(199);
    expect(runs).toBe(1);
    t.advance(1);
    expect(runs).toBe(2);
    t.advance(1000);
    expect(runs).toBe(2);
    expect(t.pending()).toBe(0);
  });

  it('runs a single call after a quiet spell at once', () => {
    const t = timers();
    let runs = 0;
    const coalesce = createCoalescer(() => void (runs += 1), 200, t);
    coalesce.notify();
    t.advance(5_000);
    coalesce.notify();
    expect(runs).toBe(2);
  });

  it('can be stopped without a late run', () => {
    const t = timers();
    let runs = 0;
    const coalesce = createCoalescer(() => void (runs += 1), 200, t);
    coalesce.notify();
    coalesce.notify();
    coalesce.stop();
    t.advance(1_000);
    expect(runs).toBe(1);
    expect(t.pending()).toBe(0);
  });

  it('never loses the last notification, whatever the timing', () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 500 }), { minLength: 1, maxLength: 40 }), (gaps) => {
        const t = timers();
        let seen = -1;
        let latest = -1;
        const coalesce = createCoalescer(() => void (seen = latest), 200, t);
        gaps.forEach((gap, i) => {
          t.advance(gap);
          latest = i;
          coalesce.notify();
        });
        t.advance(1_000);
        expect(seen).toBe(latest);
      }),
    );
  });
});

describe('createAutoRegion', () => {
  const decision = (action: 'none' | 'suggest' | 'download' | 'consent', regions: string[] = [], neighbours: string[] = []) => ({ action, regions, neighbours });

  function rig(first: ReturnType<typeof decision>) {
    let current = first;
    let time = 0;
    const started: string[] = [];
    let failing = false;
    const auto = createAutoRegion({
      suggest: () => current,
      download: async (id) => {
        started.push(id);
        if (failing) throw new Error('offline');
      },
      now: () => time,
      retryMs: 60_000,
    });
    return {
      auto,
      started,
      set: (next: ReturnType<typeof decision>) => void (current = next),
      advance: (ms: number) => void (time += ms),
      fail: (value: boolean) => void (failing = value),
    };
  }

  it('starts the download of the province once and tells the caller what it saw', async () => {
    const r = rig(decision('download', ['34'], ['41']));
    expect(await r.auto.update([28.9, 41])).toEqual({ decision: decision('download', ['34'], ['41']), started: ['34'] });
    expect(await r.auto.update([28.9, 41])).toEqual({ decision: decision('download', ['34'], ['41']), started: [] });
    expect(r.started).toEqual(['34']);
  });

  it('waits for the person on a consent decision and starts once it turns into a download', async () => {
    const r = rig(decision('consent', ['34']));
    expect(await r.auto.update([28.9, 41])).toEqual({ decision: decision('consent', ['34']), started: [] });
    expect(r.started).toEqual([]);
    r.set(decision('download', ['34']));
    expect((await r.auto.update([28.9, 41])).started).toEqual(['34']);
  });

  it('accepts a suggestion that arrives asynchronously', async () => {
    let started = 0;
    const auto = createAutoRegion({
      suggest: async () => decision('download', ['34']),
      download: async () => void (started += 1),
      now: () => 0,
      retryMs: 60_000,
    });
    expect((await auto.update([28.9, 41])).started).toEqual(['34']);
    expect(started).toBe(1);
  });

  it('only reports a suggestion without downloading anything', async () => {
    const r = rig(decision('suggest', ['34']));
    expect((await r.auto.update([28.9, 41])).started).toEqual([]);
    expect(r.started).toEqual([]);
  });

  it('does nothing without a location', async () => {
    const r = rig(decision('download', ['34']));
    expect(await r.auto.update(null)).toEqual({ decision: decision('none'), started: [] });
    expect(r.started).toEqual([]);
  });

  it('starts another province when the person moves there', async () => {
    const r = rig(decision('download', ['34']));
    await r.auto.update([28.9, 41]);
    r.set(decision('download', ['06']));
    expect((await r.auto.update([32.8, 39.9])).started).toEqual(['06']);
  });

  it('does not start again a download the person cancelled', async () => {
    let time = 0;
    const started: string[] = [];
    const auto = createAutoRegion({
      suggest: () => decision('download', ['34']),
      download: async (id) => {
        started.push(id);
        throw Object.assign(new Error('cancelled'), { code: 'cancelled' });
      },
      now: () => time,
      retryMs: 60_000,
    });
    await auto.update([28.9, 41]);
    await Promise.resolve();
    time += 61_000;
    expect((await auto.update([28.9, 41])).started).toEqual([]);
    expect(started).toEqual(['34']);
    auto.reset();
    expect((await auto.update([28.9, 41])).started).toEqual(['34']);
  });

  it('retries a failed download only after the pause', async () => {
    const r = rig(decision('download', ['34']));
    r.fail(true);
    expect((await r.auto.update([28.9, 41])).started).toEqual(['34']);
    r.advance(30_000);
    expect((await r.auto.update([28.9, 41])).started).toEqual([]);
    r.advance(30_000);
    r.fail(false);
    expect((await r.auto.update([28.9, 41])).started).toEqual(['34']);
    r.advance(1_000_000);
    expect((await r.auto.update([28.9, 41])).started).toEqual([]);
  });

  it('forgets what it started when told to, so a new session can try again', async () => {
    const r = rig(decision('download', ['34']));
    await r.auto.update([28.9, 41]);
    r.auto.reset();
    expect((await r.auto.update([28.9, 41])).started).toEqual(['34']);
  });
});

describe('storage rows: last update and waiting for approval', () => {
  const base = { region, baseBytes: 0, lang: 'tr' };

  it('writes the data date of an installed region in the language asked for', () => {
    expect(describeRegion({ ...base, status: status({ state: 'installed', installedVersion: '20261028.20261030', installedParts: ['address'] }) }).updatedText).toBe('Güncelleme: 28.10.2026');
    expect(describeRegion({ ...base, lang: 'en', status: status({ state: 'installed', installedVersion: '20261028.20261030' }) }).updatedText).toBe('Updated: 2026-10-28');
    expect(describeRegion({ ...base, lang: 'de', status: status({ state: 'installed', installedVersion: '20261028' }) }).updatedText).toBe('Aktualisiert: 28.10.2026');
  });

  it('has no date for a region that is not installed or has an odd version', () => {
    expect(describeRegion({ ...base, status: status() }).updatedText).toBeNull();
    expect(formatVersionDate('abc', 'tr')).toBeNull();
    expect(formatVersionDate('20261340.1', 'tr')).toBeNull();
    expect(formatVersionDate('20260032', 'tr')).toBeNull();
    expect(formatVersionDate(null, 'tr')).toBeNull();
    expect(formatVersionDate(undefined, 'tr')).toBeNull();
  });

  it('says it is waiting for Wi-Fi, and for the mobile data approval when that is what holds it', () => {
    expect(describeRegion({ ...base, status: status({ state: 'queued', waitingWifi: true }) }).statusText).toBe('Wi-Fi bekleniyor');
    const consent = describeRegion({ ...base, consentPending: true, status: status() });
    expect(consent.statusText).toBe('Mobil veri onayı bekleniyor');
    expect(describeRegion({ ...base, lang: 'en', consentPending: true, status: status() }).statusText).toBe('Waiting for your mobile data approval');
  });
});
