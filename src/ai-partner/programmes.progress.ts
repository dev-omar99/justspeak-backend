/**
 * Pure progress logic for programmes (no database access, easy to test).
 * Progress is derived from the learner's sessions:
 * - not_started: no session for the task's roleplay
 * - in_progress: at least one session but no measured score at or above the pass mark
 * - passed: best measured score is at or above the pass mark
 * Only real numeric scores from reports with status OK count. A missing or
 * unmeasured score is never treated as 0 and never as a pass.
 */

import { ROLEPLAY_SCENARIOS } from './content/roleplays';
import { DEFAULT_PASS_PCT, PERSONA_TRAITS, type ContentSource, type ProgrammeDef } from './content/programmes';
import { reportOverall } from './content/rubric';
import { getPersona, type PersonaId } from './content/personas';

export type TaskStatus = 'not_started' | 'in_progress' | 'passed';

/** The slice of a stored session this logic needs. */
export interface SessionLite {
  roleplayId: string | null;
  report: unknown;
}

export interface TaskView {
  source: ContentSource;
  id: string;
  title: string;
  description: string;
  goal: string;
  coachLine: string;
  roleplayId: string;
  level: string;
  passPct: number;
  status: TaskStatus;
  /** Best measured overall score 0-100, or null when none measured yet. */
  bestScore: number | null;
  attempts: number;
  partner: { personaId: string; name: string; title: string; trait: string };
}

export interface ProgrammeView {
  source: ContentSource;
  id: string;
  title: string;
  description: string;
  level: string;
  tasks: TaskView[];
  totalTasks: number;
  passedTasks: number;
  /** Tasks not yet passed. */
  stepsToGo: number;
  nextTaskId: string | null;
}

/** Overall score of a stored report, or null when it is not a real measured number. Same number as every other screen. */
export function reportScore(report: unknown): number | null {
  return reportOverall(report);
}

export function buildProgrammes(programmes: ProgrammeDef[], sessions: SessionLite[]): ProgrammeView[] {
  const views: ProgrammeView[] = [];
  for (const programme of programmes) {
    const tasks: TaskView[] = [];
    for (const def of programme.tasks) {
      const scenario = ROLEPLAY_SCENARIOS.find((s) => s.id === def.roleplayId);
      if (!scenario) continue; // a task pointing at a missing scenario is skipped, never crashes
      const mine = sessions.filter((s) => s.roleplayId === def.roleplayId);
      const scores = mine.map((s) => reportScore(s.report)).filter((n): n is number => n !== null);
      const bestScore = scores.length ? Math.max(...scores) : null;
      const passPct = def.passPct ?? DEFAULT_PASS_PCT;
      const status: TaskStatus =
        bestScore !== null && bestScore >= passPct ? 'passed' : mine.length > 0 ? 'in_progress' : 'not_started';
      const persona = getPersona(scenario.persona);
      tasks.push({
        source: def.source,
        id: def.id,
        title: def.title,
        description: scenario.description,
        goal: scenario.goal,
        coachLine: def.coachLine,
        roleplayId: def.roleplayId,
        level: scenario.level,
        passPct,
        status,
        bestScore,
        attempts: mine.length,
        partner: {
          personaId: persona.id,
          name: persona.displayName,
          title: scenario.personaRole,
          trait: PERSONA_TRAITS[persona.id as PersonaId] ?? '',
        },
      });
    }
    const passedTasks = tasks.filter((t) => t.status === 'passed').length;
    const next = tasks.find((t) => t.status !== 'passed');
    views.push({
      source: programme.source,
      id: programme.id,
      title: programme.title,
      description: programme.description,
      level: programme.level,
      tasks,
      totalTasks: tasks.length,
      passedTasks,
      stepsToGo: tasks.length - passedTasks,
      nextTaskId: next ? next.id : null,
    });
  }
  return views;
}
