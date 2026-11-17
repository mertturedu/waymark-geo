import base from './jest.config.js';

export default {
  ...base,
  testMatch: ['<rootDir>/test/plan/**/*.test.ts'],
  testPathIgnorePatterns: ['/node_modules/'],
};
