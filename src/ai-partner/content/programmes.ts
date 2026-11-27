/**
 * JustSpeak AI Partner - learning programmes (phase 1, hand-seeded).
 * A programme is an ordered list of roleplay tasks. Content lives in code
 * (like roleplays and personas): no database tables, so adding this feature
 * cannot touch existing data. Progress is DERIVED from the learner's own
 * finished sessions, never stored separately.
 */

import type { PersonaId } from './personas';

/** Default pass mark on the 0-100 scale. Same as the 6/10 minimum shown in reports. */
export const DEFAULT_PASS_PCT = 60;

/**
 * Where a content item comes from and under what terms we use it.
 * Rule: only self-written material or sources with a verified open licence.
 * Never copy or reword third-party copyrighted text or word lists (for example
 * the Oxford 3000/5000/OPAL lists, whose terms forbid commercial use).
 */
export interface ContentSource {
  origin: 'self-written' | 'open-licence';
  /** Licence of the item itself, e.g. "Original JustSpeak content" or "CC BY-SA 4.0". */
  licence: string;
  /** Frameworks the design follows (ideas only, no text copied). */
  basedOn: string[];
  /** Attribution line to display when the licence requires one. */
  attribution?: string;
}

/** Our own writing, designed to the CEFR level scale and OxPoLL principles (ideas only). */
export const SELF_WRITTEN: ContentSource = {
  origin: 'self-written',
  licence: 'Original JustSpeak content',
  basedOn: ['CEFR level scale (Council of Europe)', 'Oxford Principles of Language Learning (ideas only)'],
};

export interface ProgrammeTaskDef {
  /** Provenance and licence; required on every task. */
  source: ContentSource;
  id: string;
  title: string;
  /** Existing roleplay scenario this task practises. */
  roleplayId: string;
  /** One warm, original line the coach says to the learner before the scene (our own writing). */
  coachLine: string;
  /** Pass mark 0-100; defaults to DEFAULT_PASS_PCT. */
  passPct?: number;
}

export interface ProgrammeDef {
  /** Provenance and licence; required on every programme. */
  source: ContentSource;
  id: string;
  title: string;
  description: string;
  level: string;
  tasks: ProgrammeTaskDef[];
}

/** Short trait chip shown on the roleplay partner card. */
export const PERSONA_TRAITS: Record<PersonaId, string> = {
  sara: 'Empathetic',
  adams: 'Demanding',
  rachel: 'Professional',
  sam: 'Friendly',
};

export const PROGRAMMES: ProgrammeDef[] = [
  {
    source: SELF_WRITTEN,
    id: 'everyday-a2-b1',
    title: 'Everyday English A2 to B1',
    description:
      'Short real-life conversations: small talk, making friends, eating out and travelling. Build confidence one scene at a time.',
    level: 'A2',
    tasks: [
      { source: SELF_WRITTEN, id: 'ee-1', coachLine: "Nothing fancy here, just two colleagues chatting. Tell me about your week and I'll keep it light.", title: 'Small talk with colleagues', roleplayId: 'small-talk-colleagues' },
      { source: SELF_WRITTEN, id: 'ee-2', coachLine: "Meeting new people is half nerves, half curiosity. Let's practise the curious half.", title: 'Making new friends', roleplayId: 'making-friends' },
      { source: SELF_WRITTEN, id: 'ee-3', coachLine: "I'm starving already. Let's order something good, and don't worry about getting every word perfect.", title: 'Ordering at a restaurant', roleplayId: 'restaurant-order' },
      { source: SELF_WRITTEN, id: 'ee-4', coachLine: 'Airports feel rushed, but you can take your time with me. Passport ready?', title: 'At the airport', roleplayId: 'at-the-airport' },
    ],
  },
  {
    source: SELF_WRITTEN,
    id: 'interview-ready-b1-b2',
    title: 'Job Interview Ready B1 to B2',
    description:
      'Practise answering a hiring manager, then handle sales and technical interviews with clear, structured answers.',
    level: 'B1',
    tasks: [
      { source: SELF_WRITTEN, id: 'ir-1', coachLine: 'Take a breath. Tell me about yourself like you would to a friend who happens to be hiring.', title: 'Customer service interview', roleplayId: 'customer-service-interview' },
      { source: SELF_WRITTEN, id: 'ir-2', coachLine: "Sales is about being clear and confident. Show me how you'd win me over in a few sentences.", title: 'Sales interview', roleplayId: 'sales-interview' },
      { source: SELF_WRITTEN, id: 'ir-3', coachLine: "I'll ask real questions, and you explain your thinking out loud. That's the skill that gets offers.", title: 'Software developer interview', roleplayId: 'software-developer-interview' },
      { source: SELF_WRITTEN, id: 'ir-4', coachLine: 'This one is a real conversation about how work is going. Honest and calm wins.', title: 'Manager performance review', roleplayId: 'manager-performance-review' },
    ],
  },
  {
    source: SELF_WRITTEN,
    id: 'travel-and-care-b1',
    title: 'Travel and Daily Life B1',
    description: 'Hotel check-in, doctor visits and the airport: the conversations you really need abroad.',
    level: 'B1',
    tasks: [
      { source: SELF_WRITTEN, id: 'tl-1', coachLine: "You've had a long trip. Let's get you checked in and sort out anything that's wrong with the room.", title: 'Hotel check-in', roleplayId: 'hotel-check-in' },
      { source: SELF_WRITTEN, id: 'tl-2', coachLine: "Describing how you feel in English is a useful skill. I'll be patient, take your time.", title: 'Doctor appointment', roleplayId: 'doctor-appointment' },
      { source: SELF_WRITTEN, id: 'tl-3', coachLine: "Last stop on this route. Let's make the airport easy.", title: 'At the airport', roleplayId: 'at-the-airport' },
    ],
  },
];
