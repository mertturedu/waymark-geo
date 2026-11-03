import type { Manifest, ManifestFile, ManifestRegion } from '../region/manifest';
import { step, type RegionEvent, type RegionState } from './machine';
import { downloadFile } from './download';
import type { ClockPort, ConnectionKind, ConnectivityPort, DecodePort, FsPort, HashPort, NetPort } from './ports';
import { PART_KINDS, emptyState, loadState, saveState, type InstalledFile, type PackState, type PartKind, type RegionRecord } from './state-file';
import { isPackError, packError, type PackError, type PackErrorCode } from './types';
import { diffManifest, inspectManifest, verifyManifest, type ManifestDiff } from './verify';

export type PackEnv = { fs: FsPort; net: NetPort; hash: HashPort; clock: ClockPort; connectivity: ConnectivityPort; decode?: DecodePort };
export type PackConfig = { manifestUrl: string; publicKeys: string[]; sdkVersion: string; autoDownload?: 'ask' | 'wifi' | 'always' | 'never' };

export type RegionStatus = {
  id: string;
  state: RegionState;
  progress: { done: number; total: number } | null;
  error: { code: PackErrorCode; message: string } | null;
  waitingWifi: boolean;
  installedVersion: string | null;
  availableVersion: string | null;
  installedParts: PartKind[];
};

export type CheckResult = { ok: true; updates: string[]; diff: ManifestDiff | null; skipped?: true } | { ok: false; code: PackErrorCode };

export type CheckOptions = { minIntervalMs?: number };

export type DownloadOptions = { parts?: PartKind[]; allowCellular?: boolean; wifiOnly?: boolean; onProgress?: (done: number, total: number) => void };

export type PackManager = {
  manifest(): Manifest | null;
  regions(): ManifestRegion[];
  status(id: string): RegionStatus;
  installedRegions(): string[];
  missingBaseBytes(): number;
  downloadBytes(id: string, parts?: PartKind[]): number;
  connection(): Promise<ConnectionKind>;
  onConnection(listener: (kind: ConnectionKind) => void): () => void;
  checkUpdates(options?: CheckOptions): Promise<CheckResult>;
  download(id: string, options?: DownloadOptions): Promise<void>;
  pause(id: string): Promise<void>;
  resume(id: string): Promise<void>;
  remove(id: string, parts?: PartKind[]): Promise<void>;
  installedFile(id: string, kind: PartKind): string | null;
  baseDir(): string | null;
  dismiss(id: string): Promise<void>;
  dismissed(): string[];
  subscribe(listener: () => void): () => void;
  beforeDelete(listener: (paths: string[]) => Promise<void>): () => void;
  idle(): Promise<void>;
};

const MANIFEST_PATH = 'manifest-v1.json';
const SIGNATURE_PATH = 'manifest-v1.json.sig';
const DEFAULT_PARTS: PartKind[] = ['address', 'tiles', 'places', 'directory'];

type Mutable = { state: RegionState; progress: { done: number; total: number } | null; error: { code: PackErrorCode; message: string } | null; waitingWifi: boolean };

type Job = {
  id: string;
  parts: PartKind[];
  allowCellular: boolean;
  wifiOnly: boolean;
  onProgress: DownloadOptions['onProgress'];
  controller: AbortController;
  intent: 'pause' | 'remove' | null;
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
  settled: Promise<void>;
  settle: () => void;
  placed: string[];
};

const finalPath = (path: string): string => `files/${path}`;
const partPath = (path: string): string => `.part/${path.replace(/\//g, '__')}`;
const encodedPaths = (file: ManifestFile): string[] => (file.encoded ? [finalPath(file.encoded.path), partPath(file.encoded.path)] : []);
const noop = (): void => undefined;

