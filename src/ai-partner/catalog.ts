/**
 * Learning catalog: Field > Programme > Level > Lesson > Attempts.
 *
 * Deliberately simple and additive (no database change):
 * - A Field is one specialty (Work, Travel, ...). One field per roleplay category.
 * - Each field has one Programme (more can be added to FIELDS later).
 * - Levels are the CEFR steps A1 to C1. Every programme always lists all five;
 *   a level with no lessons yet is marked empty so the app shows "coming soon".
 * - A Lesson is an existing roleplay scenario (fixed scenario, goal and rubric),
 *   placed at the roleplay's own level and kept in catalogue order.
 * - An Attempt is a stored session of that roleplay. Its score is the report's
 *   overall score (0-100). A missing or unmeasured score is null, never 0.
 * Progress rules are the same as programmes: pass mark 60, best score wins.
 * All lessons are our own writing (see content/roleplays.ts).
 */

import { ROLEPLAY_SCENARIOS, type RoleplayCategory, type RoleplayScenario } from './content/roleplays';
import type { CurriculumLesson } from './content/curriculum/types';
import { DEFAULT_PASS_PCT, PROGRAMMES, SELF_WRITTEN, type ContentSource } from './content/programmes';
import { reportScore } from './programmes.progress';
import { getPersona } from './content/personas';
import { CURRICULUM_PROGRAMMES, lessonVisible } from './content/curriculum';

export const CATALOG_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1'] as const;
export type CatalogLevel = (typeof CATALOG_LEVELS)[number];

export interface FieldDef {
  id: string;
  title: string;
  /** Roleplay category whose scenarios become this field's lessons. */
  category: RoleplayCategory;
  programmeTitle: string;
  programmeDescription: string;
}

/** The specialties shown on the AI Partner home. Order is display order. */
export const FIELDS: FieldDef[] = [
  { id: 'work', title: 'Work', category: 'work', programmeTitle: 'Workplace English', programmeDescription: 'Everyday conversations with colleagues and managers.' },
  { id: 'travel', title: 'Travel', category: 'travel', programmeTitle: 'Travel English', programmeDescription: 'Airports, hotels and restaurants abroad.' },
  { id: 'academic', title: 'Academic', category: 'academic', programmeTitle: 'Academic English', programmeDescription: 'Speaking tasks for study and exams.' },
  { id: 'interviews', title: 'Interviews', category: 'interview', programmeTitle: 'Interview English', programmeDescription: 'Answer a hiring manager with clear, structured answers.' },
  { id: 'daily-life', title: 'Daily life', category: 'daily-life', programmeTitle: 'Everyday English', programmeDescription: 'Making friends and handling daily situations.' },
];

/** The slice of a stored session the catalog needs. */
export interface CatalogSession {
  id: string;
  roleplayId: string | null;
  report: unknown;
  createdAt: Date | string;
}

export interface AttemptView {
  sessionId: string;
  at: string;
  /** Overall score 0-100, or null when the report has no measured score. */
  score: number | null;
}

export interface LessonView {
  source: ContentSource;
  id: string;
  /** 1-based position inside its level. */
  order: number;
  title: string;
  description: string;
  goal: string;
  scenarioRoleplayId: string;
  coachLine: string | null;
  rubric: { label: string; hint: string }[];
  level: CatalogLevel;
  /** Unit title for curriculum programmes (absent for the original lessons). */
  unit?: string;
  passPct: number;
  partner: { personaId: string; name: string; title: string };
  status: 'not_started' | 'in_progress' | 'passed';
  bestScore: number | null;
  /** Oldest first. */
  attempts: AttemptView[];
}

export interface LevelView {
  level: CatalogLevel;
  lessons: LessonView[];
  totalLessons: number;
  passedLessons: number;
}

export interface ProgrammeCatalogView {
  id: string;
  fieldId: string;
  title: string;
  description: string;
  levels: LevelView[];
  totalLessons: number;
  passedLessons: number;
  /** Level to open first: the first level that still has an unpassed lesson. */
  recommendedLevel: CatalogLevel;
  /** First unpassed lesson of the recommended level, or null. */
  nextLessonId: string | null;
}

export interface FieldView {
  id: string;
  title: string;
  programmes: ProgrammeCatalogView[];
  totalLessons: number;
  passedLessons: number;
}

const DIMENSION_KEYS = ['pronunciation', 'fluency', 'vocabulary', 'grammar', 'interaction'] as const;

/**
 * Overall score (0-100) of a stored report, the same number the report page shows:
 * the mean of the measured dimension scores (unavailable ones are left out, never counted as 0).
 * Only reports with status OK count. Falls back to the stored overall_score when a report has no
 * dimension numbers, and to null when nothing is measured.
 */
export function overallOf(report: unknown): number | null {
  if (!report || typeof report !== 'object') return null;
  const r = report as { status?: unknown; dimensions?: Record<string, unknown> };
  if (r.status !== 'OK') return null;
  const dims = DIMENSION_KEYS.map((k) => r.dimensions?.[k]).filter(
    (n): n is number => typeof n === 'number' && Number.isFinite(n),
  );
  if (dims.length === 0) return reportScore(report);
  const mean = dims.reduce((a, b) => a + Math.max(0, Math.min(100, b)), 0) / dims.length;
  return Math.round(mean * 10) / 10;
}

