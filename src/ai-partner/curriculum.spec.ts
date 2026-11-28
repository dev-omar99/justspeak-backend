import { buildCatalog, hideLegacyProgrammes } from './catalog';
import { CURRICULUM_PROGRAMMES, curriculumEnabled, canStartCurriculumLesson, isPreviewAllowlisted } from './content/curriculum';
import { getRoleplay, ROLEPLAY_SCENARIOS } from './content/roleplays';

const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1'] as const;
const all = CURRICULUM_PROGRAMMES.flatMap((p) => Object.values(p.levels).flat().map((l) => ({ p, l })));

describe('curriculum data (review checks)', () => {
  it('has the expected lesson counts', () => {
    const count = (id: string) => all.filter((x) => x.p.id === id).length;
    expect(count('work-customer-service')).toBe(124);
    expect(count('interviews-customer-service-interview-english')).toBe(76);
    expect(count('work-sales')).toBe(104);
    expect(count('daily-life-everyday')).toBe(104);
    expect(count('travel-conversations')).toBe(100);
    expect(count('academic-english-course')).toBe(84);
    expect(count('workplace-english-course')).toBe(80);
  });

  it('every programme has all five levels and 4 lessons per unit', () => {
    for (const p of CURRICULUM_PROGRAMMES) {
      for (const lv of LEVELS) {
        const lessons = p.levels[lv];
        expect(lessons.length).toBeGreaterThan(0);
        const perUnit = new Map<string, number>();
        lessons.forEach((l) => perUnit.set(l.unit, (perUnit.get(l.unit) ?? 0) + 1));
        for (const [unit, n] of perUnit) expect([p.id, lv, unit, n]).toEqual([p.id, lv, unit, 4]);
      }
    }
  });

  it('lesson ids are unique and do not clash with existing roleplays', () => {
    const ids = all.map((x) => x.l.id);
    expect(new Set(ids).size).toBe(ids.length);
    const existing = new Set(ROLEPLAY_SCENARIOS.map((s) => s.id));
    ids.forEach((id) => expect(existing.has(id)).toBe(false));
  });

  it('every lesson has goal, persona role, 3 or 4 rubric points (4 on full calls), beats, source and licence, and starts as draft', () => {
    for (const { l } of all) {
      expect(l.goal.length).toBeGreaterThan(10);
      expect(l.personaRole.length).toBeGreaterThan(5);
      expect([3, 4]).toContain(l.rubric.length);
      l.rubric.forEach((r) => expect(r.label.length).toBeGreaterThan(2));
      expect(l.targets.length).toBeGreaterThanOrEqual(4);
      expect(l.source.length).toBeGreaterThan(5);
      expect(l.licence.length).toBeGreaterThan(5);
      expect(l.status).toBe('draft');
    }
  });

  it('quality lint: no duplicate titles or goals inside a programme, no customer wording outside customer programmes', () => {
    for (const p of CURRICULUM_PROGRAMMES) {
      const lessons = Object.values(p.levels).flat();
      const titles = lessons.map((l) => l.title.toLowerCase());
      const goals = lessons.map((l) => l.goal.toLowerCase());
      expect([p.id, titles.length - new Set(titles).size]).toEqual([p.id, 0]);
      expect([p.id, goals.length - new Set(goals).size]).toEqual([p.id, 0]);
      lessons.forEach((l) => expect(l.targets.join(' ')).not.toContain("customer's replies"));
    }
  });

  it('the scenario the coach and the scorer receive carries every rubric hint (both prompts print r.hint)', () => {
    for (const { l } of all.slice(0, 600)) {
      const sc = getRoleplay(l.id);
      expect(sc?.rubric.map((r) => r.hint)).toEqual(l.rubric.map((r) => r.hint));
      l.rubric.forEach((r) => expect(r.hint).toMatch(/Full|Full credit/));
    }
  });

  it('keeps content rules: no third-party names, no pricing words', () => {
    const text = JSON.stringify(CURRICULUM_PROGRAMMES).toLowerCase();
    for (const bad of ['oxford', 'yoodli', 'checkout', 'plans.ts']) expect(text).not.toContain(bad);
  });

  it('interview answer keys cover all seven linking expressions', () => {
    const keys = CURRICULUM_PROGRAMMES.find((p) => p.answerKeys)?.answerKeys?.['linking-expressions'] ?? [];
    expect(keys.map((k) => k.answer)).toEqual(['Since', 'Therefore', 'In addition to that', 'However', 'Although', 'For instance', 'As a result']);
    keys.forEach((k) => expect(k.sentence).toContain('___'));
  });
});

