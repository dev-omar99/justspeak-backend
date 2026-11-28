import { buildTurnCheckPrompt, parseTurnChecks } from './turn-check';

describe('turn-check', () => {
  const texts = ["My name is Omariones. I'm graduated from the faculty.", "I can add value here."];
  const idx = [1, 3];

  it('numbers the turns', () => {
    expect(buildTurnCheckPrompt(texts)).toBe(`1. ${texts[0]}\n2. ${texts[1]}`);
  });

  it('keeps real issues, maps indexes, drops invented quotes', () => {
    const raw = JSON.stringify([
      { i: 1, verdict: 'needs_fix', problems: [
        { kind: 'unclear', said: 'Omariones', why: 'Looks misheard.' },
        { kind: 'grammar', said: "I'm graduated", why: 'Say "I graduated".' },
        { kind: 'grammar', said: 'not in the sentence', why: 'made up' },
      ], refreshed: 'My name is Omar. I graduated from the faculty.' },
      { i: 2, verdict: 'correct' },
    ]);
    const out = parseTurnChecks(`text ${raw} end`, texts, idx);
    expect(out).toHaveLength(2);
    expect(out[0].index).toBe(1);
    expect(out[0].issues.map((x) => x.said)).toEqual(['Omariones', "I'm graduated"]);
    expect(out[1]).toEqual({ index: 3, verdict: 'correct', issues: [] });
  });

  it('treats needs_fix with nothing trustworthy as correct', () => {
    const raw = JSON.stringify([{ i: 2, verdict: 'needs_fix', problems: [{ kind: 'grammar', said: 'zzz', why: 'x' }], refreshed: texts[1] }]);
    expect(parseTurnChecks(raw, texts, idx)).toEqual([{ index: 3, verdict: 'correct', issues: [] }]);
  });

  it('returns nothing for garbage', () => {
    expect(parseTurnChecks('no json', texts, idx)).toEqual([]);
    expect(parseTurnChecks('[oops', texts, idx)).toEqual([]);
  });
});
