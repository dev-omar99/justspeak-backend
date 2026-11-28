import { lessonBeats } from './content/curriculum/lesson-beats';
import { LiveSession } from './conversation.service';
import { getPersona } from './content/personas';
import { getRoleplay } from './content/roleplays';
import { CURRICULUM_PROGRAMMES } from './content/curriculum';
import { Logger } from '@nestjs/common';

/**
 * Wiring check for ALL curriculum lessons: for each one, build the real coach system prompt and
 * assert the model is told the topic, the level, the goal, every beat and every rubric hint.
 * This proves the PROMPT carries the lesson. It does not prove how the model behaves (needs a live model).
 */
function promptFor(lessonId: string): string {
  const sc = getRoleplay(lessonId)!;
  const session = new LiveSession({
    sessionId: 's',
    userId: 'u',
    userName: 'Omar',
    mode: 'free-talk',
    persona: getPersona(sc.persona),
    level: sc.level,
    roleplayId: lessonId,
    emit: () => undefined,
    onOrphaned: () => undefined,
    deepgramService: {} as any,
    claude: {} as any,
    tts: {} as any,
    aiPartner: {} as any,
    pronunciation: {} as any,
    logger: new Logger('t'),
  } as any);
  return (session as any).buildSystemPrompt();
}

describe('every curriculum lesson reaches the coach prompt', () => {
  const lessons = CURRICULUM_PROGRAMMES.flatMap((p) => Object.values(p.levels).flat());

  it('covers all lessons', () => {
    expect(lessons.length).toBeGreaterThanOrEqual(672);
  });

  it('carries topic, level, goal, beats and rubric hints for each lesson', () => {
    const problems: string[] = [];
    for (const l of lessons) {
      const prompt = promptFor(l.id);
      const need = [
        l.title,
        l.personaRole,
        `Scene topic: ${l.description}`,
        `CEFR level ${l.level}`,
        `whose English level is ${l.level} (CEFR)`,
        l.goal,
        ...lessonBeats(l),
        ...l.rubric.map((r) => `- ${r.label}: ${r.hint}`),
      ];
      for (const n of need) if (!prompt.includes(n)) problems.push(`${l.id}: missing "${n.slice(0, 50)}"`);
    }
    expect(problems.slice(0, 10)).toEqual([]);
  });
});

describe('every curriculum lesson reaches the report-scoring prompt', () => {
  it('carries topic, level, goal and each rubric hint for each lesson', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { AiPartnerService } = require('./ai-partner.service');
    const prompts: string[] = [];
    const fake: any = Object.create(AiPartnerService.prototype);
    fake.logger = new Logger('t');
    fake.claude = { complete: async (p: any) => { prompts.push(p.prompt); return '{}'; } };
    const lessons = CURRICULUM_PROGRAMMES.flatMap((p) => Object.values(p.levels).flat());
    const problems: string[] = [];
    for (const l of lessons) {
      prompts.length = 0;
      await fake.buildModelReport(l.level, 'free-talk', [{ role: 'user', text: 'Hello' }], {}, null, l.id);
      const prompt = prompts[0] ?? '';
      const need = [`Student declared level: ${l.level}`, `Written for CEFR level ${l.level}`, l.description, l.goal, ...l.rubric.map((r) => `${r.label} (${r.hint})`)];
      for (const n of need) if (!prompt.includes(n)) problems.push(`${l.id}: missing "${n.slice(0, 50)}"`);
    }
    expect(problems.slice(0, 10)).toEqual([]);
  });
});
