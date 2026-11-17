import type { DeviceReport } from '../../src/core/report/types';

export const sampleReport = (): DeviceReport => ({
  reportId: 'iphone11-20261022-a1',
  createdAt: '2026-10-22T10:15:00.000Z',
  device: { model: 'iPhone12,1', os: 'iOS 26.0', memoryMB: 3796 },
  sdk: { version: '0.0.0', dataVersion: '20261020', build: 'release' },
  entries: [
    { id: 'env.info', title: 'Cihaz bilgisi', kind: 'auto', outcome: 'info', value: 'iPhone 11' },
    { id: 'd1.map-offline', title: 'Harita çevrimdışı görünüyor mu', kind: 'manual', outcome: 'pass', note: 'Kadıköy yolları göründü' },
  ],
});
