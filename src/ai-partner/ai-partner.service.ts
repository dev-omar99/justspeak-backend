import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { ClaudeService } from './claude.service';
import { normalizeCefrLevel } from './levels';
import {
  aiPartnerEnabled,
  feedbackModel,
  minReportSpeechSec,
  freeSessionQuota,
  paidDailySessionQuota,
  placementModel,
} from './ai-partner.config';
import {
  FEEDBACK_RUBRIC_PROMPT,
  SessionReport,
  insufficientReport,
  parseSessionReport,
} from './content/rubric';
import { DeepgramPrerecordedService } from './deepgram.service';
import { getLesson } from './content/course';
import { getRoleplay } from './content/roleplays';
import { analyzeWordChoice } from './word-choice';
import { StartSessionDto } from './dto';

export type AiPartnerMode = 'free-talk' | 'interview' | 'lesson';

export interface QuotaInfo {
  planTier: string;
  /** 'lifetime' for FREE (5 sessions total), 'daily' for paid plans */
  kind: 'lifetime' | 'daily';
  limit: number;
  used: number;
  remaining: number;
}

@Injectable()
export class AiPartnerService {
  private readonly logger = new Logger('AiPartnerService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly claude: ClaudeService,
    private readonly prerecorded: DeepgramPrerecordedService,
  ) {}

  assertEnabled(): void {
    if (!aiPartnerEnabled()) {
      throw new ServiceUnavailableException(
        'The AI Partner feature is not enabled on this server.',
      );
    }
  }

  private async planTierFor(userId: string): Promise<string> {
    const sub = await this.prisma.userSubscription.findUnique({
      where: { userId },
      select: { planTier: true },
    });
    return sub?.planTier ?? 'FREE';
  }

  async getQuota(userId: string): Promise<QuotaInfo> {
    const planTier = await this.planTierFor(userId);
    if (planTier === 'FREE') {
      // Quota is tracked separately from saved history: sessions are never
      // deleted to adjust the counter, the offset row shifts it instead.
      const rawCount = await this.prisma.aiPartnerSession.count({
        where: { userId },
      });
      const offsetRow = await this.prisma.aiPartnerQuotaOffset.findUnique({
        where: { userId },
      });
      const used = Math.max(0, rawCount - (offsetRow?.offset ?? 0));
      const limit = freeSessionQuota();
      return {
        planTier,
        kind: 'lifetime',
        limit,
        used,
        remaining: Math.max(0, limit - used),
      };
    }
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const used = await this.prisma.aiPartnerSession.count({
      where: { userId, createdAt: { gte: dayStart } },
    });
    const limit = paidDailySessionQuota(planTier);
    return {
      planTier,
      kind: 'daily',
      limit,
      used,
      remaining: Math.max(0, limit - used),
    };
  }

  async startSession(userId: string, dto: StartSessionDto) {
    this.assertEnabled();
    const quota = await this.getQuota(userId);
    if (quota.remaining <= 0) {
      throw new ForbiddenException(
        quota.kind === 'lifetime'
          ? 'You used all free AI sessions. Upgrade to keep practising.'
          : 'You reached today\'s AI session limit. Come back tomorrow.',
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, englishLevel: true },
    });

