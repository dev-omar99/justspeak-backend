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

export interface ProgrammeTaskDef {
  id: string;
  title: string;
  /** Existing roleplay scenario this task practises. */
  roleplayId: string;
  /** Pass mark 0-100; defaults to DEFAULT_PASS_PCT. */
  passPct?: number;
}

export interface ProgrammeDef {
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
    id: 'everyday-a2-b1',
    title: 'Everyday English A2 to B1',
    description:
      'Short real-life conversations: small talk, making friends, eating out and travelling. Build confidence one scene at a time.',
    level: 'A2',
    tasks: [
      { id: 'ee-1', title: 'Small talk with colleagues', roleplayId: 'small-talk-colleagues' },
      { id: 'ee-2', title: 'Making new friends', roleplayId: 'making-friends' },
      { id: 'ee-3', title: 'Ordering at a restaurant', roleplayId: 'restaurant-order' },
      { id: 'ee-4', title: 'At the airport', roleplayId: 'at-the-airport' },
    ],
  },
  {
    id: 'interview-ready-b1-b2',
    title: 'Job Interview Ready B1 to B2',
    description:
      'Practise answering a hiring manager, then handle sales and technical interviews with clear, structured answers.',
    level: 'B1',
    tasks: [
      { id: 'ir-1', title: 'Customer service interview', roleplayId: 'customer-service-interview' },
      { id: 'ir-2', title: 'Sales interview', roleplayId: 'sales-interview' },
      { id: 'ir-3', title: 'Software developer interview', roleplayId: 'software-developer-interview' },
      { id: 'ir-4', title: 'Manager performance review', roleplayId: 'manager-performance-review' },
    ],
  },
  {
    id: 'travel-and-care-b1',
    title: 'Travel and Daily Life B1',
    description: 'Hotel check-in, doctor visits and the airport: the conversations you really need abroad.',
    level: 'B1',
    tasks: [
      { id: 'tl-1', title: 'Hotel check-in', roleplayId: 'hotel-check-in' },
      { id: 'tl-2', title: 'Doctor appointment', roleplayId: 'doctor-appointment' },
      { id: 'tl-3', title: 'At the airport', roleplayId: 'at-the-airport' },
    ],
  },
];
