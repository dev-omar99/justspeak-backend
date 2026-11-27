# JustSpeak programme method (standard for every specialty)

Decided by Omar, 27 Nov 2026. Applies to Customer Service first, then Sales, Travel, Daily life and every other programme.

1. **Structure.** Field > programme > level (A1 to C1) > unit > lesson. A programme is complete from A1 to C1. Each unit has 4 lessons; the number of units per level follows the scenario list (not a fixed count).
2. **Scenario list first.** Before writing lessons, write the full list of situations a person in that job or area meets (for Customer Service: 29). The list is our own, built from the job itself. The user adds situations from real experience.
3. **Coverage map.** Every scenario maps to lessons at suitable levels (usually an early simple version and a later harder one). A script checks that each mapped title exists at that level. Gaps are fixed by adding units, never by deleting content.
4. **Sources and honesty.** Levels and communication scales come from the CEFR pages (Council of Europe). Topics are our own design. Record which sources were actually opened and which were not. Compare each can-do with the full CEFR descriptors before launch.
5. **Content rules.** Every unit and lesson has source and licence ("self-written", "JustSpeak-owned"). No copied word lists or text (no Oxford, no Yoodli). Roleplay: persona, scenario, goal, 3-point rubric, pass 6/10.
6. **Data.** One file per programme, `src/ai-partner/curriculum/<field>-<programme>.json`, following the template in the outline. A unit test checks 4 lessons per unit, sources, and rubric.
7. **Release.** Batches of about 8 lessons, additive only, rollback tag per batch, production check, user approval before each batch goes live. Status flow: draft > reviewed > live.
