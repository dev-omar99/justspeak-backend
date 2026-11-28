import {
  OFF_GOAL_CAP,
  dimensionMean,
  finaliseScores,
  parseSessionReport,
  reportOverall,
  type SessionReport,
} from './content/rubric';
import { reportScore } from './programmes.progress';
import { overallOf } from './catalog';

const dims = (g: number | null, v: number | null, f: number | null, p: number | null, i: number | null) => ({
  grammar: g, vocabulary: v, fluency: f, pronunciation: p, interaction: i,
});
const reply = (o: Record<string, unknown>) =>
  parseSessionReport(JSON.stringify({ status: 'OK', overall_score: 90, dimensions: dims(70, 70, 70, 70, 70), ...o })) as SessionReport;

describe('one overall score everywhere', () => {
  it('dimensionMean leaves unmeasured skills out and never counts them as 0', () => {
    expect(dimensionMean(dims(80, 60, null, 70, 50))).toBe(65);
    expect(dimensionMean(dims(null, null, null, null, null))).toBeNull();
    expect(dimensionMean(null)).toBeNull();
    expect(dimensionMean(dims(0, 0, 0, 0, 0))).toBe(0);
  });

  it('coherence is not part of the mean', () => {
    expect(dimensionMean({ ...dims(60, 60, 60, 60, 60), coherence: 100 })).toBe(60);
  });

  it('finaliseScores ignores the model overall and uses the mean of the skills', () => {
    const r = finaliseScores(reply({ overall_score: 95 }))!;
    expect(r.overall_score).toBe(70);
    expect(r.score_cap).toBeUndefined();
  });

  it('an OK answer with no measured skill is not a score (null, never 0 or 50)', () => {
    expect(finaliseScores(reply({ overall_score: 50, dimensions: dims(null, null, null, null, null) }))).toBeNull();
    const missing = parseSessionReport(JSON.stringify({ status: 'OK', dimensions: {} })) as SessionReport;
    expect(finaliseScores(missing)).toBeNull();
  });

  it('INSUFFICIENT_DATA passes through untouched', () => {
    const r = parseSessionReport(JSON.stringify({ status: 'INSUFFICIENT_DATA' })) as SessionReport;
    expect(finaliseScores(r)).toBe(r);
    expect(reportOverall(r)).toBeNull();
  });

  it('goal_met "no" caps a fluent off-topic score at 5.5/10 and records why', () => {
    const r = finaliseScores(reply({ dimensions: dims(85, 80, 85, 80, 80), lesson_result: { goal_met: ' No ', note: 'off topic' } }))!;
    expect(r.overall_score).toBe(OFF_GOAL_CAP);
    expect(r.score_cap).toMatchObject({ from: 82, to: OFF_GOAL_CAP });
    expect(reportOverall(r)).toBe(OFF_GOAL_CAP);
    expect(reportOverall(r)!).toBeLessThan(60);
  });

  it('the cap never raises a low score and "partly" or "yes" are not capped', () => {
    const low = finaliseScores(reply({ dimensions: dims(30, 30, 30, 30, 30), lesson_result: { goal_met: 'no', note: '' } }))!;
    expect(low.overall_score).toBe(30);
    expect(low.score_cap).toBeUndefined();
    for (const g of ['partly', 'yes', '']) {
      const r = finaliseScores(reply({ dimensions: dims(80, 80, 80, 80, 80), lesson_result: { goal_met: g, note: '' } }))!;
      expect(r.overall_score).toBe(80);
      expect(r.score_cap).toBeUndefined();
    }
  });

  it('the model cannot set the cap itself', () => {
    const r = reply({ score_cap: { from: 1, to: 1, reason: 'x' } });
    expect((r as any).score_cap).toBeUndefined();
  });

  it('every reader agrees: stored report, catalog, progress and dashboard use reportOverall', () => {
    const stored = finaliseScores(reply({ dimensions: dims(70, 60, 80, 50, 65), overall_score: 99 }))!;
    expect(reportOverall(stored)).toBe(65);
    expect(overallOf(stored)).toBe(65);
    expect(reportScore(stored)).toBe(65);
  });

  it('old reports without a cap still get the mean, not the model number', () => {
    const old = { status: 'OK', overall_score: 88, dimensions: dims(50, 50, 50, 50, 50) };
    expect(reportOverall(old)).toBe(50);
  });

  it('the pass line is 60 on the rounded mean, matching 6.0/10 on screen', () => {
    expect(reportOverall({ status: 'OK', dimensions: dims(59, 59, 60, 60, 59) })).toBe(59); // 59.4 fails
    expect(reportOverall({ status: 'OK', dimensions: dims(59, 59, 59, 59, 59) })).toBe(59);
    expect(reportOverall({ status: 'OK', dimensions: dims(60, 60, 60, 60, 59) })).toBe(60); // 59.8 rounds to 60, shown 6.0, passes
  });

  it('silent or very short sessions never produce a score', () => {
    expect(reportOverall({ status: 'INSUFFICIENT_DATA', dimensions: dims(80, 80, 80, 80, 80) })).toBeNull();
  });
});
