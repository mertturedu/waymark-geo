import { parseDecision } from '../../gates/decision';

const valid = { id: 'D1', result: 'evet', summary: 'Harita iPhone 11 üzerinde çevrimdışı açıldı', evidence: ['cihaz-iphone11-a1.json'] };

describe('parseDecision', () => {
  it('reads a valid decision', () => {
    expect(parseDecision(valid)).toEqual(valid);
  });

  it('accepts a negative decision', () => {
    expect(parseDecision({ ...valid, result: 'hayir' }).result).toBe('hayir');
  });

  it.each([
    ['unknown result', { ...valid, result: 'belki' }],
    ['empty summary', { ...valid, summary: '  ' }],
    ['no evidence', { ...valid, evidence: [] }],
    ['evidence not strings', { ...valid, evidence: [1] }],
    ['missing id', { ...valid, id: undefined }],
    ['not an object', 'evet'],
    ['null', null],
  ])('rejects %s', (_name, input) => {
    expect(() => parseDecision(input)).toThrow();
  });
});

describe('parseDecision with an expected id', () => {
  const valid = { id: 'D3', result: 'evet', summary: 'özet', evidence: ['kanıt'] };

  it('accepts a decision whose id matches', () => {
    expect(parseDecision(valid, 'D3').id).toBe('D3');
  });

  it('rejects a decision filed under another id', () => {
    expect(() => parseDecision(valid, 'D7')).toThrow('decision id D3 does not match D7');
  });
});
