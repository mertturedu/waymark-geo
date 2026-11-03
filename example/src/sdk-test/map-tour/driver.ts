import { jumpTilted } from '../../../../src/native/map/camera';

export type Look = { theme: 'light' | 'dark'; lang: string; bare?: boolean; hide?: string[]; window?: boolean; font?: 'inter' | 'noto' };
export type LngLat = [number, number];
export type MapFeature = { properties: Record<string, unknown> | null; geometry: { type: string; coordinates?: unknown } };
export type View = { center: LngLat; zoom: number; bearing?: number; pitch?: number };
export type Car = { point: LngLat; heading: number } | null;
export type Frame = 'full' | 'landscape' | 'half' | 'square';

export type MapHandle<P = unknown> = {
  frames(): number;
  events(): string[];
  size(): { width: number; height: number };
  layerIds(prefix: string): string[];
  fly(view: View, duration: number): void;
  jump(view: View): void;
  view(): Promise<View>;
  query(layers?: string[]): Promise<MapFeature[]>;
  project(point: LngLat): Promise<[number, number]>;
  unproject(pixel: [number, number]): Promise<LngLat>;
  plan(): P;
  locate?: { press(): Promise<void>; stop(): void; state(): { mode: string; permission: string } };
};

type State = { geo: unknown; look: Look; status: string; mounted: number; frame: Frame; car: Car };

let state: State = { geo: null, look: { theme: 'light', lang: 'tr' }, status: '', mounted: 0, frame: 'full', car: null };
let handle: MapHandle<never> | null = null;
const listeners = new Set<() => void>();

const emit = (): void => listeners.forEach((listener) => listener());
const set = (next: Partial<State>): void => {
  state = { ...state, ...next };
  emit();
};

export const tourState = (): State => state;
export const subscribeTour = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
export const attachHandle = <P>(next: MapHandle<P> | null): void => {
  handle = next as MapHandle<never> | null;
  if (next) set({ mounted: state.mounted + 1 });
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function until(check: () => boolean, ms: number, what: string): Promise<void> {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > ms) throw new Error(`zaman aşımı: ${what} (${ms} ms)`);
    await sleep(25);
  }
}

export type Gap = { maxGapMs: number; ticks: number };

export type Tour<G = unknown, P = unknown> = {
  geo: G;
  say(text: string): void;
  events(): string[];
  ready(): Promise<number>;
  go(view: View, how: 'fly' | 'jump', duration?: number): Promise<number>;
  look(next: Partial<Look>): Promise<number>;
  frame(next: Frame): Promise<number>;
  car(point: LngLat | null, heading?: number): void;
  step(view: View): Promise<void>;
  view(): Promise<View>;
  size(): { width: number; height: number };
  query(prefixes?: string[]): Promise<MapFeature[]>;
  until(prefixes: string[], min: number, ms: number): Promise<{ count: number; waitedMs: number }>;
  layers(prefix: string): string[];
  project(point: LngLat): Promise<[number, number]>;
  unproject(pixel: [number, number]): Promise<LngLat>;
  plan(): P;
  gaps<T>(work: () => Promise<T>): Promise<{ value: T } & Gap>;
  frames(): number;
  locatePress(): Promise<void>;
  locateStop(): void;
  locateState(): { mode: string; permission: string };
  rendered(since: number, ms?: number): Promise<number>;
  jumpSafe(view: View): Promise<View>;
  styleLoads(): number;
  close(): void;
};

const SETTLE_MS = 15000;

function live(): MapHandle<never> {
  if (!handle) throw new Error('harita açık değil');
  return handle;
}

