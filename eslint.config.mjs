import js from '@eslint/js';
import tseslint from 'typescript-eslint';

const coreRestricted = {
  patterns: [
    { group: ['node:*', 'fs', 'path', 'os', 'child_process', 'http', 'https', 'crypto'], message: 'core must run on Hermes and Node alike' },
    { group: ['react-native', 'react-native/*', 'expo', 'expo-*'], message: 'core must not depend on the app runtime' },
  ],
};

const hermesSafe = [
  { selector: "CallExpression[callee.property.name='normalize']", message: 'normalize differs between engines' },
  { selector: "CallExpression[callee.property.name=/^toLocale(Lower|Upper)Case$/]", message: 'locale case mapping differs between engines' },
  { selector: "CallExpression[callee.property.name=/^to(Lower|Upper)Case$/]", message: 'use the fold tables for user text' },
  { selector: "Identifier[name='Intl']", message: 'Intl is not available the same way on Hermes' },
  { selector: 'Literal[regex.pattern=/\\\\[pP]\\{/]', message: 'unicode property escapes are not portable to Hermes' },
];

const noClasses = [
  { selector: 'ClassDeclaration', message: 'Hermes CLI cannot compile classes; use closures' },
  { selector: 'ClassExpression', message: 'Hermes CLI cannot compile classes; use closures' },
];

const commonjsFiles = {
  files: ['app.plugin.cjs'],
  languageOptions: { sourceType: 'commonjs', globals: { require: 'readonly', module: 'writable' } },
  rules: { '@typescript-eslint/no-require-imports': 'off' },
};

export default tseslint.config(
  { ignores: ['node_modules', 'dist', 'lib', 'coverage', '.stryker-tmp', 'example/**', 'pipeline/.venv/**', 'pipeline/bin/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  commonjsFiles,
  { files: ['src/native/platform/icon-images.ts', 'src/native/platform/badge-images.ts', 'src/native/platform/legend-images.ts', 'src/native/platform/locate-images.ts', 'src/native/platform/shield-images.ts'], rules: { '@typescript-eslint/triple-slash-reference': ['error', { path: 'always' }] } },
  {
    files: ['src/core/**/*.ts'],
    rules: { 'no-restricted-imports': ['error', coreRestricted] },
  },
  {
    files: ['src/core/**/*.ts'],
    rules: { 'no-restricted-syntax': ['error', ...noClasses] },
  },
  {
    files: ['src/core/text/**/*.ts', 'src/core/address/**/*.ts', 'src/core/geo/**/*.ts'],
    rules: { 'no-restricted-syntax': ['error', ...noClasses, ...hermesSafe] },
  },
);
