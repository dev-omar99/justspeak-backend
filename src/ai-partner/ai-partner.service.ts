import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { ClaudeService } from './claude.service';
import {
  aiPartnerEnabled,
  feedbackModel,
  freeSessionQuota,
  paidDailySessionQuota,
  placementModel,
} from './ai-partner.config';
import {
  FEEDBACK_RUBRIC_PROMPT,
  SessionReport,
  parseSessionReport,
} from './content/rubric';
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
      const used = await this.prisma.aiPartnerSession.count({
        where: { userId },
      });
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
        level: dto.level || user?.englishLevel || 'B1',
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
    if (session.report) {
      return { session, report: session.report as unknown as SessionReport, cached: true };
    }

    const transcript = (session.transcript as unknown as { role: string; text: string }[]) ?? [];
    const metrics = (session.metrics as Record<string, unknown>) ?? {};
    const studentSpeechSec = Number(metrics['student_speech_sec'] ?? 0);

    let report: SessionReport | null = null;
    if (studentSpeechSec < 180) {
      report = {
        status: 'INSUFFICIENT_DATA',
        overall_score: 0,
        cefr_estimate: '',
        dimensions: { grammar: 0, vocabulary: 0, fluency: 0, pronunciation: 0, interaction: 0 },
        metrics_echo: {
          student_speech_sec: studentSpeechSec,
          words_per_minute: Number(metrics['words_per_minute'] ?? 0),
          fillers_per_minute: Number(metrics['fillers_per_minute'] ?? 0),
          student_talk_ratio: Number(metrics['student_talk_ratio'] ?? 0),
        },
        top_mistakes: [],
        strengths: [],
        next_focus: 'Try a longer session (at least 3 minutes of speaking) to get your full report.',
        suggested_lessons: [],
      };
    } else {
      const transcriptText = transcript
        .map((turn) => `${turn.role === 'user' ? 'STUDENT' : 'PARTNER'}: ${turn.text}`)
        .join('\n');
      const prompt =
        `Student declared level: ${session.level}. Mode: ${session.mode}.\n\n` +
        `METRICS JSON:\n${JSON.stringify(metrics, null, 2)}\n\n` +
        `TRANSCRIPT:\n${transcriptText}\n\n` +
        `Score this session by the rubric. Respond with the JSON object only.`;
      try {
        const raw = await this.claude.complete({
          model: feedbackModel(),
          system: FEEDBACK_RUBRIC_PROMPT,
          prompt,
          maxTokens: 1500,
        });
        report = parseSessionReport(raw);
      } catch (err) {
        this.logger.warn(`Report generation failed for ${sessionId}: ${(err as Error).message}`);
      }
    }

    if (!report) {
      throw new ServiceUnavailableException(
        'Could not generate the report right now. Please try again in a moment.',
      );
    }

    const updated = await this.prisma.aiPartnerSession.update({
      where: { id: sessionId },
      data: { report: report as any, reportModel: feedbackModel() },
    });
    return { session: updated, report, cached: false };
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
      maxTokens: 1500,
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
        level: true,
        status: true,
        durationSec: true,
        createdAt: true,
        report: true,
      },
    });
  }
}
