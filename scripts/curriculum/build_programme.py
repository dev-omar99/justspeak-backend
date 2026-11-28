#!/usr/bin/env python3
"""Build a curriculum programme data file from a compact text spec.

Usage: python3 build_programme.py specs/<name>.txt  (writes ../../src/ai-partner/content/curriculum/<id>.ts)

Spec format (all our own wording, one lesson per line):
  @programme id | fieldId | Title | Description | CEFR area used in the source line
  @level A1
  ## Unit title | Can-do description shown under each lesson
  Lesson title | s or a | Who the coach plays | Learner goal | rubric 1; rubric 2; rubric 3
Persona: s = sara (warm), a = adams (demanding). Every unit must have exactly 4 lessons.
"""
import json, re, sys, pathlib

TIERS = {
    'A1': 'Single words and short phrases are enough.',
    'A2': 'Short, simple sentences are enough; small mistakes are fine if the meaning is clear.',
    'B1': 'Connected sentences with a reason or example; minor errors that do not block meaning are fine.',
    'B2': 'Clear, well-organised answers with few errors that matter.',
    'C1': 'Fluent, precise and natural; judge tone and nuance too.',
}
PERSONA = {'s': 'sara', 'a': 'adams'}

def lower_first(t): return t[0].lower() + t[1:]

def build(spec_path):
    prog, level, unit, udesc, levels, counts = None, None, None, None, {}, {}
    n_in_unit = 0
    unit_no = {}
    for raw in pathlib.Path(spec_path).read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith('#!'): continue
        if line.startswith('@programme'):
            pid, fid, title, desc, area = [x.strip() for x in line[len('@programme'):].split('|')]
            prog = dict(id=pid, fieldId=fid, title=title, description=desc, version='0.1-draft', levels={})
            continue
        if line.startswith('@level'):
            level = line.split()[1]; prog['levels'][level] = []; unit_no[level] = 0; unit = None; continue
        if line.startswith('##'):
            if unit is not None: assert n_in_unit == 4, (level, unit, n_in_unit)
            unit, udesc = [x.strip() for x in line[2:].split('|')]
            unit_no[level] += 1; n_in_unit = 0; continue
        title, p, role, goal, rub = [x.strip() for x in line.split('|')]
        n_in_unit += 1
        labels = [r.strip() for r in rub.split(';')]
        assert 3 <= len(labels) <= 4, line
        prog['levels'][level].append({
            'id': f"{prog['id'].split('-')[0]}-{prog['id'].split('-')[1] if False else ''}".rstrip('-') or '',
            'title': title, 'unit': unit, 'description': udesc, 'persona': PERSONA[p], 'personaRole': role,
            'goal': goal,
            'rubric': [{'label': l, 'hint': f"Full credit if the learner clearly does this: {lower_first(l)}. Partial if tried but unclear. {TIERS[level]}"} for l in labels],
            'targets': [
                f"Open the scene in character as {role}: greet the learner and state your situation in one or two short sentences.",
                f"Let the learner work toward this goal: {goal}",
                "Keep the replies realistic and short; add one small difficulty so the learner has to respond, not just repeat.",
                f"Move through the rubric points naturally: {'; '.join(labels)}.",
                "Close the scene in character, then step out: name the one thing they did best and one thing to practise.",
            ],
            'level': level,
            'source': f"Self-written by JustSpeak; level and scale from CEFR ({area})",
            'licence': 'JustSpeak-owned', 'status': 'draft',
            '_u': unit_no[level], '_i': n_in_unit,
        })
    assert n_in_unit == 4
    short = prog['id'].replace('-english', '')
    for lv, ls in prog['levels'].items():
        for l in ls:
            l['id'] = f"{short}-{lv.lower()}-u{l.pop('_u')}-l{l.pop('_i')}"
    const = re.sub(r'[^A-Z0-9]+', '_', prog['id'].upper()).strip('_')
    out = pathlib.Path(__file__).resolve().parents[2] / 'src/ai-partner/content/curriculum' / f"{prog['id']}.ts"
    out.write_text(
        "/** Generated from the reviewed programme data (scripts/curriculum/build_programme.py; edit the spec, not this file). Draft until the owner approves each batch. */\n"
        "import type { CurriculumProgramme } from './types';\n\n"
        f"export const {const}: CurriculumProgramme = " + json.dumps(prog, indent=1, ensure_ascii=False) + ";\n")
    print(const, out.name, {k: len(v) for k, v in prog['levels'].items()})

if __name__ == '__main__': build(sys.argv[1])
