/**
 * Curriculum loader. Programmes are hidden unless CURRICULUM_ENABLED=true (staging / preview),
 * so production behaves exactly as before until the owner approves the batches.
 * Lessons become roleplay scenarios (same shape the live coach already uses), so no change is
 * needed in the session, report or recording code.
 */
import type { RoleplayScenario } from '../roleplays';
import { INTERVIEW_ENGLISH_CS } from './interviews-customer-service-interview-english';
import { WORK_CUSTOMER_SERVICE } from './work-customer-service';
import { SALES_ENGLISH } from './work-sales';
import { DAILY_LIFE } from './daily-life-everyday';
import { TRAVEL_CONVERSATIONS } from './travel-conversations';
import { ACADEMIC_ENGLISH_COURSE } from './academic-english-course';
import { WORKPLACE_ENGLISH_COURSE } from './workplace-english-course';
import { INTERVIEWS_SALES_INTERVIEW_ENGLISH } from './interviews-sales-interview-english';
import type { CurriculumLesson, CurriculumProgramme } from './types';

export const CURRICULUM_PROGRAMMES: CurriculumProgramme[] = [WORK_CUSTOMER_SERVICE, SALES_ENGLISH, INTERVIEW_ENGLISH_CS, DAILY_LIFE, TRAVEL_CONVERSATIONS, ACADEMIC_ENGLISH_COURSE, WORKPLACE_ENGLISH_COURSE, INTERVIEWS_SALES_INTERVIEW_ENGLISH];

/** Global switch: every user sees every lesson (only for a full launch or a throwaway staging). */
export function curriculumEnabled(): boolean {
  return process.env.CURRICULUM_ENABLED === 'true';
}

/**
 * Admin-only preview switch: with CURRICULUM_ADMIN_PREVIEW=true the draft lessons are visible
 * to the single admin account only (the caller proves that with {@link CurriculumViewer}).
 */
export function curriculumAdminPreviewEnabled(): boolean {
  return process.env.CURRICULUM_ADMIN_PREVIEW === 'true';
}

/**
 * Extra preview accounts: CURRICULUM_PREVIEW_EMAILS="a@x.com,b@y.com". Empty by default, so only the
 * admin sees draft lessons. Matching is case-insensitive on the whole address. Only works while
 * CURRICULUM_ADMIN_PREVIEW=true. Never makes anything visible to other users.
 */
export function isPreviewAllowlisted(email: string | null | undefined): boolean {
  const mail = (email || '').trim().toLowerCase();
  if (!mail) return false;
  return (process.env.CURRICULUM_PREVIEW_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .includes(mail);
}

/** Who is asking. `isPreviewer` is true only for the configured admin account. */
export interface CurriculumViewer {
  isPreviewer: boolean;
}

/** Which lessons a viewer can see: all if the global flag is on, drafts for the admin previewer, else only "live". */
export function lessonVisible(l: CurriculumLesson, viewer?: CurriculumViewer): boolean {
  if (curriculumEnabled() || l.status === 'live') return true;
  return curriculumAdminPreviewEnabled() && viewer?.isPreviewer === true;
}

/** True when this id belongs to a curriculum lesson (draft or live). */
export function isCurriculumLessonId(id: string): boolean {
  return CURRICULUM_PROGRAMMES.some((p) => Object.values(p.levels).flat().some((l) => l.id === id));
}

/** Can this viewer start the given lesson id? (Non-curriculum ids are not this module's business.) */
export function canStartCurriculumLesson(id: string, viewer?: CurriculumViewer): boolean {
  const l = CURRICULUM_PROGRAMMES.flatMap((p) => Object.values(p.levels).flat()).find((x) => x.id === id);
  return !l || lessonVisible(l, viewer);
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

/** All curriculum lessons visible to the viewer, as roleplay scenarios (none in production until lessons are "live"). */
export function curriculumScenarios(viewer?: CurriculumViewer): RoleplayScenario[] {
  return allScenarios().filter((s) => visibleIds(viewer).has(s.id));
}

function visibleIds(viewer?: CurriculumViewer): Set<string> {
  return new Set(
    CURRICULUM_PROGRAMMES.flatMap((p) => Object.values(p.levels).flat())
      .filter((l) => lessonVisible(l, viewer))
      .map((l) => l.id),
  );
}

function allScenarios(): RoleplayScenario[] {
  return CURRICULUM_PROGRAMMES.flatMap((p) =>
    Object.values(p.levels).flat().map((l) => toScenario(l, p.fieldId)),
  );
}

/**
 * Resolve a lesson for an EXISTING session (coach and report). Visibility is enforced when the
 * session is created and in the catalog, so a started session keeps working even if the flag flips.
 */
export function getCurriculumScenario(id: string): RoleplayScenario | null {
  return allScenarios().find((s) => s.id === id) ?? null;
}
