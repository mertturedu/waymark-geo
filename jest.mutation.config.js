import base from './jest.config.js';

export default {
  ...base,
  testPathIgnorePatterns: ['/node_modules/', 'fuzz.test', 'measure-text.test', 'properties.test', 'sentence-generator.test', 'hermes-golden.test', 'test/lint/', 'test/gates/', 'test/example/', 'test/scripts/', 'test/pipeline/', 'test/spikes/', 'smoke.test'],
};