    const session = await this.prisma.aiPartnerSession.create({
      data: {
        userId,
        mode: dto.mode,
        personaId: dto.personaId,
        fieldId: dto.fieldId ?? null,
        lessonId: dto.lessonId ?? null,
        roleplayId: dto.roleplayId ?? null,
        level: normalizeCefrLevel(dto.level || user?.englishLevel),
        status: 'active',
        transcript: [],
        facts: [],
        metrics: {},
      },
    });
    return { sessionId: session.id, quota: { ...quota, used: quota.used + 1, remaining: quota.remaining - 1 } };
  }

  async getOwnedSession(sessionId: string, userId: string) {
    const session = await this.prisma.aiPartnerSession.findUnique({
      where: { id: sessionId },
    });
    if (!session || session.userId !== userId) {
      throw new NotFoundException('Session not found.');
    }
    return session;
  }

  /** Called by the gateway while a live session runs. */
  async saveLiveState(params: {
    sessionId: string;
    transcript: unknown[];
    facts: unknown[];
    metrics: Record<string, unknown>;
  }): Promise<void> {
    await this.prisma.aiPartnerSession.update({
      where: { id: params.sessionId },
      data: {
        transcript: params.transcript as any,
        facts: params.facts as any,
        metrics: params.metrics as any,
      },
    });
  }

  async endSession(sessionId: string, userId: string, durationSec: number) {
    const session = await this.getOwnedSession(sessionId, userId);
    if (session.status === 'active') {
      await this.prisma.aiPartnerSession.update({
        where: { id: sessionId },
        data: { status: 'finished', endedAt: new Date(), durationSec },
      });
    }
    return this.prisma.aiPartnerSession.findUnique({ where: { id: sessionId } });
  }

  /**
   * Generate (or return the cached) end-of-session report.
   * Honest scoring: short sessions return INSUFFICIENT_DATA, no scores.
   */
  async generateReport(sessionId: string, userId: string) {
    this.assertEnabled();
    const session = await this.getOwnedSession(sessionId, userId);
    const saved = session.report as unknown as SessionReport | null;
    // INSUFFICIENT_DATA reports are placeholders, never cached: speaking
    // more (or a threshold change) should regenerate them for real.
    if (saved && saved.status !== 'INSUFFICIENT_DATA') {
      return {
        session,
        report: saved,
        cached: true,
        pronunciation_assessment: extractPronunciation(session.metrics),
      };
    }

    const transcript = (session.transcript as unknown as { role: string; text: string }[]) ?? [];
    const metrics = (session.metrics as Record<string, unknown>) ?? {};
    const studentSpeechSec = Number(metrics['student_speech_sec'] ?? 0);

    let report: SessionReport | null = null;
    if (studentSpeechSec < minReportSpeechSec()) {
      report = insufficientReport(metrics);
    } else {
      report = await this.buildModelReport(
        session.level,
        session.mode,
        transcript,
        metrics,
        session.lessonId,
        session.roleplayId,
      );
    }

    if (!report) {
      throw new ServiceUnavailableException(
        'Could not generate the report right now. Please try again in a moment.',
      );
    }

    // Deterministic delivery analytics are attached in code: the model
    // writes the coaching words, the numbers come from the transcript.
    if (report.status === 'OK') {
      const learnerTurns = transcript.filter((t) => t.role === 'user').map((t) => t.text);
      report.metrics_echo.word_choice = analyzeWordChoice(learnerTurns);
    }

    if (report.status === 'INSUFFICIENT_DATA') {
      // placeholder only: return it, never store it over future potential
      return {
        session,
        report,
        cached: false,
        pronunciation_assessment: extractPronunciation(session.metrics),
      };
    }
    const updated = await this.prisma.aiPartnerSession.update({
      where: { id: sessionId },
      data: { report: report as any, reportModel: feedbackModel() },
    });
    return {
      session: updated,
      report,
      cached: false,
      pronunciation_assessment: extractPronunciation(updated.metrics),
    };
  }

  /** Level placement check: scored with the stronger model. */
  async generatePlacementReport(sessionId: string, userId: string) {
    this.assertEnabled();
    const session = await this.getOwnedSession(sessionId, userId);
    const transcript = (session.transcript as unknown as { role: string; text: string }[]) ?? [];
    const metrics = (session.metrics as Record<string, unknown>) ?? {};
    const transcriptText = transcript
      .map((turn) => `${turn.role === 'user' ? 'STUDENT' : 'PARTNER'}: ${turn.text}`)
      .join('\n');
    const raw = await this.claude.complete({
      model: placementModel(),
      system: FEEDBACK_RUBRIC_PROMPT,
      prompt:
        `This is a LEVEL PLACEMENT session. Estimate the student's CEFR level.\n\n` +
        `METRICS JSON:\n${JSON.stringify(metrics, null, 2)}\n\nTRANSCRIPT:\n${transcriptText}`,
      maxTokens: 3000,
    });
    const report = parseSessionReport(raw);
    if (!report) {
      throw new ServiceUnavailableException('Could not score this placement session.');
    }
    await this.prisma.aiPartnerSession.update({
      where: { id: sessionId },
      data: { report: report as any, reportModel: placementModel() },
    });
    return report;
  }


  /** Shared model call for session reports (feedback model). */
  private async buildModelReport(
    level: string,
    mode: string,
    transcript: { role: string; text: string }[],
    metrics: Record<string, unknown>,
    lessonId?: string | null,
    roleplayId?: string | null,
  ): Promise<SessionReport | null> {
    const transcriptText = transcript
      .map((turn) => `${turn.role === 'user' ? 'STUDENT' : 'PARTNER'}: ${turn.text}`)
      .join('\n');
    let lessonContext = '';
    if (mode === 'lesson' && lessonId) {
      const lesson = getLesson(lessonId);
      if (lesson) {
        lessonContext =
          `LESSON CONTEXT: this was lesson "${lesson.title}" (${lesson.halfLevel}). ` +
          `Goal: ${lesson.goal}. Target language: ${lesson.targetLanguage.join('; ')}. ` +
          `Assess the lesson_result against this goal and target language.\n\n`;
      }
    }
    // Roleplay context: grade the learner against the scenario goal and
    // its rubric, the same target the coach steered toward in session.
    let roleplayContext = '';
    if (roleplayId) {
      const scenario = getRoleplay(roleplayId);
      if (scenario) {
        roleplayContext =
          `ROLEPLAY CONTEXT: this was the roleplay "${scenario.title}". ` +
          `The partner played ${scenario.personaRole}. ` +
          `Learner goal: ${scenario.goal}. ` +
          `Scoring rubric: ${scenario.rubric.map((r) => `${r.label} (${r.hint})`).join('; ')}. ` +
          `Judge the summary, strength and growth area against this goal and rubric, ` +
          `and mention the scenario by name in the summary.\n\n`;
      }
    }
    // Give the model the computed word-choice numbers so its coaching
    // words and the displayed metrics never disagree.
    const learnerTurns = transcript.filter((t) => t.role === 'user').map((t) => t.text);
    const metricsForModel = {
      ...metrics,
      word_choice: analyzeWordChoice(learnerTurns),
    };
    const prompt =
      `Student declared level: ${level}. Mode: ${mode}.\n\n` +
      lessonContext +
      roleplayContext +
      `METRICS JSON:\n${JSON.stringify(metricsForModel, null, 2)}\n\n` +
      `TRANSCRIPT:\n${transcriptText}\n\n` +
      `Score this session by the rubric. Respond with the JSON object only.`;
    try {
      const raw = await this.claude.complete({
        model: feedbackModel(),
        system: FEEDBACK_RUBRIC_PROMPT,
        prompt,
        maxTokens: 3000,
      });
      return parseSessionReport(raw);
    } catch (err) {
      this.logger.warn(`Report generation failed: ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * Weekly progress dashboard: per-week aggregates over the last 8 weeks
   * plus current level, streak and the most frequent correction rules.
   */
  async getDashboard(userId: string) {
    this.assertEnabled();
    const since = new Date(Date.now() - 56 * 24 * 60 * 60 * 1000);
    const sessions = await this.prisma.aiPartnerSession.findMany({
      where: { userId, status: 'finished', createdAt: { gte: since } },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true, durationSec: true, metrics: true, report: true },
    });

    const weekMs = 7 * 24 * 60 * 60 * 1000;
    const weekStart = (d: Date) => {
      const t = new Date(d);
      t.setHours(0, 0, 0, 0);
      t.setDate(t.getDate() - t.getDay());
      return t.toISOString().slice(0, 10);
    };

    const weeks = new Map<
      string,
      { week: string; sessions: number; minutes: number; scores: number[]; wpm: number[] }
    >();
    const ruleCounts = new Map<string, number>();
    let latestCefr = '';
    let totalMinutes = 0;
    let lastSessionAt: string | null = null;

    for (const session of sessions) {
      const key = weekStart(session.createdAt);
      if (!weeks.has(key)) {
        weeks.set(key, { week: key, sessions: 0, minutes: 0, scores: [], wpm: [] });
      }
      const bucket = weeks.get(key)!;
      bucket.sessions += 1;
      const minutes = session.durationSec / 60;
      bucket.minutes += minutes;
      totalMinutes += minutes;
      lastSessionAt = session.createdAt.toISOString();

      const metrics = (session.metrics as Record<string, unknown>) ?? {};
      const wpm = Number(metrics['words_per_minute']);
      if (wpm > 0) bucket.wpm.push(wpm);

      const report = session.report as unknown as SessionReport | null;
      if (report && report.status === 'OK') {
        bucket.scores.push(report.overall_score);
        if (report.cefr_estimate) latestCefr = report.cefr_estimate;
        for (const correction of report.corrections ?? []) {
          if (correction.rule) {
            ruleCounts.set(correction.rule, (ruleCounts.get(correction.rule) ?? 0) + 1);
          }
        }
      }
    }

    // Always return the last 8 week buckets, even empty ones.
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    now.setDate(now.getDate() - now.getDay());
    const weekly: {
      week: string;
      sessions: number;
      minutes: number;
      avg_score: number | null;
      avg_wpm: number | null;
    }[] = [];
    for (let i = 7; i >= 0; i--) {
      const start = new Date(now.getTime() - i * weekMs);
      const key = start.toISOString().slice(0, 10);
      const bucket = weeks.get(key);
      weekly.push({
        week: key,
        sessions: bucket?.sessions ?? 0,
        minutes: Math.round((bucket?.minutes ?? 0) * 10) / 10,
        avg_score:
          bucket && bucket.scores.length
            ? Math.round(bucket.scores.reduce((a, b) => a + b, 0) / bucket.scores.length)
            : null,
        avg_wpm:
          bucket && bucket.wpm.length
            ? Math.round(bucket.wpm.reduce((a, b) => a + b, 0) / bucket.wpm.length)
            : null,
      });
    }

    const topWeaknesses = [...ruleCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([rule, count]) => ({ rule, count }));

    return {
      total_sessions: sessions.length,
      total_minutes: Math.round(totalMinutes * 10) / 10,
      last_session_at: lastSessionAt,
      cefr_estimate: latestCefr,
      weekly,
      top_weaknesses: topWeaknesses,
    };
  }

  /**
   * Upload analysis: transcribe an audio file (Deepgram prerecorded),
   * build metrics, store it as a finished upload session and score it
   * with the same honest rubric. Consumes one session of quota.
   */
  async analyzeUpload(userId: string, file: { buffer: Buffer; mimetype: string; originalname: string }) {
    this.assertEnabled();
    const quota = await this.getQuota(userId);
    if (quota.remaining <= 0) {
      throw new ForbiddenException(
        quota.kind === 'lifetime'
          ? 'You used all free AI sessions. Upgrade to keep practising.'
          : 'You reached today\'s AI session limit. Come back tomorrow.',
      );
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { englishLevel: true },
    });

    let result;
    try {
      result = await this.prerecorded.transcribe(file.buffer, file.mimetype);
    } catch (err) {
      throw new ServiceUnavailableException(
        `Could not transcribe this file: ${(err as Error).message}`,
      );
    }
    if (!result.transcript.trim()) {
      throw new ServiceUnavailableException(
        'No speech was found in this file. Try a clearer recording.',
      );
    }

    const words = result.words.length || result.transcript.split(/\s+/).filter(Boolean).length;
    const speechMinutes = result.durationSec / 60;
    const avgConfidence = result.words.length
      ? result.words.reduce((sum, w) => sum + w.confidence, 0) / result.words.length
      : 0;
    const metrics: Record<string, unknown> = {
      student_speech_sec: Math.round(result.durationSec),
      words_per_minute: speechMinutes > 0 ? Math.round(words / speechMinutes) : 0,
      fillers_per_minute: 0,
      student_talk_ratio: 1,
      avg_stt_confidence: Math.round(avgConfidence * 100) / 100,
      filler_count: 0,
      turns: 1,
      source: 'upload',
      filename: file.originalname.slice(0, 120),
    };
    const transcript = [{ role: 'user', text: result.transcript, at: Date.now() }];

    const session = await this.prisma.aiPartnerSession.create({
      data: {
        userId,
        mode: 'upload',
        personaId: 'tutor',
        level: user?.englishLevel || 'B1',
        status: 'finished',
        endedAt: new Date(),
        durationSec: Math.round(result.durationSec),
        transcript: transcript as any,
        facts: [],
        metrics: metrics as any,
      },
    });

    const report =
      result.durationSec < 180
        ? insufficientReport(metrics)
        : await this.buildModelReport(session.level, 'upload', transcript, metrics);
    if (!report) {
      throw new ServiceUnavailableException(
        'Could not generate the report right now. Please try again in a moment.',
      );
    }
    await this.prisma.aiPartnerSession.update({
      where: { id: session.id },
      data: { report: report as any, reportModel: feedbackModel() },
    });
    return { sessionId: session.id, report };
  }

  /** Minimal read of the learner's own sessions for programme progress. Read only. */
  async sessionsForProgress(userId: string) {
    return this.prisma.aiPartnerSession.findMany({
      where: { userId, roleplayId: { not: null } },
      orderBy: { createdAt: 'desc' },
      take: 500,
      select: { roleplayId: true, report: true },
    });
  }

  async listSessions(userId: string, limit = 20) {
    return this.prisma.aiPartnerSession.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 50),
      select: {
        id: true,
        mode: true,
        personaId: true,
        fieldId: true,
        lessonId: true,
        roleplayId: true,
        level: true,
        status: true,
        durationSec: true,
        createdAt: true,
        report: true,
      },
    });
  }
}

/** Real phoneme-level pronunciation summary, when the Azure add-on ran. */
function extractPronunciation(metrics: unknown): unknown | null {
  const m = (metrics as Record<string, unknown>) ?? {};
  const p = m['pronunciation'];
  if (p && typeof p === 'object' && (p as any).engine) return p;
  return null;
}
