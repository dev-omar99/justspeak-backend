import { countFillers } from './word-choice';
import { analyzeWordChoice } from './word-choice';

describe('analyzeWordChoice', () => {
  it('returns zeros for empty input', () => {
    const stats = analyzeWordChoice([]);
    expect(stats.totalWords).toBe(0);
    expect(stats.fillers.count).toBe(0);
    expect(stats.fillers.pct).toBe(0);
    expect(stats.weakWords).toEqual([]);
    expect(stats.repetition.count).toBe(0);
    expect(stats.conciseness.avgWordsPerTurn).toBe(0);
    expect(stats.sentenceStarters).toEqual([]);
  });

  it('counts fillers including variants and phrases', () => {
    const stats = analyzeWordChoice([
      'Um, I think, you know, the project is basically done, umm.',
    ]);
    const labels = stats.fillers.top.map((f) => f.word);
    expect(labels).toEqual(expect.arrayContaining(['um', 'you know', 'basically']));
    expect(stats.fillers.count).toBe(4); // um x2, you know, basically
    expect(stats.fillers.top.find((f) => f.word === 'um')?.count).toBe(2);
    expect(stats.fillers.pct).toBeGreaterThan(0);
  });

  it('flags weak words', () => {
    const stats = analyzeWordChoice(['It was really very good, just stuff and things.']);
    const words = stats.weakWords.map((w) => w.word);
    expect(words).toEqual(expect.arrayContaining(['really', 'very', 'just', 'stuff', 'things']));
  });

  it('detects content-word repetition but ignores stop words', () => {
    const stats = analyzeWordChoice([
      'The hotel was clean. The hotel had a pool. The hotel staff were kind.',
    ]);
    expect(stats.repetition.words.map((w) => w.word)).toContain('hotel');
    expect(stats.repetition.words.map((w) => w.word)).not.toContain('the');
  });

  it('measures conciseness against the spoken-answer ceiling', () => {
    const short = analyzeWordChoice(['I like it.', 'Me too.']);
    expect(short.conciseness.avgWordsPerTurn).toBe(2.5);
    expect(short.conciseness.excessPct).toBe(0);

    const long = analyzeWordChoice([new Array(80).fill('word').join(' ')]);
    expect(long.conciseness.avgWordsPerTurn).toBe(80);
    expect(long.conciseness.excessPct).toBe(100); // 80 vs 40-word ceiling
  });

  it('tracks sentence starters', () => {
    const stats = analyzeWordChoice(['I went home. I ate dinner. Then I slept.']);
    expect(stats.sentenceStarters[0]).toMatchObject({ word: 'i', count: 2 });
    expect(stats.sentenceStarters[1]).toMatchObject({ word: 'then', count: 1 });
  });
});

describe('countFillers (context aware "like")', () => {
  it('does not count "like" used as a real word', () => {
    expect(countFillers('Yes. Like this kind of cards.')).toBe(0);
    expect(countFillers('I like Japanese cars and it looks like a good deal')).toBe(0);
  });
  it('counts "like" used as a filler', () => {
    expect(countFillers('It was, like, really big and, like, loud')).toBe(2);
    expect(countFillers('We went there like yesterday')).toBe(1);
  });
  it('still counts um, uh and you know', () => {
    expect(countFillers('Um I think, uh, you know, it works')).toBe(3);
  });
});
