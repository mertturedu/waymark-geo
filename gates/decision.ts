export type Decision = { id: string; result: 'evet' | 'hayir'; summary: string; evidence: string[] };

export function parseDecision(json: unknown, expectedId?: string): Decision {
  if (typeof json !== 'object' || json === null) throw new Error('decision must be an object');
  const { id, result, summary, evidence } = json as Record<string, unknown>;
  if (typeof id !== 'string' || id === '') throw new Error('decision id missing');
  if (expectedId !== undefined && id !== expectedId) throw new Error(`decision id ${id} does not match ${expectedId}`);
  if (result !== 'evet' && result !== 'hayir') throw new Error('decision result must be evet or hayir');
  if (typeof summary !== 'string' || summary.trim() === '') throw new Error('decision summary missing');
  if (!Array.isArray(evidence) || evidence.length === 0 || !evidence.every((e) => typeof e === 'string' && e !== '')) {
    throw new Error('decision evidence missing');
  }
  return { id, result, summary, evidence: evidence as string[] };
}