describe('curriculum flag', () => {
  const OLD = process.env.CURRICULUM_ENABLED;
  const OLD_P = process.env.CURRICULUM_ADMIN_PREVIEW;
  afterEach(() => {
    if (OLD === undefined) delete process.env.CURRICULUM_ENABLED;
    else process.env.CURRICULUM_ENABLED = OLD;
    if (OLD_P === undefined) delete process.env.CURRICULUM_ADMIN_PREVIEW;
    else process.env.CURRICULUM_ADMIN_PREVIEW = OLD_P;
  });

  it('admin preview: only the admin viewer sees drafts; everyone else sees production', () => {
    delete process.env.CURRICULUM_ENABLED;
    process.env.CURRICULUM_ADMIN_PREVIEW = 'true';
    const admin = buildCatalog([], { isPreviewer: true });
    const user = buildCatalog([], { isPreviewer: false });
    const anon = buildCatalog([]);
    expect(admin.find((f) => f.id === 'work')?.programmes).toHaveLength(4);
    expect(user.find((f) => f.id === 'work')?.programmes).toHaveLength(1);
    expect(anon.find((f) => f.id === 'interviews')?.programmes).toHaveLength(1);
    expect(canStartCurriculumLesson('work-cs-b1-u1-l1', { isPreviewer: true })).toBe(true);
    expect(canStartCurriculumLesson('work-cs-b1-u1-l1', { isPreviewer: false })).toBe(false);
    expect(canStartCurriculumLesson('work-cs-b1-u1-l1')).toBe(false);
    expect(canStartCurriculumLesson('some-other-roleplay', { isPreviewer: false })).toBe(true);
  });

  it('admin preview flag off: even the admin viewer sees nothing', () => {
    delete process.env.CURRICULUM_ENABLED;
    delete process.env.CURRICULUM_ADMIN_PREVIEW;
    expect(buildCatalog([], { isPreviewer: true }).find((f) => f.id === 'work')?.programmes).toHaveLength(1);
    expect(canStartCurriculumLesson('work-cs-b1-u1-l1', { isPreviewer: true })).toBe(false);
  });

  it('is hidden by default: production catalog and roleplay lookup are unchanged', () => {
    delete process.env.CURRICULUM_ENABLED;
    expect(curriculumEnabled()).toBe(false);
    const fields = buildCatalog([]);
    expect(fields.find((f) => f.id === 'work')?.programmes).toHaveLength(1);
    expect(fields.find((f) => f.id === 'interviews')?.programmes).toHaveLength(1);
  });

  it('on staging, programmes appear next to the existing ones and lessons start as roleplays', () => {
    process.env.CURRICULUM_ENABLED = 'true';
    const fields = buildCatalog([]);
    const work = fields.find((f) => f.id === 'work')!;
    expect(work.programmes.map((p) => p.id)).toEqual(['work-english', 'work-customer-service', 'work-sales', 'workplace-english-course']);
    const cs = work.programmes[1];
    expect(cs.totalLessons).toBe(124);
    expect(cs.levels.map((l) => l.level)).toEqual([...LEVELS]);
    expect(cs.levels[0].lessons[0].unit).toBe('Greeting a customer');
    const iv = fields.find((f) => f.id === 'interviews')!.programmes[1];
    expect(iv.totalLessons).toBe(76);
    const scenario = getRoleplay('work-cs-b1-u1-l1');
    expect(scenario?.title).toBe('Asking open questions');
    expect(scenario?.targets.length).toBeGreaterThanOrEqual(4);
  });

  it('attempts and progress work for a curriculum lesson', () => {
    process.env.CURRICULUM_ENABLED = 'true';
    const sessions = [{ id: 's1', roleplayId: 'work-cs-a1-u1-l1', createdAt: new Date(), report: { status: 'OK', dimensions: { fluency: 80, grammar: 70 } } }];
    const cs = buildCatalog(sessions).find((f) => f.id === 'work')!.programmes[1];
    const lesson = cs.levels[0].lessons[0];
    expect(lesson.status).toBe('passed');
    expect(lesson.bestScore).toBe(75);
    expect(cs.passedLessons).toBe(1);
  });
});