/** Coach opening lines already written for the earlier programmes, reused by roleplay id. */
function coachLineFor(roleplayId: string): string | null {
  for (const p of PROGRAMMES) {
    const t = p.tasks.find((x) => x.roleplayId === roleplayId);
    if (t) return t.coachLine;
  }
  return null;
}

/** Builds one programme view (levels, lessons, attempts, progress) from its scenarios. */
function buildProgramme(
  meta: { id: string; fieldId: string; title: string; description: string },
  scenarios: RoleplayScenario[],
  sessions: CatalogSession[],
  unitOf: (id: string) => string | undefined = () => undefined,
): ProgrammeCatalogView {
    const field = { id: meta.fieldId, programmeTitle: meta.title, programmeDescription: meta.description };
    const levels: LevelView[] = CATALOG_LEVELS.map((level) => {
      const lessons: LessonView[] = scenarios
        .filter((s) => s.level === level)
        .map((s, i) => {
          const attempts: AttemptView[] = sessions
            .filter((x) => x.roleplayId === s.id)
            .map((x) => ({
              sessionId: x.id,
              at: new Date(x.createdAt).toISOString(),
              score: overallOf(x.report),
            }))
            .sort((a, b) => a.at.localeCompare(b.at));
          const scores = attempts.map((a) => a.score).filter((n): n is number => n !== null);
          const bestScore = scores.length ? Math.max(...scores) : null;
          const status =
            bestScore !== null && bestScore >= DEFAULT_PASS_PCT ? 'passed' : attempts.length ? 'in_progress' : 'not_started';
          const persona = getPersona(s.persona);
          return {
            source: SELF_WRITTEN,
            id: s.id,
            order: i + 1,
            title: s.title,
            description: s.description,
            goal: s.goal,
            scenarioRoleplayId: s.id,
            coachLine: coachLineFor(s.id),
            rubric: s.rubric,
            level,
            passPct: DEFAULT_PASS_PCT,
            partner: { personaId: persona.id, name: persona.displayName, title: s.personaRole },
            status,
            bestScore,
            attempts,
            ...(unitOf(s.id) ? { unit: unitOf(s.id) } : {}),
          } as LessonView;
        });
      return {
        level,
        lessons,
        totalLessons: lessons.length,
        passedLessons: lessons.filter((l) => l.status === 'passed').length,
      };
    });
    const all = levels.flatMap((l) => l.lessons);
    const recommended = levels.find((l) => l.lessons.some((x) => x.status !== 'passed')) ?? levels.find((l) => l.totalLessons > 0) ?? levels[0];
    const next = recommended.lessons.find((x) => x.status !== 'passed') ?? null;
    return {
      id: meta.id,
      fieldId: meta.fieldId,
      title: meta.title,
      description: meta.description,
      levels,
      totalLessons: all.length,
      passedLessons: all.filter((l) => l.status === 'passed').length,
      recommendedLevel: recommended.level,
      nextLessonId: next ? next.id : null,
    };
}

export function buildCatalog(sessions: CatalogSession[]): FieldView[] {
  return FIELDS.map((field) => {
    const scenarios = ROLEPLAY_SCENARIOS.filter((s) => s.category === field.category);
    const base = buildProgramme(
      { id: `${field.id}-english`, fieldId: field.id, title: field.programmeTitle, description: field.programmeDescription },
      scenarios,
      sessions,
    );
    // Curriculum programmes (hidden unless CURRICULUM_ENABLED=true or a lesson is marked live).
    const extra = CURRICULUM_PROGRAMMES.filter((p) => p.fieldId === field.id)
      .map((p) => {
        const lessons = Object.values(p.levels).flat().filter(lessonVisible);
        if (lessons.length === 0) return null;
        const unitById = new Map(lessons.map((l) => [l.id, l.unit]));
        const sc = curriculumScenariosOf(lessons, field.category);
        return buildProgramme({ id: p.id, fieldId: p.fieldId, title: p.title, description: p.description }, sc, sessions, (id) => unitById.get(id));
      })
      .filter((x): x is ProgrammeCatalogView => x !== null);
    const programmes = [base, ...extra];
    return {
      id: field.id,
      title: field.title,
      programmes,
      totalLessons: programmes.reduce((n, p) => n + p.totalLessons, 0),
      passedLessons: programmes.reduce((n, p) => n + p.passedLessons, 0),
    };
  });
}

function curriculumScenariosOf(lessons: CurriculumLesson[], category: RoleplayCategory): RoleplayScenario[] {
  return lessons.map((l) => ({
    id: l.id, category, title: l.title, description: l.description, persona: l.persona, personaRole: l.personaRole,
    level: l.level, goal: l.goal, rubric: l.rubric, targets: l.targets,
  }));
}
