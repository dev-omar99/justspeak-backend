# Curriculum scripts

These Python tools build and check the curriculum programme files in `src/ai-partner/content/curriculum/`.
All lesson wording is our own. Every programme file is a hidden draft until `CURRICULUM_ENABLED` is turned on.

| Script | What it does |
|---|---|
| `build_programme.py specs/<name>.txt` | Builds one programme `.ts` file from a compact text spec. Spec format is in the file header. |
| `refine_hints.py` | Applies per-label coaching hints from `hints/<programme-id>-N.txt`. |
| `build_vocabulary.py` | Adds the vocabulary layer, easy to hard. Method: `docs/curriculum-vocabulary-method.md`. |
| `audit_progression.py` | Checks that difficulty rises A1 to C1 and inside units. Needs `pip install wordfreq`. |
| `reorder_units.py` | Re-orders units by measured difficulty. **Warning: it rewrites every programme file. Run it only on a clean branch and review the whole diff.** |

Folders: `specs/` (one spec per programme), `hints/`, `goals/` (session goals per programme).

Rules:
- Lesson ids are never renamed: learner progress is keyed on them.
- Every item carries a source and licence note. Never copy Oxford or other copyrighted text. CEFR gives levels and scales, not syllabi.
- Delete `scripts/curriculum/__pycache__` before committing.
- Quality gate: `docs/curriculum-quality-gate.md`.
