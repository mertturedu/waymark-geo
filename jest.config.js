export default {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/**/*.test.ts', '<rootDir>/test/**/*.test.tsx'],
  transform: {
    '^.+\\.ts$': ['@swc/jest', { jsc: { parser: { syntax: 'typescript' }, target: 'es2022' }, module: { type: 'commonjs' } }],
    '^.+\\.tsx$': ['@swc/jest', { jsc: { parser: { syntax: 'typescript', tsx: true }, target: 'es2022', transform: { react: { runtime: 'automatic' } } }, module: { type: 'commonjs' } }],
  },
  collectCoverageFrom: ['src/core/**/*.ts', '!src/core/index.ts', 'src/native/logic/**/*.ts', 'src/native/map/**/*.ts'],
  coverageThreshold: {
    'src/core/**/*.ts': { lines: 90, branches: 85 },
    'src/native/logic/**/*.ts': { lines: 90, branches: 80 },
    'src/native/map/**/*.ts': { lines: 90, branches: 80 },
  },
};
