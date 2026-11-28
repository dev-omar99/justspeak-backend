#!/usr/bin/env python3
"""Order the units inside each level from lexically easier to harder.

Rules (documented in docs/curriculum-vocabulary-method.md):
- The first unit of a level stays first (it is the level's introduction).
- Units named like a full practice or review stay last, in their original order.
- All other units are sorted by mean lexical difficulty (audit_progression.difficulty), easiest first; ties keep the original order.
- Lesson ids and lesson order inside a unit never change, so saved progress is unaffected.
"""
import json, re, statistics
from audit_progression import ROOT, LEVELS, load, difficulty

PIN_LAST = re.compile(r'full|whole|review|practice|mock|exam-style', re.I)
changes = []
for f in sorted(ROOT.glob('*.ts')):
    if f.name in ('index.ts', 'types.ts', 'vocabulary.ts') or f.name.endswith('.spec.ts'): continue
    s = f.read_text(); d = load(f)
    for lv in LEVELS:
        ls = d['levels'][lv]; units = {}
        for l in ls: units.setdefault(l['unit'], []).append(l)
        order = list(units)
        first, rest = order[0], order[1:]
        pinned = [u for u in rest if PIN_LAST.search(u)]
        movable = [u for u in rest if u not in pinned]
        movable.sort(key=lambda u: statistics.mean(difficulty(l) for l in units[u]))
        new = [first] + movable + pinned
        if new != order: changes.append((d['id'], lv, order, new))
        d['levels'][lv] = [l for u in new for l in units[u]]
    a = s.index('{', s.index('CurriculumProgramme ='))
    f.write_text(s[:a] + json.dumps(d, indent=1, ensure_ascii=False) + ';\n')
for pid, lv, o, n in changes: print(pid, lv, 'moved', sum(1 for a, b in zip(o, n) if a != b), 'units')
print('levels reordered:', len(changes))
