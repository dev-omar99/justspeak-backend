import { buildCatalog, overallOf, CATALOG_LEVELS, FIELDS } from './catalog';
import { ROLEPLAY_SCENARIOS } from './content/roleplays';

const ok = (score: number) => ({ status: 'OK', overall_score: 99, dimensions: { grammar: score, vocabulary: score, fluency: score, pronunciation: score, interaction: score } });
const sess = (id: string, roleplayId: string, report: unknown, day: number) => ({
  id,
  roleplayId,
  report,
  createdAt: new Date(Date.UTC(2026, 10, day)),
});

describe('catalog', () => {
  it('every roleplay becomes exactly one lesson and every field lists all five levels', () => {
    const fields = buildCatalog([]);
    expect(fields).toHaveLength(FIELDS.length);
    for (const f of fields) for (const p of f.programmes) expect(p.levels.map((l) => l.level)).toEqual([...CATALOG_LEVELS]);
    const lessons = fields.flatMap((f) => f.programmes.flatMap((p) => p.levels.flatMap((l) => l.lessons)));
    expect(lessons).toHaveLength(ROLEPLAY_SCENARIOS.length);
    expect(new Set(lessons.map((l) => l.id)).size).toBe(lessons.length);
  });

  it('every lesson carries a source and licence', () => {
    const lessons = buildCatalog([]).flatMap((f) => f.programmes.flatMap((p) => p.levels.flatMap((l) => l.lessons)));
    for (const l of lessons) {
      expect(l.source.licence.length).toBeGreaterThan(0);
      expect(l.source.origin).toBe('self-written');
    }
  });

  it('attempts are oldest first with null for unmeasured scores; best score wins; 60 passes', () => {
    const rp = ROLEPLAY_SCENARIOS.find((r) => r.category === 'work')!;
    const f = buildCatalog([
      sess('s2', rp.id, ok(70), 5),
      sess('s1', rp.id, ok(50), 3),
      sess('s3', rp.id, { status: 'INSUFFICIENT_DATA', overall_score: 0 }, 6),
    ]).find((x) => x.id === 'work')!;
    const lesson = f.programmes[0].levels.flatMap((l) => l.lessons).find((l) => l.id === rp.id)!;
    expect(lesson.attempts.map((a) => a.sessionId)).toEqual(['s1', 's2', 's3']);
    expect(lesson.attempts.map((a) => a.score)).toEqual([50, 70, null]);
    expect(lesson.bestScore).toBe(70);
    expect(lesson.status).toBe('passed');
  });

  it('59 does not pass; recommended level is the first with an unpassed lesson', () => {
    const work = ROLEPLAY_SCENARIOS.filter((r) => r.category === 'work');
    const first = work[0];
    const f = buildCatalog([sess('a', first.id, ok(59), 1)]).find((x) => x.id === 'work')!;
    const lesson = f.programmes[0].levels.flatMap((l) => l.lessons).find((l) => l.id === first.id)!;
    expect(lesson.status).toBe('in_progress');
    expect(f.programmes[0].recommendedLevel).toBe(
      f.programmes[0].levels.find((l) => l.totalLessons > 0 && l.lessons.some((x) => x.status !== 'passed'))!.level,
    );
  });

  it('overall is the mean of the measured dimensions, null dimensions are left out', () => {
    expect(overallOf({ status: 'OK', overall_score: 99, dimensions: { grammar: 80, fluency: 60, pronunciation: null, vocabulary: 70, interaction: 50 } })).toBe(65);
    expect(overallOf({ status: 'OK', overall_score: 42, dimensions: {} })).toBeNull();
    expect(overallOf({ status: 'INSUFFICIENT_DATA', dimensions: { grammar: 80 } })).toBeNull();
    expect(overallOf(null)).toBeNull();
    expect(overallOf({ status: 'OK', dimensions: { grammar: 0 } })).toBe(0);
  });
});
