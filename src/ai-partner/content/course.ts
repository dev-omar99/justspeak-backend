/**
 * JustSpeak AI Partner - speaking course content (v1).
 * Course map: 12 half-levels (A1.1 to C2.2), 40 lessons each.
 * v1 ships 3 fully authored sample lessons plus the map and the fixed
 * 7-step skeleton; remaining lessons are generated in half-level batches
 * per the generation spec and dropped into this file as data.
 */

export type HalfLevelId =
  | 'A1.1' | 'A1.2'
  | 'A2.1' | 'A2.2'
  | 'B1.1' | 'B1.2'
  | 'B2.1' | 'B2.2'
  | 'C1.1' | 'C1.2'
  | 'C2.1' | 'C2.2';

export const HALF_LEVELS: HalfLevelId[] = [
  'A1.1', 'A1.2', 'A2.1', 'A2.2', 'B1.1', 'B1.2',
  'B2.1', 'B2.2', 'C1.1', 'C1.2', 'C2.1', 'C2.2',
];

export const LESSONS_PER_HALF_LEVEL = 40;

export interface LessonLine {
  speaker: 'persona' | 'student';
  text: string;
}

export interface CourseLesson {
  id: string;
  halfLevel: HalfLevelId;
  index: number;
  title: string;
  goal: string;
  persona: 'sara' | 'adams' | 'rachel' | 'sam';
  warmup: string;
  targetLanguage: string[];
  guidedDialogue: LessonLine[];
  roleplay: string;
  freePractice: string[];
  quiz: string[];
  nextHook: string;
}

/**
 * Fixed lesson skeleton (every lesson, every level):
 * 1. Warm-up: one easy question about the lesson topic (30-60 seconds).
 * 2. Target language: 5 to 8 spoken phrases for the lesson goal, each
 *    with a one-line meaning and an example; the student repeats aloud.
 * 3. Guided dialogue: the persona leads a short scripted-style exchange
 *    using the target phrases; the student fills their part.
 * 4. Roleplay: an open scene with the persona using the target language
 *    naturally; the student drives it.
 * 5. Free practice: two open questions that need the target language.
 * 6. Mini-quiz: 3 spoken questions; the student answers aloud.
 * 7. Summary: what to practise before the next lesson (from the rubric).
 * Correction stays out of steps 1-5; the summary is where feedback lives.
 */
export const LESSON_SKELETON = [
  'warmup',
  'target-language',
  'guided-dialogue',
  'roleplay',
  'free-practice',
  'mini-quiz',
  'summary',
] as const;

