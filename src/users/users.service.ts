import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { UpdateProfileDto } from './dto';

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
  };

  tickets: {
    ticketsLeft: number;
    maxTickets: number;
    resetsInSeconds: number;
  };
  tribe?: {
    userTribe: number | null;
    currentActiveTribe: number;
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
  };
  streakWeek: Array<{ dayNumber: number; completed: boolean; label: string }>;
  recentPartners: RecentPartnerDto[];
}



@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

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
      throw new Error('User not found');
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
            select: { id: true, name: true, email: true, phone: true, country: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.sessionFeedback.findMany({
        where: { receiverId: userId },
        include: {
          giver: {
            select: { id: true, name: true, email: true, phone: true, country: true },
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
          name: partner.name || (partner.email ? partner.email.split('@')[0] : (partner.phone || 'Partner')),
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
          name: partner.name || (partner.email ? partner.email.split('@')[0] : (partner.phone || 'Partner')),
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
      },

      tickets: {
        ticketsLeft,
        maxTickets: 5,
        resetsInSeconds,
      },
      tribe: {
        userTribe: user.tribeId ?? null,
        currentActiveTribe,
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
        liveRoomsCount: 42 + Math.floor(Math.random() * 15),
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

    if (userId === buddyId) {
      throw new Error('Cannot add yourself as buddy');
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
          select: { id: true, name: true, email: true, phone: true, country: true, englishLevel: true },
        },

      },
      orderBy: { createdAt: 'desc' },
    });

    return buddies.map((b) => ({
      id: b.buddy.id,
      name: b.buddy.name || (b.buddy.email ? b.buddy.email.split('@')[0] : (b.buddy.phone || 'Buddy')),
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
          select: { id: true, email: true, phone: true, name: true, country: true },
        },

      },
      orderBy: { createdAt: 'desc' },
    });

    return blocks.map((b) => ({
      id: b.id,
      blockedUser: {
        id: b.blocked.id,
        name: b.blocked.name || (b.blocked.email ? b.blocked.email.split('@')[0] : (b.blocked.phone || 'User')),
        email: b.blocked.email,
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
        phone: true,
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
        name: u.name || (u.email ? u.email.split('@')[0] : (u.phone || 'Learner')),
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
}

