import * as Device from 'expo-device';
import type { DeviceReport } from '../../../src/core';
import { SDK_VERSION } from '../../../src/core';
import { BUILD_ID } from './build-id';

export const build = (): 'release' | 'debug' => (__DEV__ ? 'debug' : 'release');

export const buildId = (): string => `${build()}-${BUILD_ID}`;

export function deviceInfo(): DeviceReport['device'] {
  const memory = Device.totalMemory;
  return {
    model: `${Device.modelId ?? Device.modelName ?? 'unknown'}${Device.isDevice === false ? '-sim' : ''}`,
    os: `${Device.osName ?? 'unknown'} ${Device.osVersion ?? ''}`.trim(),
    ...(memory ? { memoryMB: Math.round(memory / (1024 * 1024)) } : {}),
  };
}

export function sdkInfo(dataVersion: string | null): DeviceReport['sdk'] {
  return { version: SDK_VERSION, dataVersion, build: build() };
}
