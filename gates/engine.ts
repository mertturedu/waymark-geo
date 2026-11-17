export type GateStatus = 'pass' | 'fail' | 'open';

export type GateContext = {
  reportDir: string;
  repoRoot: string;
  run(cmd: string, args: string[]): Promise<{ code: number; out: string }>;
};

export type Gate = {
  id: string;
  phase: number;
  title: string;
  kind: 'auto' | 'device' | 'decision';
  threshold: string;
  allowOpen?: boolean;
  measure(ctx: GateContext): Promise<{ status: GateStatus; measured: string }>;
};

export type GateResult = {
  id: string;
  title: string;
  kind: Gate['kind'];
  threshold: string;
  status: GateStatus;
  measured: string;
  allowOpen: boolean;
};

export async function runGates(gates: Gate[], ctx: GateContext): Promise<GateResult[]> {
  const results: GateResult[] = [];
  for (const gate of gates) {
    let outcome: { status: GateStatus; measured: string };
    try {
      outcome = await gate.measure(ctx);
    } catch (error) {
      outcome = { status: 'fail', measured: error instanceof Error ? error.message : String(error) };
    }
    results.push({ id: gate.id, title: gate.title, kind: gate.kind, threshold: gate.threshold, allowOpen: gate.allowOpen ?? false, ...outcome });
  }
  return results;
}

const LABELS: Record<GateStatus, string> = { pass: 'GEÇTİ', fail: 'KALDI', open: 'AÇIK' };

const cell = (value: string): string => value.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');

export function renderGateTable(results: GateResult[]): string {
  const rows = results.map((r) => `| ${r.id} | ${cell(r.title)} | ${r.kind} | ${cell(r.threshold)} | ${cell(r.measured)} | ${LABELS[r.status]} |`);
  return ['| Kapı | Başlık | Tür | Eşik | Ölçülen | Durum |', '|---|---|---|---|---|---|', ...rows, ''].join('\n');
}

export function exitCodeFor(results: GateResult[]): 0 | 1 {
  return results.some((r) => r.status === 'fail' || (r.status === 'open' && !r.allowOpen)) ? 1 : 0;
}
