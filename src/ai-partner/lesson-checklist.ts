/**
 * Lesson question checklist.
 *
 * Every scored lesson already carries an ordered rubric (what the learner must show). The checklist turns
 * those points into a short list the coach must cover before it closes the scene, so no lesson goal is
 * skipped. It is plain data in, plain text out, so it is easy to unit-test and to review.
 */
export interface ChecklistItem {
  label: string;
}

/** At most this many items are listed, so the prompt stays short on full-call scenes. */
export const MAX_CHECKLIST_ITEMS = 6;

export function buildChecklistPrompt(rubric: ChecklistItem[]): string {
  const items = rubric
    .map((r) => r.label.trim())
    .filter((l) => l.length > 0)
    .slice(0, MAX_CHECKLIST_ITEMS);
  if (items.length === 0) return '';
  const list = items.map((l, i) => `${i + 1}. ${l}`).join('\n');
  return `\nChecklist: before you close the scene, make sure the conversation has given the learner a real chance to show each of these, one at a time, in a natural question or prompt of your own (never read the list aloud, never skip one):\n${list}`;
}
