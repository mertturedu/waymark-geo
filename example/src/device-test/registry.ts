import { d1DetailFlat, d1DetailKadikoy, d1DetailOrtaA, d1DetailOrtaB, d1MapDark, d1MapEvents, d1FontOriginal, d1FontCompact, d1MapIstanbul, d1MapLabels, d1MapOffline, d1NetState, d1PmtilesFile } from './tests/d1-offline-map';
import { d2StreetSearch, d2StreetSearchUnique } from './tests/d2-sqlite';
import { d3BinaryRead } from './tests/d3-binary-read';
import { d4InsufficientSpace, d4ResumeDownload, d4ShaMethods } from './tests/d4-download';
import { d5GraphBench, d5GraphBenchSmall } from './tests/d5-graph-bench';
import { addressSearch } from './tests/address-search';
import { envInfo, envPackServer } from './tests/env';
import { routeBench } from './tests/route-bench';
import { textGolden } from './tests/text-golden';
import type { DeviceTest } from './types';

export const registry: DeviceTest[] = [envInfo, envPackServer, d1PmtilesFile, d1NetState, d1MapEvents, d1MapOffline, d1MapLabels, d1MapDark, d1DetailKadikoy, d1DetailOrtaA, d1DetailOrtaB, d1MapIstanbul, d1DetailFlat, d1FontOriginal, d1FontCompact, d4InsufficientSpace, d4ResumeDownload, d4ShaMethods, d2StreetSearchUnique, d2StreetSearch, d3BinaryRead, d5GraphBenchSmall, d5GraphBench, textGolden, addressSearch, routeBench];
