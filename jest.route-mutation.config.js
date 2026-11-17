import base from './jest.config.js';

export default {
  ...base,
  testMatch: ['<rootDir>/test/route/**/*.test.ts', '<rootDir>/test/geo/create-geo-route.test.ts', '<rootDir>/test/packs/route-store.test.ts'],
  testPathIgnorePatterns: ['/node_modules/'],
};
