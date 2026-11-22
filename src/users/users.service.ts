import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
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

    const subRecord = subscriptionStore.getSubscription(user.id);

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
        name: this.formatDisplayName(u, 'Learner'),
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

  async upgradeSubscription(userId: string, planTier: PlanTierId) {
    const updated = subscriptionStore.setSubscription(userId, planTier);
    return {
      success: true,
      planTier: updated.planTier,
      aiTokensBalance: updated.aiTokensBalance,
      updatedAt: updated.updatedAt,
    };
  }

  async consumeAiStudioTokens(userId: string, amount: number) {
    const current = subscriptionStore.getSubscription(userId);
    if (current.aiTokensBalance < amount) {
      throw new BadRequestException('Insufficient AI Tokens balance for this session.');
    }
    const updated = subscriptionStore.consumeAiTokens(userId, amount);
    return {
      success: true,
      planTier: updated.planTier,
      aiTokensBalance: updated.aiTokensBalance,
    };
  }

  async generateAiCoachTurn(userId: string, dto: AiStudioTurnDto) {
    const cleanText = (dto.userMessage || '').trim();
    if (!cleanText) {
      throw new BadRequestException('Message cannot be empty.');
    }

    // 1. Optional Real Gemini LLM Coach when GEMINI_API_KEY is configured
    const geminiKey = process.env.GEMINI_API_KEY?.trim();
    if (geminiKey && process.env.NODE_ENV !== 'test') {
      try {
        const prompt = `You are JustSpeak's supportive Oxford-trained English speaking coach.
Topic: "${dto.topicTitle}" (${dto.category || 'Conversation'}).
Student just said: "${cleanText}"
Respond ONLY with valid JSON (no markdown) matching:
{
  "reply": "Warm, natural 2-sentence conversational response + one specific follow-up question reacting to what they actually said",
  "corrections": ["Specific grammar/phrasing fix if any, otherwise empty array"],
  "nativeUpgrade": "How a fluent native speaker would naturally rephrase their sentence",
  "tip": "One concise, actionable coaching tip on fluency, vocabulary, or grammar",
  "fluencyScore": 85,
  "grammarScore": 86,
  "vocabScore": 84,
  "suggestedPhrases": ["Phrase starter 1...", "Phrase starter 2..."]
}`;
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(geminiKey)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { temperature: 0.6, maxOutputTokens: 350 },
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
              return {
                reply: parsed.reply,
                tip: parsed.tip || 'Keep expanding your ideas with concrete examples.',
                corrections: Array.isArray(parsed.corrections) ? parsed.corrections : [],
                nativeUpgrade: parsed.nativeUpgrade || '',
                fluencyScore: Number(parsed.fluencyScore) || 88,
                grammarScore: Number(parsed.grammarScore) || 86,
                vocabScore: Number(parsed.vocabScore) || 85,
                suggestedPhrases: Array.isArray(parsed.suggestedPhrases)
                  ? parsed.suggestedPhrases
                  : [],
                wordCount: cleanText.split(/\s+/).filter(Boolean).length,
              };
            }
          }
        }
      } catch {
        // Fall through cleanly to local intelligent NLP coach
      }
    }

    // 2. Smart Local NLP Grammar, Vocabulary & Context Coaching Engine
    const words = cleanText.split(/\s+/).filter(Boolean);
    const wordCount = words.length;

    const grammarRules: { regex: RegExp; fix: string; replaceWith?: string }[] = [
      { regex: /\bi am agree\b/i, fix: 'Use "I agree" instead of "I am agree" (agree is a verb).', replaceWith: 'I agree' },
      { regex: /\b(he|she|it)\s+don'?t\b/i, fix: 'Use "doesn\'t" with he/she/it (e.g., "he doesn\'t").', replaceWith: '$1 doesn\'t' },
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

    // Extract a meaningful keyword from user's sentence to reply contextually!
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
    const contextRef = keyTerm
      ? `You raised an interesting point about "${keyTerm}".`
      : `That's a thoughtful take on "${dto.topicTitle}".`;

    const followUps = [
      `${contextRef} Could you walk me through a real-life example or moment when you experienced that?`,
      `${contextRef} On the other hand, what do you think is the toughest challenge someone faces in this situation?`,
      `${contextRef} If you had to convince a colleague or friend who completely disagreed with you, what would be your strongest argument?`,
      `${contextRef} Looking ahead 3 to 5 years, how do you expect this to evolve?`,
    ];

    let fluencyScore = 88;
    let grammarScore = Math.max(68, 95 - corrections.length * 9);
    let vocabScore = hasConnector ? 92 : 82;
    let tip = '';

    if (wordCount < 8) {
      tip = `Fluency Tip: You spoke ${wordCount} words. Aim for 15–25 words by adding "because..." or "for instance..." to sound more natural.`;
      fluencyScore = 76;
    } else if (corrections.length > 0) {
      tip = `Precision Coach: ${corrections[0]}`;
      fluencyScore = 86;
    } else if (!hasConnector) {
      tip = `Vocabulary Boost: Solid ${wordCount}-word answer! Try linking your next idea with "Furthermore," or "From my perspective."`;
      fluencyScore = 90;
    } else {
      tip = `Native-Level Flow: Awesome ${wordCount}-word response with strong grammar and discourse connectors!`;
      fluencyScore = 96;
    }

    const nativeUpgrade =
      upgradedSentence !== cleanText
        ? upgradedSentence
        : wordCount < 10
        ? `From my perspective, ${cleanText.charAt(0).toLowerCase()}${cleanText.slice(1).replace(/\.$/, '')}, because it creates a lasting impact.`
        : '';

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
      fluencyScore,
      grammarScore,
      vocabScore,
      suggestedPhrases,
      wordCount,
    };
  }

  async getMemos(userId: string) {
    return subscriptionStore.getUserMemos(userId);
  }

  async saveMemo(userId: string, partnerId: string, memo: string) {
    if (!partnerId || !partnerId.trim()) {
      throw new BadRequestException('partnerId is required');
    }
    const saved = subscriptionStore.saveUserMemo(userId, partnerId.trim(), memo || '');
    return {
      success: true,
      memo: saved,
    };
  }

  async getAcademyProgress(userId: string) {
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

    const saved = subscriptionStore.saveAcademyProgress(userId, {
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
    });

    return {
      success: true,
      progress: saved,
    };
  }
}


