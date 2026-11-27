/**
 * JustSpeak AI Partner - roleplay scenarios (v1).
 * Yoodli-style goal-driven practice: every scenario has a persona with a
 * role, a concrete goal for the learner, a scoring rubric and the beats
 * the coach must cover. The live coach drives the scene; the learner has
 * a target, never an empty open mic.
 * Categories cover the sections on the setup screen; `targets` are the
 * questions/moments the coach works through roughly in order.
 */

import type { PersonaId } from './personas';
import { getCurriculumScenario } from './curriculum';

export type RoleplayCategory =
  | 'interview'
  | 'work'
  | 'travel'
  | 'daily-life'
  | 'academic';

export interface RoleplayScenario {
  id: string;
  category: RoleplayCategory;
  title: string;
  /** One line shown under the title on the picker card. */
  description: string;
  persona: PersonaId;
  /** Who the persona plays, shown on the persona card. */
  personaRole: string;
  /** Minimum CEFR the scene suits. */
  level: 'A1' | 'A2' | 'B1' | 'B2' | 'C1';
  /** The learner's target for the scene, in plain words. */
  goal: string;
  /** Yoodli-style rubric: checked while scoring the report. */
  rubric: { label: string; hint: string }[];
  /** Beats the coach moves through, roughly in order, one at a time. */
  targets: string[];
}

