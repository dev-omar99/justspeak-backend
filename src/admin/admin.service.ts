import { Injectable, Logger, NotFoundException, BadRequestException, OnApplicationBootstrap, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { getAdminEmail, isAdminEmail } from './admin-policy';
import { subscriptionStore, PlanTierId } from '../users/subscription-store';
import { SignalingGateway } from '../rooms/signaling.gateway';

export interface AdminUserListItem {
  id: string;
  email: string | null;
  phone?: string | null;
  name: string | null;
  country: string | null;
  isAdmin: boolean;
  createdAt: Date;
  sessionsCount: number;
  planTier?: PlanTierId;
  aiTokensBalance?: number;
}


export interface AdminStats {
  totalUsers: number;
  totalSessions: number;
  totalFeedbacks: number;
  totalBlocks: number;
  totalAiSessions: number;
  activeAiSessions: number;
  totalRecordings: number;
  newUsersLast7d: number;
}

export interface AuditLogEntry {
  id: string;
  adminEmail: string;
  action: string;
  targetType: string;
  targetId: string | null;
  details: unknown;
  createdAt: Date;
}

@Injectable()
export class AdminService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    // Optional so unit tests and non-websocket contexts can build the service
    // without the signaling gateway; live-room reporting degrades to [].
    @Optional() private readonly signalingGateway?: SignalingGateway,
  ) {}

  /**
   * Append one entry to the admin audit log. Every mutating admin endpoint
   * calls this so Omar always has a server-side trail of who changed what.
   * Never throws: an audit failure must not break the action itself.
   */
  async recordAudit(
    adminEmail: string,
    action: string,
    targetType: string,
    targetId?: string,
    details: Record<string, unknown> = {},
  ): Promise<void> {
    try {
      await this.prisma.adminAuditLog.create({
        data: {
          adminEmail,
          action,
          targetType,
          targetId: targetId ?? null,
          details: details as any,
        },
      });
    } catch (err) {
      this.logger.warn(`Audit log write failed for ${action}: ${err}`);
    }
  }

  async getAuditLog(take = 50, skip = 0): Promise<AuditLogEntry[]> {
    return this.prisma.adminAuditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(take, 1), 200),
      skip: Math.max(skip, 0),
    });
  }

  /**
   * Startup reconciliation for the single-admin policy: promote the account
   * matching ADMIN_EMAIL (when it exists) and demote every other admin.
   * Runs once per boot so the database can never drift to zero or two
   * admins, regardless of manual edits.
   */
  async onApplicationBootstrap(): Promise<void> {
    const adminEmail = getAdminEmail();
    if (!adminEmail) {
      this.logger.warn(
        'ADMIN_EMAIL is not configured: admin area stays closed to everyone.',
      );
      return;
    }

    const promoted = await this.prisma.user.updateMany({
      where: { email: adminEmail, isAdmin: false },
      data: { isAdmin: true },
    });
    const demoted = await this.prisma.user.updateMany({
      where: { email: { not: adminEmail }, isAdmin: true },
      data: { isAdmin: false },
    });

    if (promoted.count > 0 || demoted.count > 0) {
      this.logger.log(
        `Admin policy applied: ${promoted.count} promoted, ${demoted.count} demoted.`,
      );
    }
  }

  async getAllUsers(): Promise<AdminUserListItem[]> {
    const users = await this.prisma.user.findMany({
      select: {
        id: true,
        email: true,
        phone: true,
        name: true,
        country: true,
        isAdmin: true,
        createdAt: true,
        _count: {
          select: { givenFeedbacks: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const subDelegate = (this.prisma as any).userSubscription;
    let subMap = new Map<string, { planTier: PlanTierId; aiTokensBalance: number }>();
    if (subDelegate?.findMany) {
      try {
        const subs = await subDelegate.findMany();
        for (const s of subs) {
          subMap.set(s.userId, {
            planTier: s.planTier as PlanTierId,
            aiTokensBalance: s.aiTokensBalance,
          });
        }
      } catch {}
    }

    return users.map((u) => {
      const sub = subMap.get(u.id) || subscriptionStore.getSubscription(u.id);
      return {
        id: u.id,
        email: u.email,
        phone: u.phone,
        name: u.name,
        country: u.country,
        isAdmin: u.isAdmin,
        createdAt: u.createdAt,
        sessionsCount: u._count.givenFeedbacks,
        planTier: sub.planTier,
        aiTokensBalance: sub.aiTokensBalance,
      };
    });

  }

  async getStats(): Promise<AdminStats> {
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const [
      totalUsers,
      totalSessions,
      totalFeedbacks,
      totalBlocks,
      totalAiSessions,
      activeAiSessions,
      totalRecordings,
      newUsersLast7d,
    ] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.session.count(),
      this.prisma.sessionFeedback.count(),
      this.prisma.userBlock.count(),
      this.prisma.aiPartnerSession.count(),
      this.prisma.aiPartnerSession.count({ where: { status: 'active' } }),
      this.prisma.aiPartnerRecording.count(),
      this.prisma.user.count({ where: { createdAt: { gte: weekAgo } } }),
    ]);

    return {
      totalUsers,
      totalSessions,
      totalFeedbacks,
      totalBlocks,
      totalAiSessions,
      activeAiSessions,
      totalRecordings,
      newUsersLast7d,
    };
  }

  async deleteUser(id: string, adminEmail = 'unknown'): Promise<{ success: boolean }> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, phone: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // The single admin account can never be deleted through the admin API -
    // removing it would lock the whole admin area until the next boot
    // reconciliation.
    if (isAdminEmail(user.email)) {
      throw new BadRequestException('The administrator account cannot be deleted.');
    }

    const identifiersToClean: string[] = [];
    if (user.email) {
      identifiersToClean.push(user.email.trim().toLowerCase());
    }
    if (user.phone) {
      identifiersToClean.push(user.phone.trim());
    }

    if (identifiersToClean.length > 0) {
      await this.prisma.otpCode.deleteMany({
        where: {
          OR: identifiersToClean.map((identifier) => ({
            identifier: { equals: identifier, mode: 'insensitive' },
          })),
        },
      });
    }

    await this.prisma.user.delete({ where: { id: user.id } });
    await this.recordAudit(adminEmail, 'user.delete', 'user', user.id, {
      email: user.email,
      phone: user.phone,
    });
    return { success: true };
  }

  async updateUserSubscription(
    id: string,
    payload: { planTier?: PlanTierId; aiTokensBalance?: number; addTokens?: number },
    adminEmail = 'unknown',
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const subDelegate = (this.prisma as any).userSubscription;
    let current = subscriptionStore.getSubscription(id);
    if (subDelegate?.findUnique) {
      try {
        const dbSub = await subDelegate.findUnique({ where: { userId: id } });
        if (dbSub) {
          current = {
            userId: dbSub.userId,
            planTier: dbSub.planTier as PlanTierId,
            aiTokensBalance: dbSub.aiTokensBalance,
            updatedAt: dbSub.updatedAt.toISOString(),
          };
        }
      } catch {}
    }

    const nextTier = payload.planTier || current.planTier;
    if (!['FREE', 'PLUS', 'ELITE'].includes(nextTier)) {
      throw new BadRequestException('Invalid planTier');
    }

    const defaultTokens: Record<PlanTierId, number> = { FREE: 0, PLUS: 500, ELITE: 3500 };
    let nextTokens = current.aiTokensBalance;
    if (typeof payload.aiTokensBalance === 'number') {
      nextTokens = Math.max(0, Math.floor(payload.aiTokensBalance));
    } else if (typeof payload.addTokens === 'number') {
      nextTokens = Math.max(0, current.aiTokensBalance + Math.floor(payload.addTokens));
    } else if (nextTier !== current.planTier) {
      nextTokens = nextTier === 'FREE' ? 0 : current.aiTokensBalance + defaultTokens[nextTier];
    }

    if (subDelegate?.upsert) {
      try {
        const saved = await subDelegate.upsert({
          where: { userId: id },
          create: { userId: id, planTier: nextTier, aiTokensBalance: nextTokens },
          update: { planTier: nextTier, aiTokensBalance: nextTokens },
        });
        await this.recordAudit(adminEmail, 'user.subscription.update', 'user', id, {
          planTier: saved.planTier,
          aiTokensBalance: saved.aiTokensBalance,
        });
        return {
          success: true,
          userId: id,
          planTier: saved.planTier as PlanTierId,
          aiTokensBalance: saved.aiTokensBalance,
        };
      } catch {}
    }

    const updated = subscriptionStore.setSubscription(
      id,
      nextTier,
      payload.aiTokensBalance,
      payload.addTokens,
    );

    await this.recordAudit(adminEmail, 'user.subscription.update', 'user', id, {
      planTier: updated.planTier,
      aiTokensBalance: updated.aiTokensBalance,
    });

    return {
      success: true,
      userId: id,
      planTier: updated.planTier,
      aiTokensBalance: updated.aiTokensBalance,
    };
  }

  /**
   * Full detail view of one user for the admin dashboard: profile,
   * subscription, AI partner quota, and engagement counts.
   */
  async getUserDetail(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        phone: true,
        name: true,
        country: true,
        englishLevel: true,
        isAdmin: true,
        ticketsLeft: true,
        createdAt: true,
        _count: {
          select: {
            buddies: true,
            blockedUsers: true,
            givenFeedbacks: true,
            receivedFeedbacks: true,
            aiPartnerSessions: true,
          },
        },
      },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const sub = await this.prisma.userSubscription.findUnique({
      where: { userId: id },
    });
    const offsetRow = await this.prisma.aiPartnerQuotaOffset.findUnique({
      where: { userId: id },
    });
    const aiSessionsUsed = user._count.aiPartnerSessions;

    return {
      id: user.id,
      email: user.email,
      phone: user.phone,
      name: user.name,
      country: user.country,
      englishLevel: user.englishLevel,
      isAdmin: user.isAdmin,
      ticketsLeft: user.ticketsLeft,
      createdAt: user.createdAt,
      planTier: (sub?.planTier as PlanTierId) ?? 'FREE',
      aiTokensBalance: sub?.aiTokensBalance ?? 0,
      aiSessionsUsed,
      aiQuotaOffset: offsetRow?.offset ?? 0,
      buddiesCount: user._count.buddies,
      blockedCount: user._count.blockedUsers,
      feedbackGiven: user._count.givenFeedbacks,
      feedbackReceived: user._count.receivedFeedbacks,
    };
  }

  /**
   * Adjust a user's AI partner free-quota offset. History is NEVER deleted
   * to change the counter: raising the offset grants extra sessions, and
   * the saved sessions stay intact either way (Omar's standing rule).
   */
  async setAiQuotaOffset(adminEmail: string, id: string, offset: number) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    const cleanOffset = Math.max(0, Math.floor(offset));
    const saved = await this.prisma.aiPartnerQuotaOffset.upsert({
      where: { userId: id },
      create: { userId: id, offset: cleanOffset },
      update: { offset: cleanOffset },
    });
    await this.recordAudit(adminEmail, 'user.ai-quota-offset.set', 'user', id, {
      offset: cleanOffset,
    });
    return { success: true, userId: id, offset: saved.offset };
  }

  /** P2P practice sessions, newest first, with participant summaries. */
  async getSessions(take = 20, skip = 0) {
    const sessions = await this.prisma.session.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(take, 1), 100),
      skip: Math.max(skip, 0),
      include: { _count: { select: { feedbacks: true } } },
    });
    const userIds = Array.from(new Set(sessions.flatMap((s) => s.participantIds)));
    const users = userIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, email: true, country: true },
        })
      : [];
    const byId = new Map(users.map((u) => [u.id, u]));
    return sessions.map((s) => ({
      id: s.id,
      roomName: s.roomName,
      topic: s.topic,
      createdAt: s.createdAt,
      feedbackCount: s._count.feedbacks,
      participants: s.participantIds.map(
        (pid) =>
          byId.get(pid) ?? { id: pid, name: null, email: null, country: null },
      ),
    }));
  }

  /**
   * What is happening right now: live P2P rooms from the signaling
   * gateway's in-memory state plus AI partner sessions still marked active.
   */
  async getLiveOverview() {
    const liveRooms = this.signalingGateway?.getLiveRooms?.() ?? [];
    const activeAiSessions = await this.prisma.aiPartnerSession.findMany({
      where: { status: 'active' },
      orderBy: { startedAt: 'desc' },
      take: 50,
      select: {
        id: true,
        userId: true,
        mode: true,
        personaId: true,
        level: true,
        startedAt: true,
        user: { select: { name: true, email: true } },
      },
    });
    return { liveRooms, activeAiSessions };
  }

  /** AI partner sessions with filters, newest first. */
  async getAiSessions(options: {
    status?: string;
    userId?: string;
    take?: number;
    skip?: number;
  }) {
    const { status, userId } = options;
    const take = Math.min(Math.max(options.take ?? 20, 1), 100);
    const skip = Math.max(options.skip ?? 0, 0);
    return this.prisma.aiPartnerSession.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(userId ? { userId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take,
      skip,
      select: {
        id: true,
        userId: true,
        mode: true,
        personaId: true,
        level: true,
        status: true,
        startedAt: true,
        endedAt: true,
        durationSec: true,
        reportModel: true,
        user: { select: { name: true, email: true } },
        _count: { select: { recordings: true } },
      },
    });
  }

  /** One AI partner session in full: transcript, metrics, report, recordings. */
  async getAiSessionDetail(id: string) {
    const session = await this.prisma.aiPartnerSession.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, name: true, email: true } },
        recordings: { orderBy: { position: 'asc' } },
      },
    });
    if (!session) {
      throw new NotFoundException('AI session not found');
    }
    return session;
  }

  /**
   * Force-end an AI partner session that is stuck in `active`. The row and
   * its transcript/report are kept; only the status and end time change.
   */
  async forceEndAiSession(adminEmail: string, id: string) {
    const session = await this.prisma.aiPartnerSession.findUnique({
      where: { id },
      select: { id: true, status: true, startedAt: true },
    });
    if (!session) {
      throw new NotFoundException('AI session not found');
    }
    if (session.status !== 'active') {
      return { success: true, id, status: session.status, changed: false };
    }
    const durationSec = Math.max(
      0,
      Math.floor((Date.now() - session.startedAt.getTime()) / 1000),
    );
    const updated = await this.prisma.aiPartnerSession.update({
      where: { id },
      data: { status: 'finished', endedAt: new Date(), durationSec },
      select: { id: true, status: true },
    });
    await this.recordAudit(adminEmail, 'ai-session.force-end', 'ai-session', id, {
      durationSec,
    });
    return { success: true, id, status: updated.status, changed: true };
  }

  /** AI session recordings with their session and owner, newest first. */
  async getRecordings(options: { userId?: string; take?: number; skip?: number }) {
    const take = Math.min(Math.max(options.take ?? 20, 1), 100);
    const skip = Math.max(options.skip ?? 0, 0);
    return this.prisma.aiPartnerRecording.findMany({
      where: options.userId ? { userId: options.userId } : {},
      orderBy: { createdAt: 'desc' },
      take,
      skip,
      include: {
        session: {
          select: {
            id: true,
            mode: true,
            personaId: true,
            user: { select: { name: true, email: true } },
          },
        },
      },
    });
  }

  /** P2P session feedback (the peer reports), newest first. */
  async getFeedback(take = 20, skip = 0) {
    const items = await this.prisma.sessionFeedback.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(take, 1), 100),
      skip: Math.max(skip, 0),
    });
    const userIds = Array.from(
      new Set(items.flatMap((f) => [f.giverId, f.receiverId])),
    );
    const users = userIds.length
      ? await this.prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, email: true },
        })
      : [];
    const byId = new Map(users.map((u) => [u.id, u]));
    return items.map((f) => ({
      id: f.id,
      sessionId: f.sessionId,
      levelFeedback: f.levelFeedback,
      partnerRating: f.partnerRating,
      compliments: f.compliments,
      createdAt: f.createdAt,
      giver: byId.get(f.giverId) ?? { id: f.giverId, name: null, email: null },
      receiver:
        byId.get(f.receiverId) ?? { id: f.receiverId, name: null, email: null },
    }));
  }
}