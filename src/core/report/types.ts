export type Outcome = 'pass' | 'fail' | 'skip' | 'info';

export type ReportEntry = {
  id: string;
  title: string;
  kind: 'auto' | 'manual';
  outcome: Outcome;
  value?: string;
  unit?: string;
  threshold?: string;
  note?: string;
};

export type DeviceReport = {
  reportId: string;
  createdAt: string;
  device: { model: string; os: string; memoryMB?: number };
  sdk: { version: string; dataVersion: string | null; build: 'release' | 'debug' };
  entries: ReportEntry[];
};

export type ReportError = 'EMPTY' | 'BAD_HEADER' | 'UNSUPPORTED_VERSION' | 'TRUNCATED' | 'BAD_CHECKSUM' | 'BAD_LINE';