export const ROLEPLAY_SCENARIOS: RoleplayScenario[] = [
  // ---------------------------------------------------------- interview
  {
    id: 'customer-service-interview',
    category: 'interview',
    title: 'Customer Service Interview',
    description: 'Answer a hiring manager for a customer service role.',
    persona: 'rachel',
    personaRole: 'Hiring manager',
    level: 'B1',
    goal: 'Introduce yourself, prove you can handle an angry customer, and ask one smart question about the job.',
    rubric: [
      { label: 'Clear self-introduction', hint: 'Name, background and one strength in under 30 seconds.' },
      { label: 'Use a real example', hint: 'One specific story: what happened, what you did, what the result was.' },
      { label: 'Show empathy', hint: 'Acknowledge the customer’s feelings before solving the problem.' },
    ],
    targets: [
      'Warm opener: tell me about yourself and why customer service.',
      'A time you dealt with an angry or difficult customer: what did you do and what was the outcome?',
      'Roleplay moment: the coach plays an upset customer whose order is late; the learner responds live.',
      'A weakness or mistake and what you learned from it.',
      'Invite the learner to ask a question about the role.',
    ],
  },
  {
    id: 'software-developer-interview',
    category: 'interview',
    title: 'Software Developer Interview',
    description: 'Explain your experience and thinking to a tech lead.',
    persona: 'adams',
    personaRole: 'Engineering manager',
    level: 'B2',
    goal: 'Present your experience clearly, walk through one project in depth, and handle one problem-solving question out loud.',
    rubric: [
      { label: 'Structured answers', hint: 'Situation, task, action, result - in that order.' },
      { label: 'Think out loud', hint: 'Explain your reasoning, not just the final answer.' },
      { label: 'Precise vocabulary', hint: 'Name the actual tools and trade-offs, avoid vague “stuff”.' },
    ],
    targets: [
      'Opener: walk me through your background and main stack.',
      'Deep dive: pick one project - your role, the hardest problem, how you solved it.',
      'Problem-solving out loud: a small design question the learner reasons through.',
      'Teamwork: a conflict or code-review disagreement and how it ended.',
      'Invite questions about the team.',
    ],
  },
  {
    id: 'sales-interview',
    category: 'interview',
    title: 'Sales Interview',
    description: 'Convince a sales director you can win and keep clients.',
    persona: 'rachel',
    personaRole: 'Sales director',
    level: 'B2',
    goal: 'Show you understand a sales conversation: rapport, needs, pitch, and handling a no.',
    rubric: [
      { label: 'Numbers or specifics', hint: 'One concrete result: a target hit, a deal size, a rate.' },
      { label: 'Handle rejection', hint: 'Respond to a “no” with a question, not an argument.' },
      { label: 'Close clearly', hint: 'End with a direct, polite ask.' },
    ],
    targets: [
      'Opener: your sales story so far.',
      'Sell me this: the coach picks an everyday object and the learner pitches it.',
      'A deal you lost and what it taught you.',
      'Roleplay moment: the coach is a hesitant client who says “it is too expensive”.',
    ],
  },
  // --------------------------------------------------------------- work
  {
    id: 'manager-performance-review',
    category: 'work',
    title: 'Performance Review with Your Manager',
    description: 'Lead a structured review conversation and agree next steps.',
    persona: 'adams',
    personaRole: 'Your manager',
    level: 'B2',
    goal: 'Present your achievements, respond to feedback calmly, and agree on concrete next steps.',
    rubric: [
      { label: 'Actively listen', hint: 'Acknowledge feedback before responding to it.' },
      { label: 'Use evidence', hint: 'Back achievements with facts, not feelings.' },
      { label: 'Agree next steps', hint: 'Finish with who does what by when.' },
    ],
    targets: [
      'Manager opens: how do you feel this quarter went?',
      'Your two biggest achievements, with evidence.',
      'The manager raises one piece of critical feedback; respond without defensiveness.',
      'Agree goals and next steps for next quarter.',
    ],
  },
  {
    id: 'difficult-conversation-raise',
    category: 'work',
    title: 'Asking for a Raise',
    description: 'Make the case for a salary increase to a busy director.',
    persona: 'adams',
    personaRole: 'Finance director',
    level: 'C1',
    goal: 'State your case with evidence, handle pushback, and leave with a clear answer or a date.',
    rubric: [
      { label: 'Direct opening', hint: 'Say what you want in the first minute.' },
      { label: 'Evidence over emotion', hint: 'Results and market facts, not complaints.' },
      { label: 'Handle pushback', hint: 'Answer “not now” with a question or a proposal.' },
    ],
    targets: [
      'Open the conversation and state the request.',
      'Present your evidence: results, responsibilities, market.',
      'Pushback moment: “budgets are tight this year” - respond.',
      'Close with an agreement or a concrete follow-up date.',
    ],
  },
  {
    id: 'small-talk-colleagues',
    category: 'work',
    title: 'Small Talk with Colleagues',
    description: 'An easy coffee-break chat with a coworker you barely know.',
    persona: 'sara',
    personaRole: 'Coworker',
    level: 'A2',
    goal: 'Keep a light conversation going for five minutes: weekend, work, and one shared interest.',
    rubric: [
      { label: 'Ask questions back', hint: 'Never answer without returning a question.' },
      { label: 'Add one detail', hint: 'Each answer carries one extra fact or opinion.' },
    ],
    targets: [
      'Weekend opener: what did you get up to?',
      'Work chat: what are you working on this week?',
      'Find one shared interest and dig into it.',
    ],
  },
  // ------------------------------------------------------------- travel
  {
    id: 'at-the-airport',
    category: 'travel',
    title: 'At the Airport',
    description: 'Check in, fix a booking problem, and ask about your gate.',
    persona: 'sam',
    personaRole: 'Check-in agent',
    level: 'A2',
    goal: 'Check in for your flight, solve a seat problem, and confirm your gate and boarding time.',
    rubric: [
      { label: 'Polite requests', hint: 'Could I / Would it be possible, not “I want”.' },
      { label: 'Confirm details', hint: 'Repeat times and numbers back to be sure.' },
    ],
    targets: [
      'Check-in: passport, destination, bags.',
      'Problem moment: the window seat you booked is gone - negotiate a fix.',
      'Ask about the gate, boarding time and where to go next.',
    ],
  },
  {
    id: 'hotel-check-in',
    category: 'travel',
    title: 'Hotel Check-in and a Complaint',
    description: 'Check in, then get a problem in your room fixed.',
    persona: 'sam',
    personaRole: 'Receptionist',
    level: 'B1',
    goal: 'Check in smoothly, report a broken air conditioner, and get a clear promise or a new room.',
    rubric: [
      { label: 'Report problems politely but firmly', hint: 'State the issue, say what you need.' },
      { label: 'Get a commitment', hint: 'End with who will do what, and when.' },
    ],
    targets: [
      'Check-in: reservation name, nights, breakfast and wifi questions.',
      'Complaint moment: the air conditioning does not work - report it.',
      'Push for a solution: repair time or a room change.',
    ],
  },
  {
    id: 'restaurant-order',
    category: 'travel',
    title: 'At a Restaurant',
    description: 'Order a meal, handle a mix-up, and ask for the bill.',
    persona: 'sam',
    personaRole: 'Waiter',
    level: 'A2',
    goal: 'Order food and drink, fix a wrong order without stress, and pay.',
    rubric: [
      { label: 'Order politely', hint: 'I’ll have / Could I get, with please.' },
      { label: 'Fix mistakes calmly', hint: 'Point out the wrong dish and ask for the right one.' },
    ],
    targets: [
      'Drinks and starter order.',
      'Main course with one special request (no spicy, allergy, etc.).',
      'Mix-up moment: the waiter brings the wrong dish - correct it.',
      'Ask for the bill and thank the staff.',
    ],
  },
  // ---------------------------------------------------------- daily life
  {
    id: 'doctor-appointment',
    category: 'daily-life',
    title: 'At the Doctor',
    description: 'Describe your symptoms and understand the advice.',
    persona: 'rachel',
    personaRole: 'Doctor',
    level: 'B1',
    goal: 'Explain where it hurts, for how long, and how bad; then repeat the doctor’s instructions back.',
    rubric: [
      { label: 'Describe symptoms precisely', hint: 'Where, since when, how often, how strong.' },
      { label: 'Check understanding', hint: 'Ask when anything is unclear; repeat instructions back.' },
    ],
    targets: [
      'Opener: what brings you in today?',
      'History questions: since when, how often, what makes it worse?',
      'The doctor gives advice and medicine instructions - the learner repeats them back.',
    ],
  },
  {
    id: 'making-friends',
    category: 'daily-life',
    title: 'Meeting Someone New',
    description: 'A friendly chat with a neighbour you just met.',
    persona: 'sara',
    personaRole: 'New neighbour',
    level: 'A2',
    goal: 'Introduce yourself, find two things in common, and suggest meeting again.',
    rubric: [
      { label: 'Introduce yourself naturally', hint: 'Name, where you live, one thing about you.' },
      { label: 'Find common ground', hint: 'Notice shared interests and say so.' },
    ],
    targets: [
      'Introductions and where each of you lives.',
      'Hobbies and free time: find two shared interests.',
      'Suggest a coffee or another meet-up.',
    ],
  },
  // ----------------------------------------------------------- academic
  {
    id: 'ielts-speaking-part2',
    category: 'academic',
    title: 'IELTS Speaking Practice',
    description: 'A full mock: short questions, a 2-minute talk, discussion.',
    persona: 'adams',
    personaRole: 'IELTS examiner',
    level: 'B2',
    goal: 'Survive all three parts: fluent short answers, a structured long turn, and an opinion discussion.',
    rubric: [
      { label: 'Extend every answer', hint: 'Answer, reason, example - never one line.' },
      { label: 'Structured long turn', hint: 'Opening, two or three points, closing line.' },
      { label: 'Opinion language', hint: 'I believe / From my perspective / It depends.' },
    ],
    targets: [
      'Part 1: three short questions about home, work or study.',
      'Part 2: a cue card - the learner speaks for up to two minutes while the coach only listens.',
      'Part 3: two discussion questions that ask for opinions and comparisons.',
      'Quick feedback summary at the end.',
    ],
  },
];

export function getRoleplay(id: string | undefined | null): RoleplayScenario | null {
  if (!id) return null;
  return ROLEPLAY_SCENARIOS.find((r) => r.id === id) ?? getCurriculumScenario(id);
}

export function roleplaysByCategory(): Record<RoleplayCategory, RoleplayScenario[]> {
  const grouped = {} as Record<RoleplayCategory, RoleplayScenario[]>;
  for (const scenario of ROLEPLAY_SCENARIOS) {
    (grouped[scenario.category] ??= []).push(scenario);
  }
  return grouped;
}
