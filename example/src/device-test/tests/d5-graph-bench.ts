import { benchPoints, makeGridGraphAsync, matrixAsync } from '../../../../scripts/spikes/graph';
import { nextTurn } from '../ui-yield';
import type { DeviceTest } from '../types';

const EXPECTED_CHECKSUM = 47793575;
const median = (values: number[]): number => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] as number;

const bench = async (side: number, repetitions: number) => {
  const g = await makeGridGraphAsync(side, 1, nextTurn);
  const { sources, targets } = benchPoints(g, 1, 50);
  const times: number[] = [];
  let checksum = 0;
  for (let rep = 0; rep < repetitions; rep++) {
    const result = await matrixAsync(g, sources, targets, { yieldNow: nextTurn, now: () => Date.now() });
    times.push(result.computeMs);
    checksum = result.values.reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0);
  }
  return { times, checksum };
};

export const d5GraphBench: DeviceTest = {
  id: 'd5.graph-bench',
  title: 'Rota matrisi hızı (550x550 ızgara, 50x50, düz Dijkstra)',
  kind: 'auto',
  async run(ctx) {
    const { times, checksum } = await bench(550, 3);
    ctx.log(`d5 times ${times.join(', ')}`);
    if (checksum !== EXPECTED_CHECKSUM) return { outcome: 'fail', note: `sağlama toplamı ${checksum}, beklenen ${EXPECTED_CHECKSUM}` };
    return { outcome: 'info', value: String(median(times)), unit: 'ms', threshold: 'kayıt amaçlı (Node 1422, Hermes CLI 12337)', note: `denemeler: ${times.join(', ')}` };
  },
};

export const d5GraphBenchSmall: DeviceTest = {
  id: 'd5.graph-bench-small',
  title: 'Rota matrisi hızı (200x200 ızgara, 50x50)',
  kind: 'auto',
  async run() {
    const { times } = await bench(200, 3);
    return { outcome: 'info', value: String(median(times)), unit: 'ms', threshold: 'kayıt amaçlı', note: `denemeler: ${times.join(', ')}` };
  },
};
