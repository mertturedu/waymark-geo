import type { Outcome } from '../../../src/core';

export type TestContext = {
  packServerUrl: string;
  packsDir: string;
  reportDir: string;
  log(line: string): void;
};

export type TestResult = { outcome: Outcome; value?: string; unit?: string; threshold?: string; note?: string };

export type DeviceTest = {
  id: string;
  title: string;
  kind: 'auto' | 'manual';
  question?: string;
  rev?: number;
  run(ctx: TestContext): Promise<TestResult>;
};
