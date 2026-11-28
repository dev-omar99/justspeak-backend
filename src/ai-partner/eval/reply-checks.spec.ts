import { checkReply, summarise, ReplyContext } from './reply-checks';
import { coachingContext, resolveCoachCategory, FEW_SHOT, LEVEL_GUIDANCE, ROLE_GUIDANCE } from '../content/coaching-rules';
import { ROLEPLAY_SCENARIOS } from '../content/roleplays';
import type { RoleplayCategory } from '../content/roleplays';

const ctx = (over: Partial<ReplyContext> = {}): ReplyContext => ({
  level: 'A2',
  topicWords: ['hotel', 'room'],
  learnerSaid: 'I want a room for two nights',
  previousCoachLines: [],
  ...over,
});
const failed = (reply: string, c: ReplyContext) => checkReply(reply, c).filter((r) => !r.pass).map((r) => r.id);

describe('coach reply checklist (offline)', () => {
  it('passes a good reply', () => {
    expect(failed('A room for two nights, great. Do you want a quiet room?', ctx())).toEqual([]);
  });
  it('flags two questions, correction, Arabic and repetition', () => {
    expect(failed('Which room? For how long?', ctx())).toContain('one-question');
    expect(failed('You should say "I would like". Which room do you want?', ctx())).toContain('no-correction');
    expect(failed('تمام. Which room do you want?', ctx())).toContain('no-arabic');
    const prev = 'Which room do you want?';
    expect(failed(prev, ctx({ previousCoachLines: [prev] }))).toContain('no-repeat');
  });
  it('flags sentences too long for the level', () => {
    const long = 'Considering the particular circumstances of your travel arrangements this season, would you prefer accommodation with a view of the harbour?';
    expect(failed(long, ctx({ level: 'A2' }))).toContain('level-sentence-length');
    expect(failed(long, ctx({ level: 'C1', topicWords: ['accommodation'] }))).toEqual([]);
  });
  it('requires a goodbye and at most one question when closing', () => {
    const c = ctx({ closing: true });
    expect(failed('Great work today. Any last question? Goodbye!', c)).toEqual([]);
    expect(failed('Great work today. Do you want more practice?', c)).toContain('closes-politely');
  });
  it('summarises pass rates per check', () => {
    const s = summarise([checkReply('Nice room. Which floor?', ctx()), checkReply('Which one? Why?', ctx())]);
    expect(s['one-question']).toEqual({ pass: 1, total: 2 });
  });
});

describe('coaching context wiring', () => {
  const cats: RoleplayCategory[] = ['interview', 'work', 'travel', 'daily-life', 'academic'];
  it('every category and level has guidance and two examples', () => {
    for (const c of cats) {
      expect(ROLE_GUIDANCE[c].length).toBeGreaterThan(40);
      expect(FEW_SHOT[c]).toHaveLength(2);
    }
    expect(Object.keys(LEVEL_GUIDANCE)).toEqual(['A1', 'A2', 'B1', 'B2', 'C1']);
  });
  it('the few-shot coach lines themselves pass the checklist at their level', () => {
    for (const c of cats) {
      for (const shot of FEW_SHOT[c]) {
        const res = checkReply(shot.next, {
          level: 'B1',
          topicWords: [],
          learnerSaid: shot.learner,
          previousCoachLines: [],
        }).filter((r) => ['one-question', 'no-correction', 'no-arabic', 'short-turn'].includes(r.id) && !r.pass);
        expect(res).toEqual([]);
      }
    }
  });
  it('every built-in scenario gets level and role guidance in its context', () => {
    for (const s of ROLEPLAY_SCENARIOS) {
      const text = coachingContext(s.category, s.level);
      expect(text).toContain(LEVEL_GUIDANCE[s.level]);
      expect(text).toContain(ROLE_GUIDANCE[resolveCoachCategory(s.category)]);
      expect(text).toContain('Never correct grammar mid-conversation');
    }
  });
});
