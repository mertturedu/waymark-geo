import type { DeviceTest } from '../device-test/types';
import { sdkAutoRegion } from './tests/auto-region';
import { sdkDirectory } from './tests/directory';
import { sdkLearnPersistA, sdkLearnPersistB } from './tests/learn-persist';
import { sdkMemory } from './tests/memory';
import { sdkPackInstall } from './tests/pack-install';
import { sdkPackResume } from './tests/pack-resume';
import { sdkRegionDetect } from './tests/region-detect';
import { sdkRegionMissing } from './tests/region-missing';
import { sdkRemoveFrees } from './tests/remove-frees';
import { sdkSearchSpeed } from './tests/search-speed';
import { sdkSparseArea } from './tests/sparse-area';
import { sdkSignature } from './tests/signature';
import { ADDRESS_TESTS } from './tests/address';
import { LEARN_TESTS } from './tests/learn-more';
import { REGION_TESTS } from './tests/regions';
import { PLAN_TESTS } from './tests/plan';
import { MAP_TESTS } from './tests/map-tour';
import { ROTATION_TESTS } from './tests/rotation';
import { SIM_TESTS } from './tests/simulation';
import { ICON_TESTS } from './tests/map-icons';
import { sdkUpdateKeepsLearning } from './tests/update';
import { ROUTE_TESTS } from './tests/route';
import { OFFLINE_TESTS } from './tests/offline';
import { routeBench as deviceRouteBench } from '../device-test/tests/route-bench';
import { packsDirectory } from '../device-test/storage';

export const CORE_TESTS: DeviceTest[] = [sdkRegionDetect, sdkSignature, sdkAutoRegion, sdkPackInstall, sdkRegionMissing, sdkSparseArea, sdkDirectory, sdkPackResume, sdkRemoveFrees, sdkLearnPersistA, sdkSearchSpeed, sdkMemory];
const routeBench: DeviceTest = { ...deviceRouteBench, run: (ctx) => deviceRouteBench.run({ ...ctx, packsDir: packsDirectory().uri }) };

export const EXTRA_TESTS: DeviceTest[] = [...REGION_TESTS, ...ADDRESS_TESTS, ...ROUTE_TESTS, ...PLAN_TESTS, ...MAP_TESTS, ...ROTATION_TESTS, ...SIM_TESTS, ...ICON_TESTS, sdkUpdateKeepsLearning, routeBench, ...LEARN_TESTS];
export const AUTO_TESTS: DeviceTest[] = [
  ...CORE_TESTS.slice(0, CORE_TESTS.indexOf(sdkLearnPersistA)),
  ...EXTRA_TESTS,
  ...CORE_TESTS.slice(CORE_TESTS.indexOf(sdkLearnPersistA)),
];
export const OFFLINE_AUTO_TESTS: DeviceTest[] = OFFLINE_TESTS;
export const RESTART_TESTS: DeviceTest[] = [sdkLearnPersistB];

export const sdkRegistry: DeviceTest[] = [...AUTO_TESTS, ...RESTART_TESTS, ...OFFLINE_AUTO_TESTS];
