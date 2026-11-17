import { runBench } from './graph';

const before = process.memoryUsage();
const result = runBench({ side: 550, seed: 1, points: 50, repetitions: 5, now: () => performance.now() });
const after = process.memoryUsage();
console.log(
  JSON.stringify({
    ...result,
    runtime: `node ${process.version}`,
    heapUsedDeltaMB: Math.round((after.heapUsed - before.heapUsed) / 1048576),
    arrayBuffersDeltaMB: Math.round((after.arrayBuffers - before.arrayBuffers) / 1048576),
  }),
);
