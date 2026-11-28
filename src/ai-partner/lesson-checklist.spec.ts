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
