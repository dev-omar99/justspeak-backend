import { parseDimensionNotes, verifyDimensionQuotes, parseSessionReport } from './content/rubric';

describe('dimension notes', () => {
  it('keeps a quote only when the learner said it', () => {
    const notes = parseDimensionNotes({
      grammar: { why: 'Past tense slip.', quote: "I'm graduated" },
      vocabulary: { why: 'Basic words.', quote: 'a made up phrase' },
      bogus: { why: 'ignored', quote: '' },
    });
    const out = verifyDimensionQuotes(notes, ["Hello. I'm  graduated from the faculty."]);
    expect(out.grammar?.quote).toBe("I'm graduated");
    expect(out.vocabulary).toEqual({ why: 'Basic words.', quote: '' });
    expect((out as any).bogus).toBeUndefined();
  });

  it('parses coherence and notes from a report', () => {
    const r = parseSessionReport(JSON.stringify({ status: 'OK', dimensions: { coherence: 72 }, dimension_notes: { coherence: { why: 'Stays on topic.', quote: '' } } }));
    expect(r?.dimensions.coherence).toBe(72);
    expect(r?.dimension_notes?.coherence?.why).toBe('Stays on topic.');
  });
});
