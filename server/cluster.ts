import cluster from 'node:cluster';

export type ClusterOptions = { workers: number; log?: (line: string) => void; restartDelayMs?: number };

export function runInCluster(options: ClusterOptions, work: () => Promise<void>): Promise<void> {
  const log = options.log ?? (() => undefined);
  if (options.workers <= 1) return work();
  if (!cluster.isPrimary) return work();
  cluster.schedulingPolicy = cluster.SCHED_RR;
  let stopping = false;
  const delay = options.restartDelayMs ?? 1000;
  const spawn = (): void => {
    const worker = cluster.fork();
    worker.on('exit', (code, signal) => {
      if (stopping) return;
      log(`işçi ${worker.process.pid} kapandı (${signal ?? code}), yeniden başlatılıyor`);
      setTimeout(spawn, delay);
    });
  };
  for (let i = 0; i < options.workers; i++) spawn();
  const stop = (): void => {
    stopping = true;
    for (const worker of Object.values(cluster.workers ?? {})) worker?.kill('SIGTERM');
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  log(`${options.workers} işçi başlatıldı`);
  return new Promise(() => undefined);
}
