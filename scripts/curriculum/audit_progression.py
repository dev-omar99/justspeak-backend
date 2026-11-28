#!/usr/bin/env python3
"""Audit difficulty ordering of the curriculum drafts.

Method: lexical difficulty of a lesson = mean of (8 - Zipf frequency) over its content words
(title, goal, rubric labels). Zipf comes from the wordfreq library (Apache 2.0 code, data CC BY-SA 4.0;
see docs/curriculum-vocabulary-method.md). Names and stop words are skipped.
Checks: level means rise A1..C1; units inside a level do not get easier; lessons inside a unit do not get easier.
Usage: python3 audit_progression.py [--json out.json]
"""
import json, pathlib, re, statistics, sys
from wordfreq import zipf_frequency

ROOT = pathlib.Path(__file__).resolve().parents[2] / 'src/ai-partner/content/curriculum'
STOP = set('a an the and or of to in on at for with from by is are be it its this that his her him she he they them their your you my me we our us as if then than so not no do does did can will would could should may might one two three more most any all some into out up about after before over how what when where which who whom why'.split())
NAMES = set('mr mrs ms dr prof sara adams rachel sam hamdy hana karim layla salma ahmed mona samy hady rania dalia samir nour dina tarek mariam yusuf leila omar fathy adel rana hassan dina hakim sameh tamer samia wael heba karim'.split())
LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1']

def words(text):
    return [w for w in re.findall(r"[a-z]+", text.lower()) if len(w) > 2 and w not in STOP and w not in NAMES]

def difficulty(l):
    ws = words(' '.join([l['title'], l['goal']] + [r['label'] for r in l['rubric']]))
    return statistics.mean(8 - zipf_frequency(w, 'en') for w in ws) if ws else 0.0

def load(f):
    s = f.read_text(); return json.loads(s[s.index('{', s.index('CurriculumProgramme =')):s.rindex('};') + 1])

def main():
    report = {}
    for f in sorted(ROOT.glob('*.ts')):
        if f.name in ('index.ts', 'types.ts'): continue
        d = load(f); prog = {'levels': {}, 'unit_inversions': [], 'lesson_inversions': 0, 'lessons': 0}
        lvl_means = []
        for lv in LEVELS:
            ls = d['levels'][lv]; ds = [difficulty(l) for l in ls]
            prog['levels'][lv] = round(statistics.mean(ds), 3); lvl_means.append(statistics.mean(ds))
            units = {}
            for l, x in zip(ls, ds): units.setdefault(l['unit'], []).append((l['id'], x))
            um = [(u, statistics.mean(x for _, x in v)) for u, v in units.items()]
            for (u1, a), (u2, b) in zip(um, um[1:]):
                if b < a - 0.25: prog['unit_inversions'].append(f"{lv}: '{u2}' ({b:.2f}) easier than previous unit '{u1}' ({a:.2f})")
            prog['lessons'] += len(ls)
        prog['level_monotonic'] = all(b > a for a, b in zip(lvl_means, lvl_means[1:]))
        report[d['id']] = prog
    return report

if __name__ == '__main__':
    r = main()
    for pid, p in r.items():
        print(pid, p['levels'], 'monotonic' if p['level_monotonic'] else 'NOT-MONOTONIC', 'unit_inversions=', len(p['unit_inversions']))
        for x in p['unit_inversions'][:6]: print('   ', x)
    if '--json' in sys.argv: pathlib.Path(sys.argv[sys.argv.index('--json') + 1]).write_text(json.dumps(r, indent=1))
