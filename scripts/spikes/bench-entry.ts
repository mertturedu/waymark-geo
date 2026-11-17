import { runBench } from './graph';

declare const print: ((text: string) => void) | undefined;

const result = runBench({ side: 550, seed: 1, points: 50, repetitions: 5, now: () => Date.now() });
const text = JSON.stringify({ ...result, runtime: 'hermes' });
if (typeof print === 'function') print(text);
else console.log(text);
