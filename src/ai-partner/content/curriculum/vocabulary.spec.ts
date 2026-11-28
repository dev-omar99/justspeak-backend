import { CURRICULUM_VOCABULARY } from './vocabulary';

const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1'];

describe('curriculum vocabulary progression layer', () => {
  it('covers every level of every programme', () => {
    for (const levels of Object.values(CURRICULUM_VOCABULARY)) {
      for (const lv of LEVELS) expect(levels[lv].words.length).toBeGreaterThan(0);
    }
  });
  it('lists words easiest first inside a level', () => {
    for (const levels of Object.values(CURRICULUM_VOCABULARY)) {
      for (const lv of LEVELS) {
        const tiers = levels[lv].words.map((w) => w.tier);
        expect(tiers).toEqual([...tiers].sort((a, b) => a - b));
      }
    }
  });
  it('never repeats a word across levels of one programme', () => {
    for (const levels of Object.values(CURRICULUM_VOCABULARY)) {
      const all = LEVELS.flatMap((lv) => levels[lv].words.map((w) => w.word));
      expect(new Set(all).size).toBe(all.length);
    }
  });
});