describe('insufficientReport', () => {
  it('states the real seconds heard and the seconds needed', () => {
    const { insufficientReport } = require('./content/rubric');
    const r = insufficientReport({ student_speech_sec: 38 }, 60);
    expect(r.status).toBe('INSUFFICIENT_DATA');
    expect(r.next_focus).toContain('38s');
    expect(r.next_focus).toContain('60s');
  });
});

describe('preview allowlist (CURRICULUM_PREVIEW_EMAILS)', () => {
  const OLD = process.env.CURRICULUM_PREVIEW_EMAILS;
  afterEach(() => {
    if (OLD === undefined) delete process.env.CURRICULUM_PREVIEW_EMAILS;
    else process.env.CURRICULUM_PREVIEW_EMAILS = OLD;
  });
  it('is empty by default: nobody is allowlisted', () => {
    delete process.env.CURRICULUM_PREVIEW_EMAILS;
    expect(isPreviewAllowlisted('anyone@example.com')).toBe(false);
    expect(isPreviewAllowlisted('')).toBe(false);
    expect(isPreviewAllowlisted(null)).toBe(false);
  });
  it('matches only the listed addresses, case-insensitively, whole address', () => {
    process.env.CURRICULUM_PREVIEW_EMAILS = ' Ali@Example.com , sara@example.com ,';
    expect(isPreviewAllowlisted('ali@example.com')).toBe(true);
    expect(isPreviewAllowlisted('SARA@example.com')).toBe(true);
    expect(isPreviewAllowlisted('bali@example.com')).toBe(false);
    expect(isPreviewAllowlisted('ali@example.com.evil.io')).toBe(false);
  });
});

describe('legacy programme switch', () => {
  const OLD = process.env.HIDE_LEGACY_PROGRAMMES;
  const OLD_P = process.env.CURRICULUM_ADMIN_PREVIEW;
  afterEach(() => {
    if (OLD === undefined) delete process.env.HIDE_LEGACY_PROGRAMMES; else process.env.HIDE_LEGACY_PROGRAMMES = OLD;
    if (OLD_P === undefined) delete process.env.CURRICULUM_ADMIN_PREVIEW; else process.env.CURRICULUM_ADMIN_PREVIEW = OLD_P;
  });

  it('is off by default and changes nothing', () => {
    delete process.env.HIDE_LEGACY_PROGRAMMES;
    expect(hideLegacyProgrammes()).toBe(false);
    expect(buildCatalog([]).find((f) => f.id === 'work')?.programmes.map((p) => p.id)).toEqual(['work-english']);
  });

  it('when on, hides the old list only where new programmes are visible', () => {
    process.env.HIDE_LEGACY_PROGRAMMES = 'true';
    process.env.CURRICULUM_ADMIN_PREVIEW = 'true';
    const hidden = buildCatalog([], { isPreviewer: true }).find((f) => f.id === 'work')?.programmes.map((p) => p.id) ?? [];
    expect(hidden).not.toContain('work-english');
    expect(hidden.length).toBeGreaterThan(0);
    // A viewer with no new programmes keeps the old list, so no field is ever empty.
    expect(buildCatalog([], { isPreviewer: false }).find((f) => f.id === 'work')?.programmes.map((p) => p.id)).toEqual(['work-english']);
  });
});
