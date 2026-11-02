export default {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/**/*.test.ts'],
  transform: {
    '^.+\\.ts$': ['@swc/jest', { jsc: { parser: { syntax: 'typescript' }, target: 'es2022' }, module: { type: 'commonjs' } }],
  },
  collectCoverageFrom: ['src/core/**/*.ts', '!src/core/index.ts'],
  coverageThreshold: {
    'src/core/**/*.ts': { lines: 90, branches: 85 },
  },
};