export const SAMPLE_LESSONS: CourseLesson[] = [
  {
    id: 'A1.1-01',
    halfLevel: 'A1.1',
    index: 1,
    title: 'Introducing yourself',
    goal: 'Say who you are, where you are from, and ask the same back.',
    persona: 'sara',
    warmup: 'What is your name?',
    targetLanguage: [
      'My name is ... / I am ...',
      'I am from Cairo. / I live in Cairo.',
      'I am a student. / I work as a ...',
      'Nice to meet you.',
      'What about you?',
    ],
    guidedDialogue: [
      { speaker: 'persona', text: "Hi! I do not think we have met. I am Sara." },
      { speaker: 'student', text: '(say your name, and Nice to meet you)' },
      { speaker: 'persona', text: 'Nice to meet you too. Where are you from?' },
      { speaker: 'student', text: '(I am from ...)' },
      { speaker: 'persona', text: 'Oh, I love it there! And what do you do?' },
      { speaker: 'student', text: '(I am a ... / I work as a ...)' },
    ],
    roleplay:
      'You are at a welcome party. Sara is a new neighbour. Talk for two minutes: names, cities, jobs.',
    freePractice: ['Tell me about your family.', 'Who is your best friend?'],
    quiz: [
      'Say your name and city in one sentence.',
      'Ask me where I am from.',
      'Say what you do.',
    ],
    nextHook: 'Next lesson: numbers, ages and phone numbers.',
  },
  {
    id: 'B1.2-14',
    halfLevel: 'B1.2',
    index: 14,
    title: 'Talking about work experience',
    goal: 'Describe past jobs and responsibilities clearly (interview-ready).',
    persona: 'rachel',
    warmup: 'What was your first job, or your dream first job?',
    targetLanguage: [
      'I worked as a ... for two years.',
      'I was responsible for ...',
      'My main duty was ...',
      'I learned how to ...',
      'I had to deal with ...',
      'I am proud that I ...',
    ],
    guidedDialogue: [
      { speaker: 'persona', text: 'So, tell me about your last position.' },
      { speaker: 'student', text: '(I worked as a ...)' },
      { speaker: 'persona', text: 'And what were you responsible for?' },
      { speaker: 'student', text: '(I was responsible for ...)' },
      { speaker: 'persona', text: 'What did you learn there?' },
      { speaker: 'student', text: '(I learned how to ...)' },
    ],
    roleplay:
      'A real mini-interview with Rachel. She asks about your last two jobs and one problem you solved. She interrupts if you ramble.',
    freePractice: [
      'What did you dislike about that job?',
      'What would your old boss say about you?',
    ],
    quiz: [
      'Describe one old job in two sentences.',
      'Name two duties you had.',
      'Say one thing you are proud of.',
    ],
    nextHook: 'Next lesson: talking about future plans and ambitions.',
  },
  {
    id: 'C1.1-22',
    halfLevel: 'C1.1',
    index: 22,
    title: 'Defending an opinion',
    goal: 'State a position, defend it under pressure, concede a point gracefully.',
    persona: 'adams',
    warmup: 'Should companies allow fully remote work?',
    targetLanguage: [
      'I take the view that ...',
      'The strongest argument for ... is ...',
      'That is a fair point, but ...',
      'I would push back on that because ...',
      'The evidence suggests ...',
      'I can concede that ..., however ...',
    ],
    guidedDialogue: [
      { speaker: 'persona', text: 'Remote work. For or against?' },
      { speaker: 'student', text: '(I take the view that ...)' },
      { speaker: 'persona', text: 'And the strongest argument for your position?' },
      { speaker: 'student', text: '(The strongest argument is ...)' },
      { speaker: 'persona', text: 'Critics say teamwork dies remotely. Respond.' },
      { speaker: 'student', text: '(That is a fair point, but ...)' },
    ],
    roleplay:
      'A formal debate with Mr. Adams on a topic the student chooses from three cards. He challenges every weak argument.',
    freePractice: [
      'What opinion do most people around you disagree with? Defend it.',
      'Now argue the opposite side.',
    ],
    quiz: [
      'State an opinion in one sentence.',
      'Give your strongest argument.',
      'Concede one point against yourself.',
    ],
    nextHook: 'Next lesson: negotiating and compromise language.',
  },
];

/**
 * Generation spec for the remaining lessons (batches of one half-level
 * at a time, Claude Sonnet, human spot-check of 5 random lessons per
 * batch before publishing):
 * - Topic coverage per half-level: 8 everyday life, 8 work and study, 8
 *   social and relationships, 8 opinions and problems, 8 review/mixed.
 * - Target language must be spoken phrases, not grammar tables; vocabulary
 *   must match the level band (A1: top 1000 words; A2: 2000; B1: 3500;
 *   B2: 5500; C1+: unrestricted).
 * - Persona fit: Sam for A1-A2, Sara for A2-B2 everyday, Rachel for
 *   interview lessons, Mr. Adams for C1-C2.
 * - Every lesson ends with a hook naming the next lesson.
 */
export const LESSON_GENERATION_SPEC_VERSION = 1;

export function getLesson(id: string): CourseLesson | null {
  return SAMPLE_LESSONS.find((lesson) => lesson.id === id) ?? null;
}

export function getLessonsForHalfLevel(halfLevel: string): CourseLesson[] {
  return SAMPLE_LESSONS.filter((lesson) => lesson.halfLevel === halfLevel);
}
