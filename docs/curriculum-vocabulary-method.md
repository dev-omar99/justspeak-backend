# Curriculum ordering and vocabulary method

Status: hidden drafts, admin preview only. Nothing here is live. No teacher has reviewed it.

## Sources and licences (what was and was not used)
- CEFR level descriptors (Council of Europe): used only as the level frame, in our own wording. No syllabus text is copied.
- wordfreq 3.1.1: code Apache 2.0, data CC BY-SA 4.0 (it combines Wikipedia, OpenSubtitles, SUBTLEX, Google Books Ngrams, news and web text). Used only at build time to measure our own words. Its list is not stored or shipped. Attribution: "Frequency tiers measured with wordfreq (Robyn Speer et al.), data CC BY-SA 4.0."
- NGSL: not used. Its licence text could not be read, so we do not claim it.
- No Oxford list, no other licensed list, no Yoodli material.

## Method
1. Lesson difficulty = mean of (8 minus Zipf frequency) over the content words of title, goal and rubric labels. Names and stop words are skipped. This is a proxy: topic words (receipt, timetable) raise it.
2. `scripts/curriculum/audit_progression.py` checks level means, unit order inside a level and lesson order inside a unit.
3. `scripts/curriculum/reorder_units.py` orders units inside each level easiest first. The first unit of a level stays first. Full-call, review, practice and mock units stay last. Lesson ids and lesson order inside a unit are unchanged, so saved progress is safe. The u-number in an id may no longer match the unit position.
4. `scripts/curriculum/build_vocabulary.py` writes `vocabulary.ts`: per programme and level, new words (not used at earlier levels), tier 1 (Zipf 5.0 or more) to tier 5 (below 3.5), easiest first, with the first lesson id; plus a phrase bank from the rubric labels in order of first use.

## Limits
- Level means still dip at B2 to C1 for interviews, travel and sales. Levels were not rebuilt.
- Some inversions remain because of the pinned first and last units.
- Words are surface forms, not lemmas. Frequency is general English, not learner or business English.
