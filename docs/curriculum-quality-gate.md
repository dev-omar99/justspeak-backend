# Curriculum quality gate (draft programmes, all hidden)

Status: example answers below were written by the assistant. They have NOT been scored by the live model or by a teacher.
What is verified by tests: every lesson has a goal, a persona role, rubric labels, and a hint with full / partial / none wording; the scenario the coach and the report scorer receive carries those exact hints (curriculum.spec.ts).
What is NOT verified: that the model scores these answers the way the hints say. That needs a live session (Groq key) and a person.

## Sample lessons (one lower level, one B2/C1, per programme group)

| Lesson | Programme | Level |
|---|---|---|
| work-cs-a1-u1-l2 Saying your name and company | Customer Service | A1 |
| work-cs-c1-u1-l2 Rebuilding trust after a failure | Customer Service | C1 |
| iv-cs-a2-u1-l2 My study or work | Interview English | A2 |
| iv-cs-c1-u1-l2 Challenging your CV | Interview English | C1 |
| work-sales-a1-u1-l2 What do you sell? | Sales | A1 |
| work-sales-c1-u1-l2 Challenging politely | Sales | C1 |
| daily-life-a1-u1-l2 My name is... | Daily life (non-work) | A1 |
| daily-life-c1-u1-l2 Using humour | Daily life (non-work) | C1 |

## Example answers (for the voice pilot; expected result in brackets)

work-cs-c1-u1-l2
- Full: "Mr Hakim, your refund was promised for Monday and it did not arrive. That is our failure. I will call you myself on Thursday before noon and confirm the payment by email on Friday." (3 of 3)
- Partial: "I am sorry about the issue. We will do better next time." (names no failure, no dates: about 1 of 3)
- None: "Please calm down, sir. It is not my department." (0 of 3)

iv-cs-c1-u1-l2
- Full: "Yes, there is an eight-month gap. I left to care for my family. It was my decision, and I would plan it differently now. Since then I finished a customer-service course and volunteered at a call centre." (3 of 3)
- Partial: "I took some time off. My last manager was not helpful." (vague, blames: about 1 of 3)
- None: "That gap is not important." (0 of 3)

work-sales-c1-u1-l2
- Full: "I understand why you see it that way. May I suggest another view? Our last three clients saved 12 percent, which makes me wonder if the risk is smaller than it looks." (3 of 3)
- Partial: "Maybe, but studies show you are wrong." (blunt, no figure: about 1 of 3)
- None: "That is not true." (0 of 3)

iv-cs-a2-u1-l2
- Full: "I worked at a phone shop in Nasr City. I worked there for two years. I helped customers every day." (3 of 3)
- Partial: "Phone shop. Two years." (fragments, no place detail: about 2 of 3)
- None: "Work." (0 of 3)

work-cs-a1-u1-l2
- Full: "Hello. My name is Sam (slowly). Bright Telecom." If asked again, repeats the same words. (3 of 3)
- Partial: "Sam Bright" said fast, company shortened. (about 1 of 3)
- None: no answer. (0 of 3)

work-sales-a1-u1-l2
- Full: "We sell phones and chargers." (3 of 3)
- Partial: "This. This good." (about 1 of 3)
- None: silence. (0 of 3)

daily-life-a1-u1-l2
- Full: "My name is Omar. What is your name? Nice to meet you." (3 of 3)
- Partial: "Omar." (about 1 of 3)
- None: no answer. (0 of 3)

daily-life-c1-u1-l2
- Full: a short joke about the topic, a pause, then "Sorry, was that too much?" when the friend does not laugh. (3 of 3)
- Partial: a joke that is unclear and no check of the reaction. (about 1 of 3)
- None: no humour, or a joke at the friend's expense. (0 of 3)

## Still needs people (owner side)
1. An English teacher reads a sample of lessons (title, goal, role, rubric, hints) for level fit and natural wording.
2. A voice pilot: a real speaker runs the 8 lessons above with full, partial and none answers, and we compare the model's scores with the expected ones.
3. Hint depth: hand-written hints for the Sales, B2 and C1 labels are still short outside the sample lessons.
4. Source and licence: all lessons are self-written, JustSpeak-owned, status draft. Nothing is live.
