import { buildProgrammes, reportScore } from './programmes.progress';
import { PROGRAMMES } from './content/programmes';
import { ROLEPLAY_SCENARIOS } from './content/roleplays';

const ok = (score: number) => ({ status: 'OK', overall_score: score });

describe('programmes', () => {
  it('every seeded task points at an existing roleplay', () => {
    const ids = new Set(ROLEPLAY_SCENARIOS.map((r) => r.id));
    for (const p of PROGRAMMES) for (const t of p.tasks) expect(ids.has(t.roleplayId)).toBe(true);
  });

  it('only real numeric OK reports have a score; 0 is a real score, missing is null', () => {
    expect(reportScore(ok(0))).toBe(0);
    expect(reportScore(ok(72))).toBe(72);
    expect(reportScore({ status: 'INSUFFICIENT_DATA', overall_score: 0 })).toBeNull();
    expect(reportScore(null)).toBeNull();
    expect(reportScore({ status: 'OK' })).toBeNull();
    expect(reportScore({ status: 'OK', overall_score: 'x' })).toBeNull();
  });

  it('new user: nothing started, all steps to go, next task is the first', () => {
    const [p] = buildProgrammes(PROGRAMMES, []);
    expect(p.tasks.every((t) => t.status === 'not_started')).toBe(true);
    expect(p.stepsToGo).toBe(p.totalTasks);
    expect(p.nextTaskId).toBe(p.tasks[0].id);
  });

  it('59 does not pass and 60 passes the default mark', () => {
    const rp = PROGRAMMES[0].tasks[0].roleplayId;
    const low = buildProgrammes(PROGRAMMES, [{ roleplayId: rp, report: ok(59) }])[0];
    expect(low.tasks[0].status).toBe('in_progress');
    const hit = buildProgrammes(PROGRAMMES, [{ roleplayId: rp, report: ok(60) }])[0];
    expect(hit.tasks[0].status).toBe('passed');
    expect(hit.passedTasks).toBe(1);
    expect(hit.nextTaskId).toBe(hit.tasks[1].id);
  });

  it('best score across attempts wins; an unmeasured session is in progress, not passed', () => {
    const rp = PROGRAMMES[0].tasks[0].roleplayId;
    const t = buildProgrammes(PROGRAMMES, [
      { roleplayId: rp, report: ok(40) },
      { roleplayId: rp, report: ok(75) },
    ])[0].tasks[0];
    expect(t.bestScore).toBe(75);
    expect(t.attempts).toBe(2);
    const un = buildProgrammes(PROGRAMMES, [{ roleplayId: rp, report: { status: 'INSUFFICIENT_DATA', overall_score: 0 } }])[0].tasks[0];
    expect(un.status).toBe('in_progress');
    expect(un.bestScore).toBeNull();
  });

  it('partner card carries name, role and trait', () => {
    const t = buildProgrammes(PROGRAMMES, [])[0].tasks[0];
    expect(t.partner.name).toBe('Emma Clarke');
    expect(t.partner.trait).toBe('Empathetic');
    expect(t.partner.title.length).toBeGreaterThan(0);
    expect(t.coachLine.length).toBeGreaterThan(20);
  });

  it('every programme and task declares its source and licence; no Oxford list is embedded', () => {
    for (const p of PROGRAMMES) {
      for (const item of [p, ...p.tasks]) {
        expect(['self-written', 'open-licence']).toContain(item.source.origin);
        expect(item.source.licence.length).toBeGreaterThan(0);
        if (item.source.origin === 'open-licence') expect(item.source.attribution).toBeTruthy();
      }
    }
    const view = buildProgrammes(PROGRAMMES, [])[0];
    expect(view.source.licence).toBeTruthy();
    expect(view.tasks[0].source.licence).toBeTruthy();
  });
});
