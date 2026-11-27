/**
 * Curriculum programme data format. One file per programme; adding a programme is adding a data
 * file plus one line in index.ts. Every lesson carries its source and licence.
 */
export type CurriculumLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1';
export type CurriculumStatus = 'draft' | 'reviewed' | 'live';

export interface CurriculumLesson {
  id: string;
  title: string;
  /** Unit title the lesson belongs to (4 lessons per unit). */
  unit: string;
  /** The unit's can-do goal, shown under the lesson title. */
  description: string;
  persona: 'sara' | 'adams' | 'rachel' | 'sam';
  /** Who the coach plays in the scene. */
  personaRole: string;
  goal: string;
  rubric: { label: string; hint: string }[];
  targets: string[];
  level: CurriculumLevel;
  source: string;
  licence: string;
  status: CurriculumStatus;
  /** false for tips-card lessons that are not scored. */
  scored?: boolean;
}

export interface CurriculumProgramme {
  id: string;
  fieldId: string;
  title: string;
  description: string;
  version: string;
  levels: Record<CurriculumLevel, CurriculumLesson[]>;
  answerKeys?: Record<string, { expression: string; sentence: string; answer: string }[]>;
}
