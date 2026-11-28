#!/usr/bin/env python3
"""Rewrite every rubric hint from the lesson's own goal and the level's standard.

A hint says what full, partial and no credit look like for THAT point in THAT scene.
Hand-written hints per label live in hints/*.txt, one per line as `Label | Full: ... Partial: ...`;
they win over the generated text (the level standard is appended). Run: python3 refine_hints.py (rewrites the data files in place).
"""
import json, pathlib

TIERS = {
    'A1': 'Judge meaning only: single words and short phrases are enough.',
    'A2': 'Short, simple sentences are enough; small mistakes are fine if the meaning is clear.',
    'B1': 'Expect connected sentences with a reason or an example; small errors that do not block meaning are fine.',
    'B2': 'Expect clear, well-organised answers; only errors that change or hide the meaning matter.',
    'C1': 'Expect fluent, precise and natural speech; judge tone and nuance as well as accuracy.',
}
SHORTEN = {
    'Ends with a clear statement of the problem': 'States the problem clearly',
    'Corrects the summary if the customer says no': 'Fixes the summary if told no',
    'Offers an alternative (name, email, phone)': 'Offers another contact option',
    'Does not share account details before checking': 'Checks identity before sharing details',
    'Stays on the line until the handover is done': 'Stays on the line to hand over',
}
GOAL_FIX = {'Ask for her name and ask her to spell it, then check it.': 'Ask for her name, ask her to spell it, then check it.'}
root = pathlib.Path(__file__).resolve().parents[2] / 'src/ai-partner/content/curriculum'
over = {}
for hf in sorted(pathlib.Path(__file__).with_name('hints').glob('*.txt')):
    for ln in hf.read_text().splitlines():
        if ' | ' in ln:
            k, v = ln.split(' | ', 1)
            over[k.strip().lower()] = v.strip()

def lf(t): return t if t[:1] in '"\'' or t[:2].isupper() else t[:1].lower() + t[1:]

total = 0
for f in sorted(root.glob('*.ts')):
    if f.name in ('index.ts', 'types.ts'): continue
    s = f.read_text(); a = s.index('{', s.index('CurriculumProgramme =')); b = s.rindex('};') + 1
    d = json.loads(s[a:b])
    for lv in d['levels'].values():
        for l in lv:
            old_goal = l['goal']; l['goal'] = GOAL_FIX.get(old_goal, old_goal)
            if l['goal'] != old_goal: l['targets'] = [t.replace(old_goal, l['goal']) for t in l['targets']]
            for r in l['rubric']:
                if r['label'] in SHORTEN:
                    l['targets'] = [t.replace(r['label'], SHORTEN[r['label']]) for t in l['targets']]
                    r['label'] = SHORTEN[r['label']]
                key = r['label'].lower()
                goal = l['goal'].rstrip('.')
                r['hint'] = (f"{over[key]} {TIERS[l['level']]}" if key in over else (
                    f"Scene goal: {lf(goal)}. Full credit if the learner clearly shows: {lf(r['label'])}. "
                    f"Partial credit if they try but it is unclear or incomplete. No credit if it does not happen. {TIERS[l['level']]}"))
                total += 1
    f.write_text(s[:a] + json.dumps(d, indent=1, ensure_ascii=False) + s[b:])
print('hints rewritten:', total)