export async function openTour<G, P = unknown>(geo: G, look: Look = { theme: 'light', lang: 'tr' }): Promise<Tour<G, P>> {
  handle = null;
  set({ geo, look, status: 'Harita turu başlıyor', mounted: state.mounted, frame: 'full', car: null });
  const mountedAt = state.mounted;

  const turn = (a: number, b: number): number => Math.abs((((a - b) % 360) + 540) % 360 - 180);

  const arrived = (now: View, target: View): boolean =>
    Math.abs(now.zoom - target.zoom) < 0.06 &&
    Math.abs(now.center[0] - target.center[0]) < 3e-4 &&
    Math.abs(now.center[1] - target.center[1]) < 3e-4 &&
    (target.bearing === undefined || turn(now.bearing ?? 0, target.bearing) < 1.5) &&
    (target.pitch === undefined || Math.abs((now.pitch ?? 0) - target.pitch) < 1.5);

  const SETTLE_PREFIXES = ['roads_', 'buildings@', 'earth@', 'places_'];

  const viewWhenReady = async (): Promise<View> => {
    const started = Date.now();
    for (;;) {
      try {
        return await live().view();
      } catch (error) {
        if (Date.now() - started > SETTLE_MS) throw error;
        await sleep(100);
      }
    }
  };

  const reach = async (target: View, after = 800): Promise<void> => {
    const started = Date.now();
    let resent = started;
    while (!arrived(await viewWhenReady(), target)) {
      const now = Date.now();
      if (now - started > SETTLE_MS) {
        const at = await viewWhenReady();
        throw new Error(`zaman aşımı: hedefe varılamadı (istenen zoom ${target.zoom} yön ${target.bearing ?? '-'} eğim ${target.pitch ?? '-'}; gelen zoom ${at.zoom.toFixed(2)} yön ${(at.bearing ?? 0).toFixed(1)} eğim ${(at.pitch ?? 0).toFixed(1)} merkez ${at.center[0].toFixed(5)},${at.center[1].toFixed(5)}; istenen merkez ${target.center[0].toFixed(5)},${target.center[1].toFixed(5)})`);
      }
      if (now - started > after && now - resent > 1000) {
        resent = now;
        live().jump(target);
      }
      await sleep(100);
    }
  };

  const quiet = async (): Promise<void> => {
    const started = Date.now();
    const reads: number[] = [];
    while (Date.now() - started < SETTLE_MS) {
      const h = live();
      const ids = SETTLE_PREFIXES.flatMap((prefix) => h.layerIds(prefix));
      reads.push((await h.query(ids)).length);
      const last = reads.slice(-3);
      if (last.length === 3 && last[0]! > 0 && last.every((n) => n === last[0])) return;
      await sleep(250);
    }
  };

  return {
    geo,
    say: (text) => set({ status: text }),
    events: () => (handle ? live().events() : []),
    async ready() {
      const started = Date.now();
      await until(() => state.mounted > mountedAt && handle !== null, SETTLE_MS, 'harita açılmadı');
      await until(() => live().frames() > 0, SETTLE_MS, 'ilk kare çizilmedi');
      return Date.now() - started;
    },
    async go(view, how, duration = 1800) {
      const started = Date.now();
      const h = live();
      if (!arrived(await h.view(), view)) {
        if (how === 'fly') h.fly(view, duration);
        else await jumpTilted({ jumpTo: (next) => h.jump(next) }, view, () => h.view(), 400);
        await reach(view, how === 'fly' ? duration + 1500 : 800);
      }
      await quiet();
      return Date.now() - started;
    },
    async look(next) {
      const merged = { ...state.look, ...next };
      if (merged.theme === state.look.theme && merged.lang === state.look.lang && Boolean(merged.bare) === Boolean(state.look.bare) && Boolean(merged.window) === Boolean(state.look.window) && merged.font === state.look.font && (merged.hide ?? []).join(',') === (state.look.hide ?? []).join(',')) return 0;
      const started = Date.now();
      const before = state.mounted;
      const view = await live().view();
      handle = null;
      set({ look: merged });
      await until(() => state.mounted > before && handle !== null, SETTLE_MS, 'harita yeniden açılmadı');
      await viewWhenReady();
      live().jump(view);
      await reach(view);
      await quiet();
      return Date.now() - started;
    },
    car(point, heading = 0) {
      set({ car: point ? { point, heading } : null });
    },
    async step(view) {
      live().jump(view);
      await sleep(0);
    },
    async frame(next) {
      if (next === state.frame) return 0;
      const started = Date.now();
      const view = await live().view();
      set({ frame: next });
      await sleep(400);
      await viewWhenReady();
      live().jump(view);
      await reach(view);
      await quiet();
      return Date.now() - started;
    },
    async until(prefixes, min, ms) {
      const started = Date.now();
      let count = 0;
      for (;;) {
        const h = live();
        const ids = prefixes.flatMap((prefix) => h.layerIds(prefix));
        count = ids.length === 0 ? 0 : (await h.query(ids)).length;
        if (count >= min || Date.now() - started >= ms) return { count, waitedMs: Date.now() - started };
        await sleep(250);
      }
    },
    view: () => live().view(),
    size: () => live().size(),
    async query(prefixes) {
      const h = live();
      const ids = prefixes ? prefixes.flatMap((prefix) => h.layerIds(prefix)) : undefined;
      if (ids && ids.length === 0) return [];
      return h.query(ids);
    },
    layers: (prefix) => live().layerIds(prefix),
    project: (point) => live().project(point),
    unproject: (pixel) => live().unproject(pixel),
    plan: () => live().plan() as unknown as P,
    async gaps(work) {
      let last = Date.now();
      let maxGapMs = 0;
      let ticks = 0;
      const timer = setInterval(() => {
        const now = Date.now();
        maxGapMs = Math.max(maxGapMs, now - last);
        last = now;
        ticks += 1;
      }, 16);
      try {
        const value = await work();
        return { value, maxGapMs, ticks };
      } finally {
        clearInterval(timer);
      }
    },
    frames: () => (handle ? live().frames() : 0),
    locatePress: () => (live().locate ? live().locate!.press() : Promise.reject(new Error('konum düğmesi bu haritada yok'))),
    locateStop: () => void live().locate?.stop(),
    locateState: () => (live().locate ? live().locate!.state() : { mode: 'yok', permission: 'yok' }),
    async jumpSafe(view) {
      const h = live();
      await jumpTilted({ jumpTo: (next) => h.jump(next) }, view, () => h.view(), 400);
      return viewWhenReady();
    },
    styleLoads() {
      const events = handle ? live().events() : [];
      const mount = events.map((event) => event.startsWith('mount:')).lastIndexOf(true);
      return events.slice(mount + 1).filter((event) => event.startsWith('style@')).length;
    },
    async rendered(since, ms = SETTLE_MS) {
      const started = Date.now();
      await until(() => handle !== null && live().frames() > since, ms, 'tam kare çizilmedi');
      return Date.now() - started;
    },
    close() {
      handle = null;
      set({ geo: null, status: '', frame: 'full', car: null });
    },
  };
}
