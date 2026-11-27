/**
 * Curriculum loader. Programmes are hidden unless CURRICULUM_ENABLED=true (staging / preview),
 * so production behaves exactly as before until the owner approves the batches.
 * Lessons become roleplay scenarios (same shape the live coach already uses), so no change is
 * needed in the session, report or recording code.
 */
import type { RoleplayScenario } from '../roleplays';
import { INTERVIEW_ENGLISH_CS } from './interviews-customer-service-interview-english';
import { WORK_CUSTOMER_SERVICE } from './work-customer-service';
import type { CurriculumLesson, CurriculumProgramme } from './types';

export const CURRICULUM_PROGRAMMES: CurriculumProgramme[] = [WORK_CUSTOMER_SERVICE, INTERVIEW_ENGLISH_CS];

export function curriculumEnabled(): boolean {
  return process.env.CURRICULUM_ENABLED === 'true';
}

/** Which lessons users can see: all of them on staging, only status "live" otherwise. */
export function lessonVisible(l: CurriculumLesson): boolean {
  return curriculumEnabled() || l.status === 'live';
}

function toScenario(l: CurriculumLesson, field: string): RoleplayScenario {
  return {
    id: l.id,
    category: field as RoleplayScenario['category'],
    title: l.title,
    description: l.description,
    persona: l.persona,
    personaRole: l.personaRole,
    level: l.level,
    goal: l.goal,
    rubric: l.rubric,
    targets: l.targets,
  };
}

/** All visible curriculum lessons as roleplay scenarios (empty in production until lessons are "live"). */
export function curriculumScenarios(): RoleplayScenario[] {
  return CURRICULUM_PROGRAMMES.flatMap((p) =>
    Object.values(p.levels)
      .flat()
      .filter(lessonVisible)
      .map((l) => toScenario(l, p.fieldId)),
  );
}

export function getCurriculumScenario(id: string): RoleplayScenario | null {
  return curriculumScenarios().find((s) => s.id === id) ?? null;
}
