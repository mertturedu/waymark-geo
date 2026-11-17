import { computeParity } from '../test/helpers/core-parity';

declare const print: ((text: string) => void) | undefined;

const text = JSON.stringify(computeParity());
if (typeof print === 'function') print(text);
else console.log(text);
