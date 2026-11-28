import { CURRICULUM_PROGRAMMES, getCurriculumScenario } from './index';
import { fullCreditText, lessonBeats } from './lesson-beats';

describe('lesson beats', () => {
  it('reads the full-credit part of both hint forms', () => {
    expect(fullCreditText('Full: names two tips. Partial: names one. Expect connected sentences.')).toBe('names two tips');
    expect(fullCreditText('Full credit: gives a clear answer. Partial credit: vague. No credit: silent.')).toBe('gives a clear answer');
    expect(fullCreditText('Name, background and one strength.')).toBe('Name, background and one strength');
  });

  it('builds role, one beat per rubric point, a difficulty and a close', () => {
    const beats = lessonBeats({
      personaRole: 'A senior engineer',
      goal: 'Explain a bug.',
      rubric: [{ label: 'States the bug', hint: 'Full: says what broke. Partial: vague.' }],
    });
    expect(beats).toHaveLength(4);
    expect(beats[0]).toContain('as a senior engineer');
    expect(beats[1]).toContain('"States the bug"');
    expect(beats[1]).toContain('says what broke');
    expect(beats[2]).toContain('Explain a bug');
    expect(beats[3]).toMatch(/^Close the scene/);
  });

  it('every one of the curriculum lessons gets its own beats (unique within its programme, no capital "as A")', () => {
    let count = 0;
    for (const p of CURRICULUM_PROGRAMMES) {
      const seen = new Set<string>();
      for (const l of Object.values(p.levels).flat()) {
        const sc = getCurriculumScenario(l.id)!;
        count++;
        expect(sc.targets.length).toBe(l.rubric.length + 3);
        expect(sc.targets.join(' ')).toContain(l.goal.trim().replace(/[.\s]+$/, ''));
        for (const r of l.rubric) expect(sc.targets.join(' ')).toContain(r.label.trim());
        expect(sc.targets.join(' ')).not.toMatch(/as An? [a-z]/);
        expect(l.personaRole).not.toMatch(/^Tips card/);
        seen.add(sc.targets.join('|'));
      }
      expect(seen.size).toBe(Object.values(p.levels).flat().length);
    }
    expect(count).toBe(980);
  });

  it('the tips-card lesson is scored like the others', () => {
    const l = Object.values(CURRICULUM_PROGRAMMES.find((p) => p.id.startsWith('interviews-customer-service'))!.levels).flat().find((x) => x.id === 'iv-cs-b1-u5-l3')!;
    expect(l.scored).not.toBe(false);
  });
});
