import { normalizeCefrLevel } from './levels';

describe('normalizeCefrLevel', () => {
  it('maps the app profile labels to CEFR bands', () => {
    expect(normalizeCefrLevel('Beginner')).toBe('A2');
    expect(normalizeCefrLevel('Elementary')).toBe('A2');
    expect(normalizeCefrLevel('Intermediate')).toBe('B1');
    expect(normalizeCefrLevel('Upper-Intermediate')).toBe('B2');
    expect(normalizeCefrLevel('Advanced')).toBe('C1');
  });

  it('passes real CEFR values through, normalized', () => {
    expect(normalizeCefrLevel('b2')).toBe('B2');
    expect(normalizeCefrLevel('C1')).toBe('C1');
  });

  it('falls back to B1 for empty or unknown labels', () => {
    expect(normalizeCefrLevel('')).toBe('B1');
    expect(normalizeCefrLevel(null)).toBe('B1');
    expect(normalizeCefrLevel(undefined)).toBe('B1');
    expect(normalizeCefrLevel('fluent-ish?')).toBe('B1');
    expect(normalizeCefrLevel('Fluent')).toBe('C2');
  });
});
