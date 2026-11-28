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

/** Instruction added to the report prompt so the assessor says which checklist points were covered. */
export function checklistReportInstruction(rubric: ChecklistItem[]): string {
  const labels = rubric.map((r) => r.label.trim()).filter(Boolean).slice(0, MAX_CHECKLIST_ITEMS);
  if (labels.length === 0) return '';
  return `Also add a top-level "checklist" array to the JSON: one {"label": <exact label>, "covered": true or false} for each of these points, in this order: ${labels.map((l) => `"${l}"`).join(', ')}. "covered" is true only if the transcript shows the learner was actually asked about it or spoke to it.\n\n`;
}

/**
 * Keep only the model's answers for the real checklist labels, in checklist order. Labels the model did not
 * answer are left out (never guessed), so the report can only claim what was returned.
 */
export function alignChecklist(
  returned: { label: string; covered: boolean }[] | undefined,
  rubric: ChecklistItem[],
): { label: string; covered: boolean }[] | undefined {
  if (!returned || returned.length === 0) return undefined;
  const byLabel = new Map(returned.map((r) => [r.label.trim().toLowerCase(), r.covered]));
  const out = rubric
    .map((r) => r.label.trim())
    .filter(Boolean)
    .slice(0, MAX_CHECKLIST_ITEMS)
    .filter((l) => byLabel.has(l.toLowerCase()))
    .map((l) => ({ label: l, covered: byLabel.get(l.toLowerCase()) as boolean }));
  return out.length > 0 ? out : undefined;
}
