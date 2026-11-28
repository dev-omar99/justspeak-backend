import { buildChecklistPrompt, MAX_CHECKLIST_ITEMS } from './lesson-checklist';

describe('lesson checklist', () => {
  it('numbers the rubric labels in order', () => {
    const out = buildChecklistPrompt([{ label: 'Says name' }, { label: 'Gives a reason' }]);
    expect(out).toContain('1. Says name\n2. Gives a reason');
    expect(out).toContain('never read the list aloud');
  });
  it('returns nothing for an empty rubric and ignores blank labels', () => {
    expect(buildChecklistPrompt([])).toBe('');
    expect(buildChecklistPrompt([{ label: '  ' }])).toBe('');
  });
  it('caps the list', () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ label: `Point ${i + 1}` }));
    const lines = buildChecklistPrompt(many).split('\n').filter((l) => /^\d+\. /.test(l));
    expect(lines).toHaveLength(MAX_CHECKLIST_ITEMS);
  });
});

import { alignChecklist, checklistReportInstruction } from './lesson-checklist';
describe('report checklist', () => {
  const rubric = [{ label: 'Says name' }, { label: 'Gives a reason' }];
  it('keeps only real labels in rubric order and never invents answers', () => {
    const out = alignChecklist([{ label: 'gives a reason', covered: false }, { label: 'Made up', covered: true }, { label: 'Says name', covered: true }], rubric);
    expect(out).toEqual([{ label: 'Says name', covered: true }, { label: 'Gives a reason', covered: false }]);
    expect(alignChecklist([{ label: 'Says name', covered: true }], rubric)).toEqual([{ label: 'Says name', covered: true }]);
    expect(alignChecklist(undefined, rubric)).toBeUndefined();
    expect(alignChecklist([{ label: 'Other', covered: true }], rubric)).toBeUndefined();
  });
  it('asks for the labels in the report prompt', () => {
    expect(checklistReportInstruction(rubric)).toContain('"Says name", "Gives a reason"');
    expect(checklistReportInstruction([])).toBe('');
  });
});