export async function createPackManager(env: PackEnv, config: PackConfig): Promise<PackManager> {
  const { fs, net, hash, clock, connectivity } = env;
  const baseUrl = config.manifestUrl.slice(0, config.manifestUrl.lastIndexOf('/'));
  const urlOf = (path: string): string => `${baseUrl}/${path.split('/').map(encodeURIComponent).join('/')}`;

  const loaded = await loadState(fs);
  let state: PackState = loaded.state;
  let current: { manifest: Manifest; text: string } | null = null;
  const statuses = new Map<string, Mutable>();
  const jobs = new Map<string, Job>();
  const queue: Job[] = [];
  let active: Job | null = null;
  const listeners = new Set<() => void>();
  const deleteHooks = new Set<(paths: string[]) => Promise<void>>();
  let idleWaiters: (() => void)[] = [];
  let saving: Promise<void> = Promise.resolve();

  const emit = (): void => {
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch {
        continue;
      }
    }
  };

  const persist = (): Promise<void> => {
    const snapshot = state;
    saving = saving.catch(noop).then(() => saveState(fs, snapshot));
    return saving;
  };

  const regionOf = (id: string): ManifestRegion | undefined => current?.manifest.regions.find((r) => r.id === id);
  const fileOfKind = (region: ManifestRegion, kind: PartKind): ManifestFile | undefined => region.files.find((f) => f.kind === kind);

  const outdated = (id: string): boolean => {
    const record = state.regions[id];
    const region = regionOf(id);
    if (!record || !region) return false;
    return PART_KINDS.some((kind) => {
      const have = record.files[kind];
      const want = fileOfKind(region, kind);
      return have !== undefined && want !== undefined && have.sha256 !== want.sha256;
    });
  };

  const hasParts = (id: string): boolean => PART_KINDS.some((kind) => state.regions[id]?.files[kind] !== undefined);

  const ensure = (id: string): Mutable => {
    let entry = statuses.get(id);
    if (!entry) {
      const initial: RegionState = state.pending[id] ? 'paused' : hasParts(id) ? (outdated(id) ? 'update-available' : 'installed') : 'none';
      entry = { state: initial, progress: null, error: null, waitingWifi: false };
      statuses.set(id, entry);
    }
    return entry;
  };

  const transition = (id: string, event: RegionEvent): boolean => {
    const entry = ensure(id);
    const result = step(entry.state, event);
    if (!result.ok) return false;
    entry.state = result.state;
    emit();
    return true;
  };

  const sweepMissing = async (): Promise<boolean> => {
    let changed = false;
    for (const [id, record] of Object.entries(state.regions)) {
      for (const kind of PART_KINDS) {
        const file = record.files[kind];
        if (file && (await fs.size(finalPath(file.path))) !== file.size) {
          delete record.files[kind];
          changed = true;
        }
      }
      if (!hasParts(id)) {
        delete state.regions[id];
        changed = true;
      }
    }
    if (state.base) {
      for (const file of state.base.files) {
        if ((await fs.size(finalPath(file.path))) !== file.size) {
          state = { ...state, base: null };
          changed = true;
          break;
        }
      }
    }
    return changed;
  };

  const wantedPaths = (): Set<string> => {
    const wanted = new Set<string>();
    for (const record of Object.values(state.regions)) for (const file of Object.values(record.files)) wanted.add(finalPath(file.path));
    for (const file of state.base?.files ?? []) wanted.add(finalPath(file.path));
    return wanted;
  };

  const manifestPaths = (): Set<string> => {
    const paths = new Set<string>();
    if (!current) return paths;
    const installed = wantedPaths();
    const add = (file: ManifestFile): void => {
      paths.add(finalPath(file.path));
      if (file.encoded && !installed.has(finalPath(file.path))) paths.add(finalPath(file.encoded.path));
    };
    for (const file of current.manifest.base) add(file);
    for (const region of current.manifest.regions) for (const file of region.files) add(file);
    return paths;
  };

  const sweepOrphans = async (): Promise<void> => {
    const wanted = wantedPaths();
    const keep = manifestPaths();
    for (const path of await fs.list('files')) if (!wanted.has(path) && !keep.has(path)) await fs.remove(path);
    if (!current) return;
    const keepParts = new Set<string>();
    for (const path of keep) keepParts.add(partPath(path.slice('files/'.length)));
    for (const path of await fs.list('.part')) if (!keepParts.has(path)) await fs.remove(path);
  };

  const readStoredManifest = async (): Promise<void> => {
    const text = await fs.readText(MANIFEST_PATH);
    const signature = await fs.readText(SIGNATURE_PATH);
    if (text === null || signature === null) return;
    const sameKeys = state.checked !== null && state.checked.keys.length === config.publicKeys.length && state.checked.keys.every((key, index) => key === config.publicKeys[index]);
    const unchanged = sameKeys && (await hash.sha256File(MANIFEST_PATH)) === state.checked?.manifest && (await hash.sha256File(SIGNATURE_PATH)) === state.checked?.signature;
    const result = unchanged ? inspectManifest(text, config.sdkVersion) : verifyManifest({ text, signature, publicKeys: config.publicKeys, sdkVersion: config.sdkVersion });
    if (result.ok) current = { manifest: result.manifest, text };
  };

  await readStoredManifest();
  let dirty = await sweepMissing();
  for (const id of Object.keys(state.pending)) if (!regionOf(id) && current) {
    delete state.pending[id];
    dirty = true;
  }
  if (dirty) await persist();
  if (loaded.trusted) await sweepOrphans();

  const checkIdle = (): void => {
    if (active === null && queue.length === 0) {
      const waiters = idleWaiters;
      idleWaiters = [];
      for (const wake of waiters) wake();
    }
  };

  const setPending = async (id: string, parts: PartKind[] | null): Promise<void> => {
    const pending = { ...state.pending };
    if (parts) pending[id] = { parts };
    else delete pending[id];
    state = { ...state, pending };
    await persist();
  };

  const waitForWifi = async (job: Job): Promise<void> => {
    const blocked = async (): Promise<boolean> => (config.autoDownload === 'wifi' || job.wifiOnly) && !job.allowCellular && (await connectivity.kind()) === 'cellular';
    const entry = ensure(job.id);
    while (!job.controller.signal.aborted && (await blocked())) {
      entry.waitingWifi = true;
      emit();
      await new Promise<void>((resolve) => {
        let off: (() => void) | undefined;
        const done = (): void => {
          off?.();
          resolve();
        };
        job.controller.signal.addEventListener('abort', done, { once: true });
        if (connectivity.onChange) off = connectivity.onChange(done);
        else void clock.sleep(10_000).then(done);
      });
    }
    entry.waitingWifi = false;
  };

  type PlanItem = { file: ManifestFile; installed: boolean; build: string; version: string };

  const planFor = (job: Job): PlanItem[] => {
    const manifest = (current as { manifest: Manifest }).manifest;
    const region = regionOf(job.id) as ManifestRegion;
    const plan: PlanItem[] = [];
    const build = manifest.tiles.build;
    if (job.parts.includes('tiles')) {
      for (const file of manifest.base) {
        const have = state.base?.files.find((f) => f.path === file.path);
        plan.push({ file, installed: have?.sha256 === file.sha256, build, version: region.version });
      }
    }
    for (const kind of job.parts) {
      const file = fileOfKind(region, kind) as ManifestFile;
      const have = state.regions[job.id]?.files[kind];
      plan.push({ file, installed: have?.sha256 === file.sha256, build, version: region.version });
    }
    return plan;
  };

  const runDeleteHooks = async (paths: string[]): Promise<void> => {
    if (paths.length === 0) return;
    for (const hook of [...deleteHooks]) {
      try {
        await hook(paths);
      } catch {
        continue;
      }
    }
  };

  const commit = async (job: Job, plan: PlanItem[]): Promise<void> => {
    const manifest = (current as { manifest: Manifest }).manifest;
    const region = regionOf(job.id) as ManifestRegion;
    const previous = state.regions[job.id];
    const files: RegionRecord['files'] = { ...(previous?.files ?? {}) };
    const superseded: string[] = [];
    for (const kind of job.parts) {
      const file = (plan.find((p) => p.file.kind === kind)?.file ?? fileOfKind(region, kind)) as ManifestFile;
      const old = files[kind];
      if (old && old.path !== file.path) superseded.push(finalPath(old.path));
      files[kind] = { path: file.path, size: file.size, sha256: file.sha256 };
    }
    const allCurrent = PART_KINDS.every((kind) => {
      const have = files[kind];
      const want = fileOfKind(region, kind);
      return have === undefined || want === undefined || have.sha256 === want.sha256;
    });
    const record: RegionRecord = { version: allCurrent ? region.version : (previous?.version ?? plan[0]?.version ?? region.version), files };
    let base = state.base;
    if (job.parts.includes('tiles')) {
      const baseFiles: InstalledFile[] = plan.filter((p) => p.file.kind === 'base').map((p) => ({ path: p.file.path, size: p.file.size, sha256: p.file.sha256 }));
      for (const old of state.base?.files ?? []) if (!baseFiles.some((f) => f.path === old.path)) superseded.push(finalPath(old.path));
      base = { build: plan.find((p) => p.file.kind === 'base')?.build ?? manifest.tiles.build, files: baseFiles };
    }
    const pending = { ...state.pending };
    delete pending[job.id];
    state = { ...state, regions: { ...state.regions, [job.id]: record }, base, pending };
    await persist();
    await runDeleteHooks(superseded);
    for (const path of superseded) await fs.remove(path);
  };

  const finishJob = (job: Job): void => {
    jobs.delete(job.id);
    job.settle();
  };

  type Outcome = { ok: true } | { ok: false; error: unknown };

  const runJob = async (job: Job): Promise<Outcome> => {
    const entry = ensure(job.id);
    try {
      await waitForWifi(job);
      if (job.controller.signal.aborted) throw packError('cancelled');
      transition(job.id, 'start');
      const plan = planFor(job);
      const pendingFiles = plan.filter((p) => !p.installed);
      const total = pendingFiles.reduce((sum, p) => sum + p.file.size, 0);
      let finished = 0;
      const report = (done: number): void => {
        entry.progress = { done, total };
        emit();
        job.onProgress?.(done, total);
      };
      entry.progress = { done: 0, total };
      emit();
      for (let index = 0; index < pendingFiles.length; index++) {
        const { file } = pendingFiles[index] as { file: ManifestFile };
        const last = index === pendingFiles.length - 1;
        const target = finalPath(file.path);
        const existed = await fs.exists(target);
        await downloadFile({
          fs,
          net,
          hash,
          clock,
          url: urlOf(file.path),
          partPath: partPath(file.path),
          finalPath: target,
          size: file.size,
          sha256: file.sha256,
          ...(file.blocks ? { blocks: file.blocks } : {}),
          ...(file.encoded && env.decode ? { encoded: { url: urlOf(file.encoded.path), partPath: partPath(file.encoded.path), finalPath: finalPath(file.encoded.path), size: file.encoded.size, sha256: file.encoded.sha256 }, decode: env.decode } : {}),
          signal: job.controller.signal,
          onProgress: (done) => report(finished + done),
          ...(last ? { onVerify: () => void transition(job.id, 'verify') } : {}),
        });
        if (!existed) job.placed.push(target);
        finished += file.size;
        report(finished);
      }
      transition(job.id, 'verify');
      await commit(job, plan);
      entry.progress = null;
      entry.error = null;
      transition(job.id, 'complete');
      if (outdated(job.id)) transition(job.id, 'update-found');
      return { ok: true };
    } catch (caught) {
      const error: PackError = isPackError(caught) ? caught : packError('storage', caught instanceof Error ? caught.message : String(caught));
      entry.progress = null;
      entry.waitingWifi = false;
      if (job.intent === 'pause') {
        transition(job.id, 'pause');
        return { ok: false, error: packError('cancelled') };
      }
      if (job.intent === 'remove') return { ok: false, error: packError('cancelled') };
      {
        if (error.code === 'no-space') {
          const keep = wantedPaths();
          for (const path of job.placed) if (!keep.has(path)) await fs.remove(path);
        }
        entry.error = { code: error.code, message: error.message };
        transition(job.id, 'fail');
        try {
          await setPending(job.id, null);
        } catch {
          noop();
        }
        return { ok: false, error };
      }
    }
  };

  const pump = async (): Promise<void> => {
    if (active) return;
    const job = queue.shift();
    if (!job) {
      checkIdle();
      return;
    }
    active = job;
    let outcome: Outcome = { ok: false, error: packError('storage') };
    try {
      outcome = await runJob(job);
    } finally {
      active = null;
      finishJob(job);
      if (outcome.ok) job.resolve();
      else job.reject(outcome.error);
      void pump();
    }
  };

  const makeJob = (id: string, parts: PartKind[], options: DownloadOptions): Job => {
    let resolve: () => void = noop;
    let reject: (error: unknown) => void = noop;
    const promise = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    promise.catch(noop);
    let settle: () => void = noop;
    const settled = new Promise<void>((res) => {
      settle = res;
    });
    return { id, parts, allowCellular: options.allowCellular ?? false, wifiOnly: options.wifiOnly ?? false, onProgress: options.onProgress, controller: new AbortController(), intent: null, promise, resolve, reject, settled, settle, placed: [] };
  };

  const enqueue = (job: Job): void => {
    jobs.set(job.id, job);
    queue.push(job);
    void pump();
  };

  const fetchManifest = async (options: CheckOptions = {}): Promise<CheckResult> => {
    if (options.minIntervalMs !== undefined && state.checkedAt !== undefined && clock.now() - state.checkedAt < options.minIntervalMs) {
      return { ok: true, updates: Object.keys(state.regions).filter((id) => outdated(id)).sort(), diff: null, skipped: true };
    }
    let body: { status: number; text: string };
    let signature: { status: number; text: string };
    try {
      body = await net.getText(config.manifestUrl);
      if (body.status === 200) signature = await net.getText(`${config.manifestUrl}.sig`);
      else signature = { status: 200, text: '' };
    } catch {
      return { ok: false, code: 'network' };
    }
    for (const part of [body, signature]) {
      if (part.status === 404) return { ok: false, code: 'http-404' };
      if (part.status !== 200) return { ok: false, code: 'http' };
    }
    const result = verifyManifest({ text: body.text, signature: signature.text, publicKeys: config.publicKeys, sdkVersion: config.sdkVersion });
    if (!result.ok) return { ok: false, code: result.code };
    try {
      await fs.writeAtomic(SIGNATURE_PATH, signature.text);
      await fs.writeAtomic(MANIFEST_PATH, body.text);
    } catch (error) {
      return { ok: false, code: isPackError(error) ? error.code : 'storage' };
    }
    const previous = current?.manifest ?? null;
    current = { manifest: result.manifest, text: body.text };
    try {
      state = { ...state, checkedAt: clock.now(), checked: { manifest: await hash.sha256File(MANIFEST_PATH), signature: await hash.sha256File(SIGNATURE_PATH), keys: [...config.publicKeys] } };
      await persist();
    } catch {
      state = { ...state, checked: null };
    }
    const updates: string[] = [];
    for (const id of Object.keys(state.regions)) {
      const entry = ensure(id);
      if (outdated(id)) {
        updates.push(id);
        if (entry.state === 'installed') transition(id, 'update-found');
      } else if (entry.state === 'update-available') transition(id, 'update-gone');
    }
    emit();
    return { ok: true, updates: updates.sort(), diff: previous ? diffManifest(previous, result.manifest) : null };
  };

  const attempt = (action: () => Promise<void>): Promise<void> => {
    try {
      return action();
    } catch (error) {
      return Promise.reject(error);
    }
  };

  const beginDownload = (id: string, options: DownloadOptions): Promise<void> => {
    const region = regionOf(id);
    if (!region) throw packError('malformed', `unknown region ${id}`);
    const entry = ensure(id);
    if (entry.state === 'paused') return beginResume(id);
    const installedParts = PART_KINDS.filter((kind) => state.regions[id]?.files[kind] !== undefined);
    const parts = options.parts ?? (installedParts.length > 0 ? installedParts : DEFAULT_PARTS.filter((kind) => fileOfKind(region, kind)));
    for (const part of parts) if (!fileOfKind(region, part)) throw packError('malformed', `region ${id} has no ${part} part`);
    const upToDate = parts.every((kind) => state.regions[id]?.files[kind]?.sha256 === fileOfKind(region, kind)?.sha256);
    const manifest = (current as { manifest: Manifest }).manifest;
    const baseReady = !parts.includes('tiles') || manifest.base.every((f) => state.base?.files.some((b) => b.path === f.path && b.sha256 === f.sha256));
    if (upToDate && baseReady && (entry.state === 'installed' || entry.state === 'update-available')) {
      return Promise.resolve();
    }
    const sorted = PART_KINDS.filter((kind) => parts.includes(kind));
    transition(id, 'request');
    entry.error = null;
    const job = makeJob(id, sorted, options);
    state = { ...state, pending: { ...state.pending, [id]: { parts: sorted } } };
    void persist();
    enqueue(job);
    return job.promise;
  };

  const beginResume = (id: string): Promise<void> => {
    const parts = state.pending[id]?.parts ?? DEFAULT_PARTS;
    transition(id, 'resume');
    const job = makeJob(id, parts, {});
    enqueue(job);
    return job.promise;
  };

  const manager: PackManager = {
    manifest: () => current?.manifest ?? null,
    regions: () => current?.manifest.regions ?? [],
    status(id) {
      const entry = ensure(id);
      const record = state.regions[id];
      const region = regionOf(id);
      return {
        id,
        state: entry.state,
        progress: entry.progress,
        error: entry.error,
        waitingWifi: entry.waitingWifi,
        installedVersion: record?.version ?? null,
        availableVersion: record && region && outdated(id) ? region.version : null,
        installedParts: PART_KINDS.filter((kind) => record?.files[kind] !== undefined),
      };
    },
    downloadBytes(id, parts) {
      const region = regionOf(id);
      if (!region) return 0;
      const wanted = parts ?? DEFAULT_PARTS.filter((kind) => fileOfKind(region, kind));
      const files = wanted.reduce((sum, kind) => {
        const file = fileOfKind(region, kind);
        return file && state.regions[id]?.files[kind]?.sha256 !== file.sha256 ? sum + (file.encoded && env.decode ? file.encoded.size : file.size) : sum;
      }, 0);
      return files + (wanted.includes('tiles') ? manager.missingBaseBytes() : 0);
    },
    connection: () => connectivity.kind(),
    onConnection: (listener) => (connectivity.onChange ? connectivity.onChange(listener) : () => undefined),
    missingBaseBytes: () => (current?.manifest.base ?? []).filter((f) => !state.base?.files.some((b) => b.path === f.path && b.sha256 === f.sha256)).reduce((sum, f) => sum + f.size, 0),
    installedRegions: () => Object.keys(state.regions).filter((id) => state.regions[id]?.files.address !== undefined).sort(),
    checkUpdates: (options) => fetchManifest(options),
    download(id, options = {}) {
      const running = jobs.get(id);
      if (running && options.parts?.some((part) => !running.parts.includes(part))) return running.promise.then(() => manager.download(id, options));
      if (running) return running.promise;
      if (current) return attempt(() => beginDownload(id, options));
      return fetchManifest().then((fetched) => {
        if (!fetched.ok) throw packError(fetched.code);
        return beginDownload(id, options);
      });
    },
    async pause(id) {
      const job = jobs.get(id);
      const entry = ensure(id);
      if (!job || entry.state === 'verifying') return;
      job.intent = 'pause';
      const at = queue.indexOf(job);
      if (at >= 0) {
        queue.splice(at, 1);
        transition(id, 'pause');
        finishJob(job);
        job.reject(packError('cancelled'));
        checkIdle();
        return;
      }
      job.controller.abort();
      await job.settled;
    },
    resume(id) {
      const entry = ensure(id);
      if (entry.state !== 'paused') return jobs.get(id)?.promise ?? Promise.resolve();
      if (current) return attempt(() => beginResume(id));
      return fetchManifest().then((fetched) => {
        if (!fetched.ok) throw packError(fetched.code);
        return beginResume(id);
      });
    },
    async remove(id, parts) {
      const job = jobs.get(id);
      if (job) {
        job.intent = 'remove';
        const at = queue.indexOf(job);
        if (at >= 0) {
          queue.splice(at, 1);
          finishJob(job);
          job.reject(packError('cancelled'));
        } else {
          job.controller.abort();
          await job.settled;
        }
      }
      const record = state.regions[id];
      const kinds = parts ?? PART_KINDS;
      const doomed: string[] = [];
      const files: RegionRecord['files'] = { ...(record?.files ?? {}) };
      for (const kind of kinds) {
        const file = files[kind];
        if (file) doomed.push(finalPath(file.path));
        delete files[kind];
      }
      const region = regionOf(id);
      const leftovers: string[] = [];
      if (region) {
        for (const file of region.files) {
          if (!kinds.includes(file.kind as PartKind)) continue;
          leftovers.push(partPath(file.path), ...encodedPaths(file));
          if (!doomed.includes(finalPath(file.path))) doomed.push(finalPath(file.path));
        }
      }
      const regions = { ...state.regions };
      const remaining = PART_KINDS.some((kind) => files[kind] !== undefined);
      if (record && remaining) regions[id] = { ...record, files };
      else delete regions[id];
      const pending = { ...state.pending };
      delete pending[id];
      let base = state.base;
      const deletedBase: string[] = [];
      const baseWanted = Object.values(regions).some((r) => r.files.tiles !== undefined) || [...jobs.values()].some((other) => other.id !== id && other.parts.includes('tiles'));
      if (!baseWanted) {
        deletedBase.push(...(base?.files ?? []).map((f) => finalPath(f.path)), ...(current?.manifest.base ?? []).map((f) => finalPath(f.path)));
        leftovers.push(...(current?.manifest.base ?? []).flatMap((f) => [partPath(f.path), ...encodedPaths(f)]));
        base = null;
      }
      state = { ...state, regions, base, pending };
      await persist();
      const paths = [...new Set([...doomed, ...deletedBase])];
      const present: string[] = [];
      for (const path of paths) if (await fs.exists(path)) present.push(path);
      await runDeleteHooks(present);
      for (const path of [...paths, ...leftovers]) await fs.remove(path);
      const entry = ensure(id);
      entry.progress = null;
      entry.error = null;
      entry.waitingWifi = false;
      if (remaining) {
        if (entry.state !== 'installed' && entry.state !== 'update-available') entry.state = outdated(id) ? 'update-available' : 'installed';
        emit();
      } else {
        entry.state = 'none';
        emit();
      }
    },
    installedFile(id, kind) {
      const file = state.regions[id]?.files[kind];
      return file ? finalPath(file.path) : null;
    },
    baseDir: () => (state.base ? finalPath(`base-${state.base.build}`) : null),
    async dismiss(id) {
      if (state.dismissed.includes(id)) return;
      state = { ...state, dismissed: [...state.dismissed, id].sort() };
      await persist();
    },
    dismissed: () => [...state.dismissed],
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    beforeDelete(listener) {
      deleteHooks.add(listener);
      return () => void deleteHooks.delete(listener);
    },
    idle: () =>
      active === null && queue.length === 0
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            idleWaiters.push(resolve);
          }),
  };

  void emptyState;
  return manager;
}
