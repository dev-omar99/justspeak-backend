/**
 * Per-lesson coaching beats.
 *
 * Every curriculum lesson used to carry the same five template lines as its `targets`. The beats built here
 * come from the lesson's own role, goal and rubric, so each lesson tells the coach (and the report) what to
 * ask for and what full credit looks like. Plain data in, plain text out, so it is easy to test and review.
 */
import type { CurriculumLesson } from './types';

/** The "Full" part of a rubric hint, in our own words already ("Full: ... Partial: ..." or "Full credit ... Partial credit ..."). */
export function fullCreditText(hint: string): string {
  const m = hint.match(/Full(?:\s+credit)?\s*[:\-]?\s*([\s\S]*?)(?=\s*Partial(?:\s+credit)?\b|\s*No credit\b|$)/i);
  const text = (m ? m[1] : hint).trim().replace(/[.;\s]+$/, '');
  return text || hint.trim();
}

/** "A senior engineer" becomes "a senior engineer" mid-sentence; names and other starts are kept. */
function inSentence(role: string): string {
  return /^(A|An|The)\s/.test(role) ? role.charAt(0).toLowerCase() + role.slice(1) : role;
}

export function lessonBeats(lesson: Pick<CurriculumLesson, 'personaRole' | 'goal' | 'rubric'>): string[] {
  const beats: string[] = [
    `Open the scene in character as ${inSentence(lesson.personaRole.trim())}: greet the learner and set the situation in one or two short sentences.`,
  ];
  lesson.rubric.forEach((r, i) => {
    beats.push(
      `Point ${i + 1}, "${r.label.trim()}": ask or prompt so the learner can show it. Full credit looks like: ${fullCreditText(r.hint)}.`,
    );
  });
  beats.push(
    `Add one small, realistic difficulty tied to the goal ("${lesson.goal.trim().replace(/[.\s]+$/, '')}") so the learner has to respond, not just repeat.`,
  );
  beats.push('Close the scene in character, then step out: name the one thing they did best and one thing to practise.');
  return beats;
}
