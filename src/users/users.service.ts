import { Injectable, NotFoundException, BadRequestException, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { isAdminEmail } from '../admin/admin-policy';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma.service';
import { RoomsService } from '../rooms/rooms.service';
import { UpdateProfileDto, AiStudioTurnDto } from './dto';
import { subscriptionStore, PlanTierId } from './subscription-store';

export interface RecentPartnerDto {
  id: string;
  name: string;
  country: string | null;
  countryFlag?: string;
  lastMetDate: string;
  sessionCount: number;
  partnerRating?: string;
  isBuddy?: boolean;
}

export interface DashboardDataDto {
  user: {
    id: string;
    email: string | null;
    phone?: string | null;
    countryCode?: string | null;
    name: string | null;
    country: string | null;
    englishLevel: string | null;
    bio: string | null;
    avatarUrl: string | null;
    tribeId?: number | null;
    planTier?: PlanTierId;
    aiTokensBalance?: number;
  };

  tickets: {
    ticketsLeft: number;
    maxTickets: number;
    resetsInSeconds: number;
    bonusTickets?: number;
  };
  tribe?: {
    userTribe: number | null;
    userTribeName?: string;
    currentActiveTribe: number;
    activeTribeName?: string;
    activeTribeWindow?: string;
    activeMembersCount?: number;
    isTribeActive: boolean;
  };
  stats: {
    streakDays: number;
    totalSessions: number;
    totalMinutes: number;
    countriesCount: number;
    lovedCount: number;
    blockedCount: number;
    buddiesCount: number;
    liveRoomsCount: number;
    contributionPoints?: number;
  };
  streakWeek: Array<{ dayNumber: number; completed: boolean; label: string }>;
  recentPartners: RecentPartnerDto[];
}



@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly roomsService: RoomsService,
  ) {}

  private formatDisplayName(
    user: { name?: string | null; email?: string | null },
    fallback = 'Learner',
  ): string {
    if (user.name && user.name.trim()) {
      return user.name.trim();
    }
    if (user.email && user.email.includes('@')) {
      return user.email.split('@')[0];
    }
    return fallback;
  }

  private maskEmail(email?: string | null): string | null {
    if (!email || !email.includes('@')) return null;
    const [local, domain] = email.split('@');
    if (local.length <= 2) return `${local[0] || '*'}***@${domain}`;
    return `${local.slice(0, 2)}***@${domain}`;
  }

  private getCountryFlag(countryName?: string | null): string {
    if (!countryName) return '🌐';
    const normalized = countryName.toLowerCase().trim();
    const flags: Record<string, string> = {
      egypt: '🇪🇬',
      'saudi arabia': '🇸🇦',
      ksa: '🇸🇦',
      uae: '🇦🇪',
      emirates: '🇦🇪',
      'united arab emirates': '🇦🇪',
      uk: '🇬🇧',
      'united kingdom': '🇬🇧',
      usa: '🇺🇸',
      'united states': '🇺🇸',
      america: '🇺🇸',
      morocco: '🇲🇦',
      algeria: '🇩🇿',
      tunisia: '🇹🇳',
      jordan: '🇯🇴',
      lebanon: '🇱🇧',
      kuwait: '🇰🇼',
      qatar: '🇶🇦',
      germany: '🇩🇪',
      france: '🇫🇷',
      spain: '🇪🇸',
      italy: '🇮🇹',
      turkey: '🇹🇷',
      brazil: '🇧🇷',
      japan: '🇯🇵',
      korea: '🇰🇷',
      india: '🇮🇳',
      indonesia: '🇮🇩',
      pakistan: '🇵🇰',
      colombia: '🇨🇴',
      venezuela: '🇻🇪',
      mexico: '🇲🇽',
      canada: '🇨🇦',
      australia: '🇦🇺',
    };
    return flags[normalized] || '🌍';
  }

  /**
   * Computes a streak based on consecutive days that had at least one session.
   * We derive "session days" from SessionFeedback.createdAt given by the user.
   */
  private computeStreak(sessionDates: Date[]): { streakDays: number; streakWeek: Array<{ dayNumber: number; completed: boolean; label: string }> } {
    if (sessionDates.length === 0) {
      const streakWeek = [1, 2, 3, 4, 5, 6, 7].map((d) => ({
        dayNumber: d,
        label: d === 7 ? 'Gift 🎁' : `Day ${d}`,
        completed: false,
      }));
      return { streakDays: 0, streakWeek };
    }

    // Get unique dates (YYYY-MM-DD) sorted descending
    const uniqueDays = Array.from(
      new Set(sessionDates.map((d) => d.toISOString().split('T')[0])),
    ).sort((a, b) => (a > b ? -1 : 1));

    let streak = 1;
    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

    // Only count streak if the user had a session today or yesterday
    if (uniqueDays[0] !== today && uniqueDays[0] !== yesterday) {
      streak = 0;
    } else {
      for (let i = 0; i < uniqueDays.length - 1; i++) {
        const curr = new Date(uniqueDays[i]);
        const next = new Date(uniqueDays[i + 1]);
        const diffDays = Math.round((curr.getTime() - next.getTime()) / 86400000);
        if (diffDays === 1) {
          streak++;
        } else {
          break;
        }
      }
    }

    const streakWeek = [1, 2, 3, 4, 5, 6, 7].map((day) => ({
      dayNumber: day,
      label: day === 7 ? 'Gift 🎁' : `Day ${day}`,
      completed: day <= streak,
    }));

    return { streakDays: streak, streakWeek };
  }

  async getDashboard(userId: string): Promise<DashboardDataDto> {
    let user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Check 24h daily ticket reset
    const now = new Date();
    const lastReset = user.lastTicketReset ? new Date(user.lastTicketReset) : new Date(0);
    const msSinceReset = now.getTime() - lastReset.getTime();
    const RESET_INTERVAL_MS = 24 * 60 * 60 * 1000;

    let ticketsLeft = user.ticketsLeft ?? 5;
    let lastTicketReset = user.lastTicketReset;

    if (msSinceReset >= RESET_INTERVAL_MS) {
      ticketsLeft = 5;
      lastTicketReset = now;
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          ticketsLeft: 5,
          lastTicketReset: now,
        },
      });
    }

    const resetsInSeconds = Math.max(
      0,
      Math.floor((RESET_INTERVAL_MS - (now.getTime() - lastTicketReset.getTime())) / 1000),
    );

    const [feedbacksGiven, feedbacksReceived, userBlocks, userBuddies] = await Promise.all([
      this.prisma.sessionFeedback.findMany({
        where: { giverId: userId },
        include: {
          receiver: {
            select: { id: true, name: true, email: true, country: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.sessionFeedback.findMany({
        where: { receiverId: userId },
        include: {
          giver: {
            select: { id: true, name: true, email: true, country: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),

      this.prisma.userBlock.findMany({
        where: { userId },
      }),
      this.prisma.userBuddy.findMany({
        where: { userId },
        select: { buddyId: true },
      }),
    ]);

    const buddyIdSet = new Set(userBuddies.map((b) => b.buddyId));

    // Aggregate partner interactions
    const partnerMap = new Map<
      string,
      {
        id: string;
        name: string;
        country: string | null;
        lastMetDate: string;
        sessionCount: number;
        partnerRating?: string;
        isBuddy?: boolean;
      }
    >();

    const countriesSet = new Set<string>();

    for (const fb of feedbacksGiven) {
      const partner = fb.receiver;
      if (!partner) continue;
      if (partner.country) countriesSet.add(partner.country.toLowerCase());

      const existing = partnerMap.get(partner.id);
      if (existing) {
        existing.sessionCount += 1;
      } else {
        partnerMap.set(partner.id, {
          id: partner.id,
          name: this.formatDisplayName(partner, 'Partner'),
          country: partner.country,
          lastMetDate: fb.createdAt.toISOString(),
          sessionCount: 1,
          partnerRating: fb.partnerRating,
          isBuddy: buddyIdSet.has(partner.id),
        });
      }
    }

    for (const fb of feedbacksReceived) {
      const partner = fb.giver;
      if (!partner) continue;
      if (partner.country) countriesSet.add(partner.country.toLowerCase());

      const existing = partnerMap.get(partner.id);
      if (existing) {
        existing.sessionCount += 1;
      } else {
        partnerMap.set(partner.id, {
          id: partner.id,
          name: this.formatDisplayName(partner, 'Partner'),
          country: partner.country,
          lastMetDate: fb.createdAt.toISOString(),
          sessionCount: 1,
          isBuddy: buddyIdSet.has(partner.id),
        });

      }
    }

    const recentPartners: RecentPartnerDto[] = Array.from(partnerMap.values())
      .slice(0, 15)
      .map((p) => ({
        ...p,
        countryFlag: this.getCountryFlag(p.country),
      }));

    // Real streak computation
    const sessionDates = feedbacksGiven.map((fb) => fb.createdAt);
    const { streakDays, streakWeek } = this.computeStreak(sessionDates);

    const lovedCount = feedbacksReceived.filter(
      (fb) => fb.partnerRating === 'LIKED',
    ).length;

    const totalSessions = feedbacksGiven.length;
    const totalMinutes = totalSessions * 7;


    const utcHours = now.getUTCHours();
    const currentActiveTribe = Math.floor(utcHours / 2) + 1; // 1 to 12
    const isTribeActive = user.tribeId === currentActiveTribe;

    const TRIBE_NAMES: Record<number, { name: string; window: string }> = {
      1: { name: 'Dawn Tribe', window: '00:00 - 02:00' },
      2: { name: 'Aurora Tribe', window: '02:00 - 04:00' },
      3: { name: 'Light Tribe', window: '04:00 - 06:00' },
      4: { name: 'Morning Tribe', window: '06:00 - 08:00' },
      5: { name: 'Solar Tribe', window: '08:00 - 10:00' },
      6: { name: 'Noon Tribe', window: '10:00 - 12:00' },
      7: { name: 'Breeze Tribe', window: '12:00 - 14:00' },
      8: { name: 'Horizon Tribe', window: '14:00 - 16:00' },
      9: { name: 'Sunset Tribe', window: '16:00 - 18:00' },
      10: { name: 'Prime Tribe', window: '18:00 - 20:00' },
      11: { name: 'Starlight Tribe', window: '20:00 - 22:00' },
      12: { name: 'Midnight Tribe', window: '22:00 - 24:00' },
    };

    const activeTribeMeta = TRIBE_NAMES[currentActiveTribe] || TRIBE_NAMES[3];
    const userTribeMeta = user.tribeId ? TRIBE_NAMES[user.tribeId] : activeTribeMeta;
    const liveRoomsCount = this.roomsService.getActiveRoomCount();
    const targetTribeId = user.tribeId ?? currentActiveTribe;
    let tribeUsersCount = 0;
    if (typeof (this.prisma.user as any).count === 'function') {
      tribeUsersCount = await this.prisma.user.count({
        where: { tribeId: targetTribeId },
      });
      if (tribeUsersCount === 0) {
        tribeUsersCount = await this.prisma.user.count();
      }
    }
    const activeMembersCount = tribeUsersCount + liveRoomsCount * 2;
    const bonusTickets = Math.min(99, 5 + lovedCount);
    const contributionPoints = totalSessions * 5 + lovedCount * 5;

    const subRecord = await this.getSubscriptionRecord(user.id);

    return {
      user: {
        id: user.id,
        email: user.email,
        phone: user.phone,
        countryCode: user.countryCode,
        name: user.name,
        country: user.country,
        englishLevel: user.englishLevel,
        bio: user.bio ?? null,
        avatarUrl: user.avatarUrl ?? null,
        tribeId: user.tribeId ?? null,
        planTier: subRecord.planTier,
        aiTokensBalance: subRecord.aiTokensBalance,
      },

      tickets: {
        ticketsLeft,
        maxTickets: 5,
        resetsInSeconds,
        bonusTickets,
      },
      tribe: {
        userTribe: user.tribeId ?? null,
        userTribeName: userTribeMeta?.name || 'Light Tribe',
        currentActiveTribe,
        activeTribeName: activeTribeMeta.name,
        activeTribeWindow: activeTribeMeta.window,
        activeMembersCount,
        isTribeActive,
      },
      stats: {
        streakDays,
        totalSessions,
        totalMinutes,
        countriesCount: countriesSet.size,
        lovedCount,
        blockedCount: userBlocks.length,
        buddiesCount: buddyIdSet.size,
        liveRoomsCount,
        contributionPoints,
      },
      streakWeek,
      recentPartners,
    };
  }

  async joinTribe(userId: string, tribeId: number) {
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { tribeId },
      select: { id: true, tribeId: true },
    });
    return { success: true, tribeId: updated.tribeId };
  }

  async toggleBuddy(userId: string, buddyId: string): Promise<{ isBuddy: boolean }> {
    if (!buddyId || userId === buddyId) {
      throw new BadRequestException('Cannot add yourself as buddy');
    }

    const buddyUser = await this.prisma.user.findUnique({
      where: { id: buddyId },
      select: { id: true },
    });
    if (!buddyUser) {
      throw new NotFoundException('Buddy user not found');
    }

    const existing = await this.prisma.userBuddy.findUnique({
      where: {
        userId_buddyId: {
          userId,
          buddyId,
        },
      },
    });

    if (existing) {
      await this.prisma.userBuddy.delete({
        where: { id: existing.id },
      });
      return { isBuddy: false };
    } else {
      await this.prisma.userBuddy.create({
        data: {
          userId,
          buddyId,
        },
      });
      return { isBuddy: true };
    }
  }

  async getBuddies(userId: string) {
    const buddies = await this.prisma.userBuddy.findMany({
      where: { userId },
      include: {
        buddy: {
          select: { id: true, name: true, email: true, country: true, englishLevel: true },
        },

      },
      orderBy: { createdAt: 'desc' },
    });

    return buddies.map((b) => ({
      id: b.buddy.id,
      name: this.formatDisplayName(b.buddy, 'Buddy'),
      country: b.buddy.country,
      countryFlag: this.getCountryFlag(b.buddy.country),
      englishLevel: b.buddy.englishLevel,
      addedAt: b.createdAt.toISOString(),
    }));

  }


  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.country !== undefined && { country: dto.country }),
        ...(dto.englishLevel !== undefined && { englishLevel: dto.englishLevel }),
        ...(dto.bio !== undefined && { bio: dto.bio }),
        ...(dto.avatarUrl !== undefined && { avatarUrl: dto.avatarUrl }),
      },
      select: {
        id: true,
        email: true,
        name: true,
        country: true,
        englishLevel: true,
        bio: true,
        avatarUrl: true,
        isAdmin: true,
        createdAt: true,
      },
    });


    return { success: true, user: updated };
  }

  async getBlockedUsers(userId: string) {
    const blocks = await this.prisma.userBlock.findMany({
      where: { userId },
      include: {
        blocked: {
          select: { id: true, email: true, name: true, country: true },
        },

      },
      orderBy: { createdAt: 'desc' },
    });

    return blocks.map((b) => ({
      id: b.id,
      blockedUser: {
        id: b.blocked.id,
        name: this.formatDisplayName(b.blocked, 'User'),
        email: this.maskEmail(b.blocked.email),
        country: b.blocked.country,
        flag: this.getCountryFlag(b.blocked.country),
      },

      blockedAt: b.createdAt.toISOString(),
    }));
  }

  async unblockUser(userId: string, blockedId: string) {
    await this.prisma.userBlock.deleteMany({
      where: {
        userId,
        blockedId,
      },
    });

    return { success: true, message: 'User unblocked successfully' };
  }

  async getLeaderboard(userId: string) {
    const usersWithSessions = await this.prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        country: true,

        englishLevel: true,
        avatarUrl: true,
        tribeId: true,
        givenFeedbacks: {
          select: { createdAt: true },
        },
        receivedFeedbacks: {
          select: { partnerRating: true },
        },
      },
      take: 100,
    });

    const userList = usersWithSessions.map((u) => {
      const totalSessions = u.givenFeedbacks.length;
      const totalMinutes = totalSessions * 7;
      const sessionDates = u.givenFeedbacks.map((f) => f.createdAt);
      const { streakDays } = this.computeStreak(sessionDates);
      const lovedCount = u.receivedFeedbacks.filter((f) => f.partnerRating === 'LIKED').length;

      return {
        id: u.id,
        name: this.formatPublicLeaderboardName(u),
        country: u.country || 'Global',

        countryFlag: this.getCountryFlag(u.country),
        avatarUrl: u.avatarUrl,
        englishLevel: u.englishLevel || 'Intermediate',
        tribeId: u.tribeId || 1,
        totalSessions,
        totalMinutes,
        streakDays,
        lovedCount,
      };
    });

    const topSpeakers = [...userList]
      .sort((a, b) => b.totalMinutes - a.totalMinutes)
      .slice(0, 15)
      .map((u, i) => ({ ...u, rank: i + 1 }));

    const topStreaks = [...userList]
      .sort((a, b) => b.streakDays - a.streakDays)
      .slice(0, 15)
      .map((u, i) => ({ ...u, rank: i + 1 }));

    const topLoved = [...userList]
      .sort((a, b) => b.lovedCount - a.lovedCount)
      .slice(0, 15)
      .map((u, i) => ({ ...u, rank: i + 1 }));

    const tribeStats: Record<number, { totalMinutes: number; membersCount: number }> = {};
    for (let t = 1; t <= 12; t++) {
      tribeStats[t] = { totalMinutes: 0, membersCount: 0 };
    }
    userList.forEach((u) => {
      const tr = u.tribeId || 1;
      if (tribeStats[tr]) {
        tribeStats[tr].totalMinutes += u.totalMinutes;
        tribeStats[tr].membersCount += 1;
      }
    });

    const tribeRankings = Object.entries(tribeStats)
      .map(([trId, data]) => ({
        tribeId: Number(trId),
        label: `Tribe ${trId}`,
        totalMinutes: data.totalMinutes,
        membersCount: data.membersCount,
      }))
      .sort((a, b) => b.totalMinutes - a.totalMinutes);

    const speakerIndex = [...userList]
      .sort((a, b) => b.totalMinutes - a.totalMinutes)
      .findIndex((u) => u.id === userId);
    const myRank = speakerIndex !== -1 ? speakerIndex + 1 : topSpeakers.length + 1;

    return {
      topSpeakers,
      topStreaks,
      topLoved,
      tribeRankings,
      myRank,
    };
  }

  private static readonly PLAN_DEFAULT_TOKENS: Record<PlanTierId, number> = {
    FREE: 0,
    PLUS: 500,
    ELITE: 3500,
  };

  private async getSubscriptionRecord(userId: string) {
    const delegate = (this.prisma as any).userSubscription;
    if (delegate?.findUnique) {
      try {
        const record = await delegate.findUnique({ where: { userId } });
        if (record) {
          return {
            userId: record.userId,
            planTier: record.planTier as PlanTierId,
            aiTokensBalance: record.aiTokensBalance,
            updatedAt: record.updatedAt.toISOString(),
          };
        }
        return {
          userId,
          planTier: 'FREE' as PlanTierId,
          aiTokensBalance: 0,
          updatedAt: new Date().toISOString(),
        };
      } catch {
        // Fallback if table not migrated yet
      }
    }
    return subscriptionStore.getSubscription(userId);
  }

  /**
   * Atomically deducts `amount` AI tokens. The check and the decrement happen in one
   * conditional UPDATE, so two parallel requests can never spend the same tokens.
   * Returns null when the balance is too low (nothing is deducted in that case).
   */
  private async tryConsumeAiTokens(userId: string, amount: number) {
    const cost = Math.max(0, Math.floor(amount));
    if (cost === 0) {
      return this.getSubscriptionRecord(userId);
    }
    const result = await this.prisma.userSubscription.updateMany({
      where: { userId, aiTokensBalance: { gte: cost } },
      data: { aiTokensBalance: { decrement: cost } },
    });
    if (result.count === 0) {
      return null;
    }
    return this.getSubscriptionRecord(userId);
  }

  async upgradeSubscription(userId: string, planTier: PlanTierId) {
    const current = await this.getSubscriptionRecord(userId);
    const nextTokens =
      planTier === 'FREE'
        ? 0
        : planTier !== current.planTier
        ? current.aiTokensBalance + UsersService.PLAN_DEFAULT_TOKENS[planTier]
        : current.aiTokensBalance;

    const delegate = (this.prisma as any).userSubscription;
    if (delegate?.upsert) {
      try {
        const saved = await delegate.upsert({
          where: { userId },
          create: {
            userId,
            planTier,
            aiTokensBalance: nextTokens,
          },
          update: {
            planTier,
            aiTokensBalance: nextTokens,
          },
        });
        return {
          success: true,
          planTier: saved.planTier as PlanTierId,
          aiTokensBalance: saved.aiTokensBalance,
          updatedAt: saved.updatedAt.toISOString(),
        };
      } catch {}
    }

    const updated = subscriptionStore.setSubscription(userId, planTier);
    return {
      success: true,
      planTier: updated.planTier,
      aiTokensBalance: updated.aiTokensBalance,
      updatedAt: updated.updatedAt,
    };
  }

  async consumeAiStudioTokens(userId: string, amount: number) {
    const updated = await this.tryConsumeAiTokens(userId, amount);
    if (!updated) {
      throw new BadRequestException('Insufficient AI Tokens balance for this session.');
    }
    return {
      success: true,
      planTier: updated.planTier,
      aiTokensBalance: updated.aiTokensBalance,
    };
  }

  /**
   * Admin-only entry point for the public consume endpoint. A normal user never needs to
   * deduct their own tokens from the client: the server deducts them inside the AI turn.
   */
  async assertCanCallConsumeEndpoint(userId: string) {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, isAdmin: true },
    });
    if (!u || u.isAdmin !== true || !isAdminEmail(u.email)) {
      throw new ForbiddenException('Token deduction is handled by the server.');
    }
  }

  private static readonly FREE_DAILY_AI_TURNS = 5;

  async generateAiCoachTurn(userId: string, dto: AiStudioTurnDto) {
    const cleanText = (dto.userMessage || '').trim();
    if (!cleanText) {
      throw new BadRequestException('Message cannot be empty.');
    }

    // Enforce Free tier daily trial limit (5/day) vs paid AI Token balance
    const sub = await this.getSubscriptionRecord(userId);
    const todayKey = new Date().toISOString().slice(0, 10);
    let remainingFreeTurns: number | undefined;
    let remainingAiTokens = sub.aiTokensBalance;

    if (sub.planTier === 'FREE' && sub.aiTokensBalance <= 0) {
      // Stored in Postgres (one row per user per day) so it survives restarts and deploys.
      // The row is incremented first, then checked, so parallel requests cannot slip past the limit.
      const usage = await this.prisma.aiFreeTurnUsage.upsert({
        where: { userId_dateKey: { userId, dateKey: todayKey } },
        create: { userId, dateKey: todayKey, count: 1 },
        update: { count: { increment: 1 } },
      });
      if (usage.count > UsersService.FREE_DAILY_AI_TURNS) {
        await this.prisma.aiFreeTurnUsage.update({
          where: { userId_dateKey: { userId, dateKey: todayKey } },
          data: { count: { decrement: 1 } },
        });
        throw new BadRequestException(
          `You have used all ${UsersService.FREE_DAILY_AI_TURNS} free daily AI Coach messages. Upgrade to JustSpeak Plus for 500 AI Tokens/month.`,
        );
      }
      remainingFreeTurns = Math.max(0, UsersService.FREE_DAILY_AI_TURNS - usage.count);
    } else if (sub.aiTokensBalance > 0) {
      const updated = await this.tryConsumeAiTokens(userId, 1);
      if (!updated) {
        throw new BadRequestException('Insufficient AI Tokens balance for this session.');
      }
      remainingAiTokens = updated.aiTokensBalance;
    }

    // 1. Optional Real Gemini LLM Coach when GEMINI_API_KEY is configured
    const geminiKey = process.env.GEMINI_API_KEY?.trim();
    if (geminiKey && process.env.NODE_ENV !== 'test') {
      try {
        const prompt = `You are JustSpeak's supportive, honest English speaking coach.
Topic: "${dto.topicTitle}" (${dto.category || 'Conversation'}).
Student just said: "${cleanText}"
Evaluate honestly! If the sentence has major grammar errors or is nonsensical, give low accurate scores (e.g. 15-45) and explain clearly.
Respond ONLY with valid JSON (no markdown) matching:
{
  "reply": "Warm, natural 2-sentence conversational response + one specific follow-up question reacting to what they actually said",
  "corrections": ["Specific grammar/phrasing fix if any, otherwise empty array"],
  "nativeUpgrade": "How a fluent native speaker would naturally rephrase their sentence (empty string if sentence is unintelligible)",
  "tip": "One concise, actionable coaching tip on fluency, vocabulary, or grammar",
  "fluencyScore": 65,
  "grammarScore": 60,
  "vocabScore": 62,
  "suggestedPhrases": ["Phrase starter 1...", "Phrase starter 2..."]
}`;
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(geminiKey)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { temperature: 0.5, maxOutputTokens: 350 },
            }),
          },
        );
        if (res.ok) {
          const data: any = await res.json();
          const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
          const jsonMatch = rawText.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            if (parsed?.reply) {
              const clampScore = (v: any) =>
                typeof v === 'number' && !Number.isNaN(v)
                  ? Math.max(0, Math.min(100, Math.round(v)))
                  : undefined;
              return {
                reply: parsed.reply,
                tip: parsed.tip || 'Keep expanding your ideas with concrete examples.',
                corrections: Array.isArray(parsed.corrections) ? parsed.corrections : [],
                nativeUpgrade: parsed.nativeUpgrade || '',
                fluencyScore: clampScore(parsed.fluencyScore),
                grammarScore: clampScore(parsed.grammarScore),
                vocabScore: clampScore(parsed.vocabScore),
                evaluationMode: 'ai' as const,
                remainingFreeTurns,
                aiTokensBalance: remainingAiTokens,
                suggestedPhrases: Array.isArray(parsed.suggestedPhrases)
                  ? parsed.suggestedPhrases
                  : [],
                wordCount: cleanText.split(/\s+/).filter(Boolean).length,
              };
            }
          }
        }
      } catch {
        // Fall through cleanly to honest basic coaching mode
      }
    }

    // 2. Honest Basic Rule-Based Coaching Fallback (no fake percentage scores)
    const words = cleanText.split(/\s+/).filter(Boolean);
    const wordCount = words.length;

    const grammarRules: { regex: RegExp; fix: string; replaceWith?: string }[] = [
      { regex: /\bi am agree\b/i, fix: 'Use "I agree" instead of "I am agree" (agree is a verb).', replaceWith: 'I agree' },
      { regex: /\b(he|she|it)\s+don'?t\b/i, fix: 'Use "doesn\'t" with he/she/it (e.g., "he doesn\'t").', replaceWith: '$1 doesn\'t' },
      { regex: /\b(he|she|it)\s+are\b/i, fix: 'Use "is" with he/she/it (e.g., "he is").', replaceWith: '$1 is' },
      { regex: /\bme\s+(go|went|going|want|like|have|think|need)\b/i, fix: 'Use "I" as the subject instead of "me" (e.g., "I go").', replaceWith: 'I $1' },
      { regex: /\b(tomorrow\s+yesterday|yesterday\s+tomorrow)\b/i, fix: 'Avoid combining contradictory time words ("tomorrow" and "yesterday").' },
      { regex: /\bmore better\b/i, fix: 'Use "much better" instead of "more better".', replaceWith: 'much better' },
      { regex: /\b(go|went|going)\s+to\s+home\b/i, fix: 'Say "go home" / "went home" without "to".', replaceWith: '$1 home' },
      { regex: /\bdepend\s+of\b/i, fix: 'Use "depend on" instead of "depend of".', replaceWith: 'depend on' },
      { regex: /\binformations\b/i, fix: '"Information" is uncountable—say "information" or "pieces of information".', replaceWith: 'information' },
      { regex: /\badvices\b/i, fix: '"Advice" is uncountable—say "advice" or "a piece of advice".', replaceWith: 'advice' },
      { regex: /\bdiscuss\s+about\b/i, fix: 'Say "discuss [topic]" without "about".', replaceWith: 'discuss' },
      { regex: /\bexplain\s+me\b/i, fix: 'Say "explain to me" instead of "explain me".', replaceWith: 'explain to me' },
      { regex: /\bsuggest\s+me\b/i, fix: 'Say "suggest that I..." or "recommend to me".', replaceWith: 'recommend to me' },
      { regex: /\bi\s+have\s+(\d+)\s+years\b/i, fix: 'For age, say "I am $1 years old" instead of "I have $1 years".', replaceWith: 'I am $1 years old' },
      { regex: /\blook\s+forward\s+to\s+(see|meet|hear|work)\b/i, fix: 'Use -ing after "look forward to" (e.g., "looking forward to meeting").', replaceWith: 'look forward to $1ing' },
    ];

    const corrections: string[] = [];
    let upgradedSentence = cleanText;
    for (const rule of grammarRules) {
      if (rule.regex.test(cleanText)) {
        corrections.push(rule.fix);
        if (rule.replaceWith) {
          upgradedSentence = upgradedSentence.replace(rule.regex, rule.replaceWith);
        }
      }
    }

    // Lexical upgrades for overly basic words
    const vocabUpgrades: [RegExp, string, string][] = [
      [/\bvery good\b/i, 'remarkable', 'Upgrade "very good" → "remarkable" or "compelling".'],
      [/\bvery big\b/i, 'substantial', 'Upgrade "very big" → "substantial" or "significant".'],
      [/\bvery important\b/i, 'essential', 'Upgrade "very important" → "essential" or "crucial".'],
      [/\bi think\b/i, 'From my perspective,', 'Try varying "I think" with "From my perspective," or "I firmly believe".'],
    ];
    for (const [rx, rep, note] of vocabUpgrades) {
      if (rx.test(upgradedSentence)) {
        upgradedSentence = upgradedSentence.replace(rx, rep);
        if (corrections.length < 2) corrections.push(note);
      }
    }

    const hasConnector =
      /\b(because|however|therefore|moreover|for example|in my opinion|personally|furthermore|although|actually|honestly)\b/i.test(
        cleanText,
      );

    // Extract a meaningful keyword from user's sentence to reply contextually
    const stopWords = new Set([
      'the', 'and', 'for', 'that', 'this', 'with', 'have', 'from', 'they', 'would',
      'about', 'there', 'their', 'what', 'when', 'where', 'which', 'really', 'very',
      'just', 'like', 'think', 'know', 'want', 'going', 'because', 'could', 'should',
    ]);
    const keyTerm =
      words
        .map((w) => w.replace(/[^a-zA-Z]/g, '').toLowerCase())
        .find((w) => w.length >= 5 && !stopWords.has(w)) || '';

    const turnIdx = dto.turnIndex ?? 0;
    const contextRef =
      corrections.length > 0
        ? `Let's polish that sentence first — check the grammar note below.`
        : keyTerm
        ? `You raised an interesting point about "${keyTerm}".`
        : `Thanks for sharing your thought on "${dto.topicTitle}".`;

    const followUps = [
      `${contextRef} Could you try expressing that with a real-life example?`,
      `${contextRef} What do you think is the biggest challenge in this situation?`,
      `${contextRef} How would you explain your view to a friend who disagrees?`,
      `${contextRef} How do you expect this to change over the next few years?`,
    ];

    let tip = '';
    if (corrections.length > 0) {
      tip = `Grammar Note: ${corrections[0]}`;
    } else if (wordCount < 8) {
      tip = `Fluency Tip: You spoke ${wordCount} words. Try expanding to 15–25 words using "because..." or "for example...".`;
    } else if (!hasConnector) {
      tip = `Structure Tip: Try linking your ideas with transitions like "However," "For example," or "From my perspective."`;
    } else {
      tip = `Good ${wordCount}-word response with linking phrases. Keep practicing out loud for natural rhythm.`;
    }

    // Only show a rewrite when an actual rule improved the sentence
    const nativeUpgrade = upgradedSentence !== cleanText ? upgradedSentence : '';

    const suggestedPhrases = [
      'From my perspective, the main reason is...',
      'A concrete example from my experience is...',
      'On the other hand, I would argue that...',
    ];

    return {
      reply: followUps[turnIdx % followUps.length],
      tip,
      corrections,
      nativeUpgrade,
      evaluationMode: 'basic' as const,
      remainingFreeTurns,
      aiTokensBalance: remainingAiTokens,
      suggestedPhrases,
      wordCount,
    };
  }

  async getMemos(userId: string) {
    const delegate = (this.prisma as any).partnerMemo;
    if (delegate?.findMany) {
      try {
        const rows = await delegate.findMany({ where: { userId } });
        return rows.map((r: any) => ({
          userId: r.userId,
          partnerId: r.partnerId,
          memo: r.memo,
          updatedAt: r.updatedAt.toISOString(),
        }));
      } catch {}
    }
    return subscriptionStore.getUserMemos(userId);
  }

  async saveMemo(userId: string, partnerId: string, memo: string) {
    if (!partnerId || !partnerId.trim()) {
      throw new BadRequestException('partnerId is required');
    }
    const cleanPartnerId = partnerId.trim();
    const cleanMemo = (memo || '').trim().slice(0, 600);
    const delegate = (this.prisma as any).partnerMemo;
    if (delegate?.upsert) {
      try {
        const saved = await delegate.upsert({
          where: { userId_partnerId: { userId, partnerId: cleanPartnerId } },
          create: { userId, partnerId: cleanPartnerId, memo: cleanMemo },
          update: { memo: cleanMemo },
        });
        return {
          success: true,
          memo: {
            userId: saved.userId,
            partnerId: saved.partnerId,
            memo: saved.memo,
            updatedAt: saved.updatedAt.toISOString(),
          },
        };
      } catch {}
    }
    const saved = subscriptionStore.saveUserMemo(userId, cleanPartnerId, cleanMemo);
    return {
      success: true,
      memo: saved,
    };
  }

  async getAcademyProgress(userId: string) {
    const delegate = (this.prisma as any).academyProgress;
    if (delegate?.findUnique) {
      try {
        const row = await delegate.findUnique({ where: { userId } });
        if (row) {
          return {
            progress: {
              userId: row.userId,
              cefrLevel: row.cefrLevel,
              placementCompleted: row.placementCompleted,
              dailySpeakingGoalMins: row.dailySpeakingGoalMins,
              learnedWordIds: row.learnedWordIds || [],
              completedLessonIds: row.completedLessonIds || [],
              completedReadingIds: row.completedReadingIds || [],
              completedListeningIds: row.completedListeningIds || [],
              completedShadowingIds: row.completedShadowingIds || [],
              completedPronunciationIds: row.completedPronunciationIds || [],
              dailyCompletedTaskIds: row.dailyCompletedTaskIds || [],
              dailyDateKey: row.dailyDateKey || '',
              scores: row.scores as any,
              updatedAt: row.updatedAt.toISOString(),
            },
          };
        }
        return { progress: null };
      } catch {}
    }
    return {
      progress: subscriptionStore.getAcademyProgress(userId),
    };
  }

  async saveAcademyProgress(userId: string, body: any) {
    const validLevels = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
    const cefrLevel = validLevels.includes(body?.cefrLevel) ? body.cefrLevel : 'B1';
    const clamp = (n: any, fallback = 65) =>
      typeof n === 'number' && !Number.isNaN(n)
        ? Math.max(0, Math.min(100, Math.round(n)))
        : fallback;

    const payload = {
      cefrLevel,
      placementCompleted: Boolean(body?.placementCompleted),
      dailySpeakingGoalMins:
        typeof body?.dailySpeakingGoalMins === 'number' ? body.dailySpeakingGoalMins : 21,
      learnedWordIds: Array.isArray(body?.learnedWordIds) ? body.learnedWordIds.slice(0, 500) : [],
      completedLessonIds: Array.isArray(body?.completedLessonIds)
        ? body.completedLessonIds.slice(0, 200)
        : [],
      completedReadingIds: Array.isArray(body?.completedReadingIds)
        ? body.completedReadingIds.slice(0, 200)
        : [],
      completedListeningIds: Array.isArray(body?.completedListeningIds)
        ? body.completedListeningIds.slice(0, 200)
        : [],
      completedShadowingIds: Array.isArray(body?.completedShadowingIds)
        ? body.completedShadowingIds.slice(0, 200)
        : [],
      completedPronunciationIds: Array.isArray(body?.completedPronunciationIds)
        ? body.completedPronunciationIds.slice(0, 200)
        : [],
      dailyCompletedTaskIds: Array.isArray(body?.dailyCompletedTaskIds)
        ? body.dailyCompletedTaskIds.slice(0, 20)
        : [],
      dailyDateKey:
        typeof body?.dailyDateKey === 'string'
          ? body.dailyDateKey.slice(0, 16)
          : new Date().toISOString().slice(0, 10),
      scores: {
        fluency: clamp(body?.scores?.fluency, 68),
        pronunciation: clamp(body?.scores?.pronunciation, 65),
        vocabulary: clamp(body?.scores?.vocabulary, 70),
        grammar: clamp(body?.scores?.grammar, 66),
      },
    };

    const delegate = (this.prisma as any).academyProgress;
    if (delegate?.upsert) {
      try {
        const saved = await delegate.upsert({
          where: { userId },
          create: { userId, ...payload },
          update: payload,
        });
        return {
          success: true,
          progress: {
            ...payload,
            userId: saved.userId,
            updatedAt: saved.updatedAt.toISOString(),
          },
        };
      } catch {}
    }

    const saved = subscriptionStore.saveAcademyProgress(userId, payload);
    return {
      success: true,
      progress: saved,
    };
  }

  private formatPublicLeaderboardName(user: { name?: string | null; email?: string | null }): string {
    const raw = (user.name || '').trim();
    if (raw) {
      const parts = raw.split(/\s+/).filter(Boolean);
      if (parts.length === 1) return parts[0];
      return `${parts[0]} ${parts[1].charAt(0).toUpperCase()}.`;
    }
    if (user.email) {
      const local = user.email.split('@')[0];
      return local.slice(0, 12);
    }
    return 'Learner';
  }

  async translateCustomWord(rawInput: string) {
    const clean = (rawInput || '').trim().slice(0, 120);
    if (!clean) {
      throw new BadRequestException('Please enter a word or phrase to translate.');
    }

    const isArabicInput = /[\u0600-\u06FF]/.test(clean);
    const geminiKey = process.env.GEMINI_API_KEY?.trim();

    if (geminiKey && process.env.NODE_ENV !== 'test') {
      try {
        const prompt = `You are a precise English-Arabic dictionary assistant for English learners.
Input (${isArabicInput ? 'Arabic' : 'English'}): "${clean}"
Return ONLY valid JSON (no markdown) matching:
{
  "word": "Natural English word or short phrase (capitalized properly if needed, otherwise lowercase)",
  "meaningAr": "Clear, natural Arabic translation",
  "meaningEn": "Short, clear English learner definition (max 18 words)",
  "example": "One natural everyday English example sentence using the English word",
  "ipa": "Approximate IPA pronunciation like /rɪˈzɪl.jənt/ or empty string if a phrase",
  "pos": "noun | verb | adjective | adverb | phrase",
  "level": "A1 | A2 | B1 | B2 | C1 | C2"
}`;
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(geminiKey)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { temperature: 0.2, maxOutputTokens: 250 },
            }),
          },
        );
        if (res.ok) {
          const data: any = await res.json();
          const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
          const jsonMatch = rawText.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            if (parsed?.word && parsed?.meaningAr) {
              const validLevels = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
              return {
                word: String(parsed.word).trim(),
                meaningAr: String(parsed.meaningAr).trim(),
                meaningEn:
                  String(parsed.meaningEn || '').trim() ||
                  `English equivalent of "${clean}".`,
                example:
                  String(parsed.example || '').trim() ||
                  `I want to use "${String(parsed.word).trim()}" in my next conversation.`,
                ipa: String(parsed.ipa || '').trim(),
                pos: String(parsed.pos || 'word').trim(),
                level: validLevels.includes(parsed.level) ? parsed.level : 'B1',
                sourceLang: isArabicInput ? 'ar' : 'en',
              };
            }
          }
        }
      } catch {
        // Fall through to public dictionary translation fallback
      }
    }

    // Fallback: MyMemory free translation API (EN <-> AR)
    if (process.env.NODE_ENV !== 'test') {
      try {
        const langpair = isArabicInput ? 'ar|en' : 'en|ar';
        const mmRes = await fetch(
          `https://api.mymemory.translated.net/get?q=${encodeURIComponent(clean)}&langpair=${encodeURIComponent(langpair)}`,
        );
        if (mmRes.ok) {
          const mmData: any = await mmRes.json();
          const translated = String(mmData?.responseData?.translatedText || '').trim();
          if (translated && translated.toLowerCase() !== clean.toLowerCase()) {
            const englishWord = isArabicInput ? translated : clean;
            const arabicMeaning = isArabicInput ? clean : translated;
            return {
              word: englishWord,
              meaningAr: arabicMeaning,
              meaningEn: `Personal vocabulary item (${englishWord}).`,
              example: `Try using "${englishWord}" in a sentence during your next speaking call.`,
              ipa: '',
              pos: englishWord.includes(' ') ? 'phrase' : 'word',
              level: 'B1',
              sourceLang: isArabicInput ? 'ar' : 'en',
            };
          }
        }
      } catch {}
    }

    return {
      word: isArabicInput ? clean : clean,
      meaningAr: isArabicInput ? clean : 'ترجمة غير متوفرة حالياً',
      meaningEn: `Custom saved word: ${clean}`,
      example: `Practice saying "${clean}" out loud in a full sentence.`,
      ipa: '',
      pos: clean.includes(' ') ? 'phrase' : 'word',
      level: 'B1',
      sourceLang: isArabicInput ? 'ar' : 'en',
    };
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string) {
    if (!currentPassword || !newPassword) {
      throw new BadRequestException('Current password and new password are required.');
    }
    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string') {
      throw new BadRequestException('Passwords must be text.');
    }
    if (newPassword.length < 8) {
      throw new BadRequestException('New password must be at least 8 characters long.');
    }
    if (newPassword.length > 72 || currentPassword.length > 72) {
      throw new BadRequestException('Password must not exceed 72 characters.');
    }
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    const matches = await bcrypt.compare(currentPassword, user.password);
    if (!matches) {
      throw new UnauthorizedException('Current password is incorrect.');
    }
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await this.prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword },
    });
    return { success: true, message: 'Password updated successfully.' };
  }

  async deleteOwnAccount(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, phone: true },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    const identifiersToClean: string[] = [];
    if (user.email) identifiersToClean.push(user.email.trim().toLowerCase());
    if (user.phone) identifiersToClean.push(user.phone.trim());
    if (identifiersToClean.length > 0 && (this.prisma as any).otpCode?.deleteMany) {
      await this.prisma.otpCode.deleteMany({
        where: {
          OR: identifiersToClean.map((identifier) => ({
            identifier: { equals: identifier, mode: 'insensitive' },
          })),
        },
      });
    }
    await this.prisma.user.delete({ where: { id: user.id } });
    return { success: true, message: 'Account deleted permanently.' };
  }
}


