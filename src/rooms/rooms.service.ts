import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { randomBytes, randomInt } from 'crypto';
import { PrismaService } from '../prisma.service';

export interface TopicItem {
  id: string;
  category: string;
  question: string;
  prompts?: string[];
}

export interface CreatedRoom {
  sessionId: string;
  roomName: string;
  roomUrl: string;
  topic: string;
  prompts?: string[];
  topicQuestions?: string[];
  partnerId: string;
  partnerName?: string;
  partnerCountry?: string;
}

export interface QueueStatus {
  status: 'matched' | 'waiting';
  room?: CreatedRoom;
}

// 30+ Curated High-Engagement Conversation Topics
const ENGLISH_TOPICS: TopicItem[] = [
  // 1. Travel & Culture
  {
    id: 'travel-1',
    category: 'Travel & Culture',
    question: 'What is the most memorable place or city you have ever visited, and why?',
    prompts: ['What made it special?', 'What was the food or culture like?'],
  },
  {
    id: 'travel-2',
    category: 'Travel & Culture',
    question: 'If you could travel anywhere in the world tomorrow with all expenses paid, where would you go?',
    prompts: ['Who would you take with you?', 'What is the first thing you would do there?'],
  },
  {
    id: 'travel-3',
    category: 'Travel & Culture',
    question: 'What is one traditional custom or celebration from your country that foreigners find fascinating?',
    prompts: ['How do people celebrate it?', 'What traditional dishes are served?'],
  },
  // 2. Learning & Skills
  {
    id: 'skills-1',
    category: 'Learning & Dreams',
    question: 'If you could master any skill or language overnight, what would you choose?',
    prompts: ['Why this skill?', 'How would it change your daily life or career?'],
  },
  {
    id: 'skills-2',
    category: 'Learning & Dreams',
    question: 'What is the most effective habit or method that helps you improve your English speaking?',
    prompts: ['Do you watch podcasts, movies, or speak with friends?', 'What is the hardest part?'],
  },
  // 3. Food & Cooking
  {
    id: 'food-1',
    category: 'Food & Cooking',
    question: 'What is your favorite comfort food or traditional dish from your country?',
    prompts: ['Do you know how to cook it?', 'When do you usually eat it?'],
  },
  {
    id: 'food-2',
    category: 'Food & Cooking',
    question: 'What is the weirdest or most exotic food you have ever tried?',
    prompts: ['Did you like it?', 'Where were you when you tried it?'],
  },
  // 4. Daily Routine & Lifestyle
  {
    id: 'habits-1',
    category: 'Daily Routine',
    question: 'What is the best part of your daily routine that helps you relax or stay energized?',
    prompts: ['Are you a morning person or night owl?', 'How do you unwind after work or study?'],
  },
  {
    id: 'habits-2',
    category: 'Daily Routine',
    question: 'If you could change one daily habit to make your life 10% better, what would it be?',
    prompts: ['Why haven’t you changed it yet?', 'What is your plan to start?'],
  },
  // 5. Work, Tech & Career
  {
    id: 'work-1',
    category: 'Work & Tech',
    question: 'Do you prefer working remotely from home or at an office with teammates?',
    prompts: ['What are the pros and cons?', 'What is your ideal work environment?'],
  },
  {
    id: 'work-2',
    category: 'Work & Tech',
    question: 'How do you think Artificial Intelligence (AI) will change your field of work in the next 5 years?',
    prompts: ['Are you excited or concerned?', 'What AI tools do you use daily?'],
  },
  // 6. Entertainment & Pop Culture
  {
    id: 'movies-1',
    category: 'Entertainment',
    question: 'What is a movie, TV series, or book that left a strong emotional impression on you recently?',
    prompts: ['Who was your favorite character?', 'Would you recommend it to your friends?'],
  },
  {
    id: 'music-1',
    category: 'Entertainment',
    question: 'What kind of music or playlist do you listen to when you need to focus or relax?',
    prompts: ['Do you prefer English songs or songs from your country?', 'Who is your favorite artist?'],
  },
  // 7. Life & Deep Questions
  {
    id: 'goals-1',
    category: 'Goals & Future',
    question: 'What is a personal or professional goal you are actively working on right now?',
    prompts: ['What inspired this goal?', 'What steps are you taking each week?'],
  },
  {
    id: 'life-1',
    category: 'Life & Philosophy',
    question: 'What is the best piece of advice anyone has ever given you that you still follow today?',
    prompts: ['Who gave it to you?', 'How did it help you in difficult times?'],
  },
  {
    id: 'free-time-1',
    category: 'Leisure',
    question: 'If you were given a completely free afternoon with no obligations, what would you do?',
    prompts: ['Would you stay home or go outdoors?', 'Who would you spend it with?'],
  },
];

export interface AuthorizedRoomRegistration {
  roomName: string;
  authorizedUserIds: Set<string>;
  createdAt: Date;
  expiresAt: Date;
  isClosed: boolean;
}

interface PendingMatchEntry {
  room: CreatedRoom;
  expiresAt: number;
}

@Injectable()
export class RoomsService {
  private readonly appRoomBaseUrl = '/room';
  private waitingQueue: string[] = [];
  private queuePrefs: Map<string, { differentCountryOnly: boolean }> = new Map();
  private matchedRooms: Map<string, PendingMatchEntry> = new Map();
  private readonly matchedRoomTtlMs = 2 * 60 * 1000; // 2 minutes to claim match

  // In-process async mutex to serialize queue operations across await points
  private queueMutex: Promise<void> = Promise.resolve();

  // In-memory room authorization registry
  private roomRegistry: Map<string, AuthorizedRoomRegistration> = new Map();
  private readonly defaultRoomTtlMs = 60 * 60 * 1000; // 60 minutes TTL

  constructor(private readonly prisma: PrismaService) {}

  private async withQueueLock<T>(fn: () => Promise<T>): Promise<T> {
    const previous = this.queueMutex;
    let release!: () => void;
    this.queueMutex = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  }

  private formatDisplayName(
    user: { name?: string | null; email?: string | null } | null | undefined,
    fallback: string = 'Learner',
  ): string {
    const trimmedName = user?.name?.trim();
    if (trimmedName) {
      return trimmedName;
    }
    if (user?.email && user.email.includes('@')) {
      const localPart = user.email.split('@')[0].trim();
      if (localPart) {
        return localPart;
      }
    }
    return fallback;
  }

  registerRoomAuthorization(
    roomName: string,
    userIds: string[],
    ttlMs: number = this.defaultRoomTtlMs,
  ): void {
    this.cleanupExpiredRegistrations();
    const cleanUserIds = userIds
      .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
      .map((id) => id.trim());

    const now = new Date();
    this.roomRegistry.set(roomName.trim(), {
      roomName: roomName.trim(),
      authorizedUserIds: new Set(cleanUserIds),
      createdAt: now,
      expiresAt: new Date(now.getTime() + ttlMs),
      isClosed: false,
    });
  }

  getAuthorizedUsersForRoom(roomName: string): string[] {
    if (!roomName) return [];
    const reg = this.roomRegistry.get(roomName.trim());
    if (!reg || reg.isClosed || Date.now() > reg.expiresAt.getTime()) {
      return [];
    }
    return Array.from(reg.authorizedUserIds);
  }

  getActiveRoomCount(): number {
    this.cleanupExpiredRegistrations();
    return this.roomRegistry.size;
  }

  isUserAuthorizedForRoom(
    roomName: string,
    userId: string,
  ): {
    authorized: boolean;
    reason?: 'NOT_FOUND' | 'EXPIRED' | 'CLOSED' | 'UNAUTHORIZED_USER';
  } {
    if (!roomName || !userId) {
      return { authorized: false, reason: 'NOT_FOUND' };
    }

    const trimmedRoom = roomName.trim();
    const trimmedUser = userId.trim();
    const registration = this.roomRegistry.get(trimmedRoom);

    if (!registration) {
      return { authorized: false, reason: 'NOT_FOUND' };
    }

    if (registration.isClosed) {
      return { authorized: false, reason: 'CLOSED' };
    }

    if (Date.now() > registration.expiresAt.getTime()) {
      this.roomRegistry.delete(trimmedRoom);
      return { authorized: false, reason: 'EXPIRED' };
    }

    if (!registration.authorizedUserIds.has(trimmedUser)) {
      return { authorized: false, reason: 'UNAUTHORIZED_USER' };
    }

    return { authorized: true };
  }

  closeRoomSession(roomName: string): void {
    const trimmed = roomName?.trim();
    if (!trimmed) return;
    const registration = this.roomRegistry.get(trimmed);
    if (registration) {
      registration.isClosed = true;
    }
  }

  private cleanupExpiredRegistrations(): void {
    const now = Date.now();
    for (const [roomName, reg] of this.roomRegistry.entries()) {
      if (now > reg.expiresAt.getTime() || reg.isClosed) {
        this.roomRegistry.delete(roomName);
      }
    }
  }

  private cleanupExpiredMatches(): void {
    const now = Date.now();
    for (const [uid, entry] of this.matchedRooms.entries()) {
      if (now > entry.expiresAt) {
        this.matchedRooms.delete(uid);
      }
    }
  }

  private pickRandomTopic(): TopicItem {
    return ENGLISH_TOPICS[randomInt(0, ENGLISH_TOPICS.length)];
  }

  async createRoom(creatorUserId: string): Promise<CreatedRoom> {
    if (!creatorUserId || typeof creatorUserId !== 'string' || !creatorUserId.trim()) {
      throw new BadRequestException(
        'Authenticated creator user ID is required to create a room.',
      );
    }

    const cleanCreatorId = creatorUserId.trim();
    const randomId = randomBytes(8).toString('hex');
    const sessionId = randomBytes(12).toString('hex');
    const roomName = `JustSpeak-${randomId}`;
    const selectedTopic = this.pickRandomTopic();

    // Persist session with authorized participant
    await this.prisma.session.create({
      data: {
        id: sessionId,
        roomName,
        topic: selectedTopic.question,
        participantIds: [cleanCreatorId],
      },
    });

    this.registerRoomAuthorization(roomName, [cleanCreatorId]);

    return {
      sessionId,
      roomName,
      roomUrl: `${this.appRoomBaseUrl}/${roomName}`,
      topic: selectedTopic.question,
      prompts: selectedTopic.prompts,
      topicQuestions: ENGLISH_TOPICS.map((t) => t.question),
      partnerId: '',
    };
  }

  private readonly ticketResetIntervalMs = 24 * 60 * 60 * 1000;

  private async resolveUserTickets(user: any): Promise<number> {
    const now = new Date();
    const hasLastReset =
      user.lastTicketReset !== undefined && user.lastTicketReset !== null;
    const lastResetDate = hasLastReset ? new Date(user.lastTicketReset) : null;
    const msSinceReset =
      lastResetDate && !Number.isNaN(lastResetDate.getTime())
        ? now.getTime() - lastResetDate.getTime()
        : 0;

    if (hasLastReset && msSinceReset >= this.ticketResetIntervalMs) {
      if (typeof (this.prisma.user as any).update === 'function') {
        await (this.prisma.user as any).update({
          where: { id: user.id },
          data: { ticketsLeft: 5, lastTicketReset: now },
        });
      } else if (typeof this.prisma.user.updateMany === 'function') {
        await this.prisma.user.updateMany({
          where: { id: user.id },
          data: { ticketsLeft: 5, lastTicketReset: now } as any,
        });
      }
      user.ticketsLeft = 5;
      user.lastTicketReset = now;
      return 5;
    }

    return typeof user.ticketsLeft === 'number' ? user.ticketsLeft : 5;
  }

  async joinQueue(userId: string, differentCountryOnly: boolean = false): Promise<QueueStatus> {
    if (!userId || typeof userId !== 'string' || !userId.trim()) {
      throw new BadRequestException('Valid authenticated userId is required.');
    }
    const cleanUserId = userId.trim();

    return this.withQueueLock(async () => {
      this.cleanupExpiredMatches();

      // 1. Check if user already got matched by another partner
      const pendingMatch = this.matchedRooms.get(cleanUserId);
      if (pendingMatch) {
        this.matchedRooms.delete(cleanUserId);
        this.waitingQueue = this.waitingQueue.filter((id) => id !== cleanUserId);
        this.queuePrefs.delete(cleanUserId);
        return { status: 'matched', room: pendingMatch.room };
      }

      // 2. Verify caller exists and has available daily tickets (after applying 24h reset)
      const currentUser = await this.prisma.user.findUnique({
        where: { id: cleanUserId },
      });
      if (!currentUser) {
        throw new NotFoundException('User not found');
      }

      const callerTickets = await this.resolveUserTickets(currentUser);
      if (callerTickets <= 0) {
        this.waitingQueue = this.waitingQueue.filter((id) => id !== cleanUserId);
        this.queuePrefs.delete(cleanUserId);
        throw new BadRequestException(
          'No daily tickets remaining. Please wait for your daily ticket recharge.',
        );
      }

      // 3. Fetch all blocks involving current user
      const blocks = await this.prisma.userBlock.findMany({
        where: {
          OR: [{ userId: cleanUserId }, { blockedId: cleanUserId }],
        },
      });

      const blockedUserIds = new Set<string>();
      for (const b of blocks) {
        if (b.userId === cleanUserId) blockedUserIds.add(b.blockedId);
        if (b.blockedId === cleanUserId) blockedUserIds.add(b.userId);
      }

      // 4. Find candidate partner in queue who is NOT blocked, has >0 tickets & passes country filter
      let partnerId: string | null = null;
      let partnerUser: any = null;
      const staleCandidateIds: string[] = [];

      for (let i = 0; i < this.waitingQueue.length; i++) {
        const candidateId = this.waitingQueue[i];
        if (candidateId === cleanUserId) continue;
        if (blockedUserIds.has(candidateId)) continue;
        if (this.matchedRooms.has(candidateId)) continue;

        const candidate = await this.prisma.user.findUnique({
          where: { id: candidateId },
        });
        if (!candidate) {
          staleCandidateIds.push(candidateId);
          continue;
        }

        const candidateTickets = await this.resolveUserTickets(candidate);
        if (candidateTickets <= 0) {
          staleCandidateIds.push(candidateId);
          continue;
        }

        const candidatePref = this.queuePrefs.get(candidateId);

        // Check Country Filter (if either requested different country)
        const shouldFilterCountry =
          differentCountryOnly || candidatePref?.differentCountryOnly;
        if (
          shouldFilterCountry &&
          currentUser?.country &&
          candidate?.country &&
          currentUser.country.toLowerCase().trim() ===
            candidate.country.toLowerCase().trim()
        ) {
          continue;
        }

        partnerId = candidateId;
        partnerUser = candidate;
        break;
      }

      if (staleCandidateIds.length > 0) {
        const staleSet = new Set(staleCandidateIds);
        this.waitingQueue = this.waitingQueue.filter((id) => !staleSet.has(id));
        for (const staleId of staleCandidateIds) {
          this.queuePrefs.delete(staleId);
        }
      }

      if (partnerId !== null) {
        const randomSuffix = randomBytes(6).toString('hex');
        const roomName = `justspeak-${randomSuffix}`;
        const commonUrl = `${this.appRoomBaseUrl}/${roomName}`;
        const selectedTopic = this.pickRandomTopic();

        // Collect randomized topic list with selected topic as first
        const otherQuestions = ENGLISH_TOPICS.filter(
          (t) => t.id !== selectedTopic.id,
        ).map((t) => t.question);
        const allQuestions = [selectedTopic.question, ...otherQuestions];

        // Persist session & deduct tickets BEFORE mutating in-memory queue so any DB failure
        // leaves the waiting partner safely in the queue without state corruption.
        const deductResult = await this.prisma.user.updateMany({
          where: { id: { in: [cleanUserId, partnerId] }, ticketsLeft: { gt: 0 } },
          data: { ticketsLeft: { decrement: 1 } },
        });
        if (
          deductResult &&
          typeof deductResult.count === 'number' &&
          deductResult.count < 2
        ) {
          throw new BadRequestException(
            'Unable to start session because a participant has no remaining tickets.',
          );
        }

        const session = await this.prisma.session.create({
          data: {
            roomName,
            topic: selectedTopic.question,
            participantIds: [cleanUserId, partnerId],
          },
        });

        // Remove BOTH partner and current user from waiting queue & preferences
        this.waitingQueue = this.waitingQueue.filter(
          (id) => id !== partnerId && id !== cleanUserId,
        );
        this.queuePrefs.delete(partnerId);
        this.queuePrefs.delete(cleanUserId);

        this.registerRoomAuthorization(roomName, [cleanUserId, partnerId]);

        const sessionId = session.id;

        const roomForPartner: CreatedRoom = {
          sessionId,
          roomName,
          roomUrl: commonUrl,
          topic: selectedTopic.question,
          prompts: selectedTopic.prompts,
          topicQuestions: allQuestions,
          partnerId: cleanUserId,
          partnerName: this.formatDisplayName(currentUser, 'Learner'),
          partnerCountry: currentUser?.country || undefined,
        };

        const roomForCurrent: CreatedRoom = {
          sessionId,
          roomName,
          roomUrl: commonUrl,
          topic: selectedTopic.question,
          prompts: selectedTopic.prompts,
          topicQuestions: allQuestions,
          partnerId,
          partnerName: this.formatDisplayName(partnerUser, 'Learner'),
          partnerCountry: partnerUser?.country || undefined,
        };

        this.matchedRooms.set(partnerId, {
          room: roomForPartner,
          expiresAt: Date.now() + this.matchedRoomTtlMs,
        });
        return { status: 'matched', room: roomForCurrent };
      }

      // 4. If user not already in queue, add them with preferences
      if (!this.waitingQueue.includes(cleanUserId)) {
        this.waitingQueue.push(cleanUserId);
      }
      this.queuePrefs.set(cleanUserId, { differentCountryOnly });

      return { status: 'waiting' };
    });
  }

  async leaveQueue(userId: string): Promise<void> {
    if (!userId) return;
    const cleanUserId = userId.trim();
    await this.withQueueLock(async () => {
      this.waitingQueue = this.waitingQueue.filter((id) => id !== cleanUserId);
      this.queuePrefs.delete(cleanUserId);
      this.matchedRooms.delete(cleanUserId);
    });
  }

  async createBuddyCall(
    userId: string,
    buddyId: string,
    customTopic?: string,
  ): Promise<CreatedRoom> {
    if (!userId || !buddyId) {
      throw new BadRequestException('Both caller and buddy user IDs are required');
    }
    const cleanCallerId = userId.trim();
    const cleanBuddyId = buddyId.trim();

    if (cleanCallerId === cleanBuddyId) {
      throw new BadRequestException('Cannot start a buddy call with yourself');
    }

    const buddy = await this.prisma.user.findUnique({
      where: { id: cleanBuddyId },
    });
    if (!buddy) {
      throw new NotFoundException('Buddy not found');
    }

    if (typeof (this.prisma.userBlock as any)?.findFirst === 'function') {
      const blocked = await this.prisma.userBlock.findFirst({
        where: {
          OR: [
            { userId: cleanCallerId, blockedId: cleanBuddyId },
            { userId: cleanBuddyId, blockedId: cleanCallerId },
          ],
        },
      });
      if (blocked) {
        throw new ForbiddenException('Cannot start a call with a blocked user');
      }
    }

    const randomSuffix = randomBytes(6).toString('hex');
    const roomName = `justspeak-buddy-${randomSuffix}`;
    const roomUrl = `${this.appRoomBaseUrl}/${roomName}`;

    const topicItem = this.pickRandomTopic();
    const sanitizedTopic = customTopic ? customTopic.trim().slice(0, 300) : '';
    const topic = sanitizedTopic || topicItem.question;
    const allTopicQuestions = ENGLISH_TOPICS.map((t) => t.question);

    const session = await this.prisma.session.create({
      data: {
        roomName,
        topic,
        participantIds: [cleanCallerId, buddy.id],
      },
    });

    this.registerRoomAuthorization(roomName, [cleanCallerId, buddy.id]);

    return {
      sessionId: session.id,
      roomName,
      roomUrl,
      topic,
      topicQuestions: allTopicQuestions,
      partnerId: buddy.id,
      partnerName: this.formatDisplayName(buddy, 'Buddy'),
      partnerCountry: buddy.country || 'Global',
    };
  }

  // Tracks recovered (userId:sessionId) -> expiresAt timestamp within the session TTL
  private recoveredSessionKeys = new Map<string, number>();
  private readonly earlyDisconnectWindowMs = 7 * 60 * 1000; // 7-minute session duration

  private cleanupExpiredRecoveredKeys(): void {
    const now = Date.now();
    for (const [key, expiresAt] of this.recoveredSessionKeys.entries()) {
      if (now > expiresAt) {
        this.recoveredSessionKeys.delete(key);
      }
    }
  }

  hasUserRecoveredTicket(sessionId: string, userId: string): boolean {
    if (!sessionId || !userId) return false;
    this.cleanupExpiredRecoveredKeys();
    const dedupeKey = `${userId.trim()}:${sessionId.trim()}`;
    return this.recoveredSessionKeys.has(dedupeKey);
  }

  async recoverTicket(
    userId: string,
    sessionId?: string,
  ): Promise<{ success: boolean; ticketsLeft: number }> {
    if (!userId || typeof userId !== 'string' || !userId.trim()) {
      throw new BadRequestException('User ID is required');
    }
    if (!sessionId || typeof sessionId !== 'string' || !sessionId.trim()) {
      throw new BadRequestException('Session ID is required to recover a ticket');
    }

    const cleanUserId = userId.trim();
    const cleanSessionId = sessionId.trim();
    const dedupeKey = `${cleanUserId}:${cleanSessionId}`;

    return this.withQueueLock(async () => {
      this.cleanupExpiredRecoveredKeys();

      if (this.recoveredSessionKeys.has(dedupeKey)) {
        const existingUser = await this.prisma.user.findUnique({
          where: { id: cleanUserId },
        });
        if (!existingUser) {
          throw new NotFoundException('User not found');
        }
        return {
          success: true,
          ticketsLeft: existingUser.ticketsLeft ?? 5,
        };
      }

      const session = await this.prisma.session.findUnique({
        where: { id: cleanSessionId },
        include: {
          feedbacks: {
            select: { giverId: true },
          },
        },
      });

      if (!session) {
        throw new NotFoundException('Session not found');
      }

      const participants = Array.isArray(session.participantIds)
        ? session.participantIds
        : [];

      if (!participants.includes(cleanUserId)) {
        throw new ForbiddenException('You are not a participant of this session');
      }

      if (
        participants.length < 2 ||
        session.roomName.startsWith('justspeak-buddy-') ||
        session.roomName.startsWith('JustSpeak-')
      ) {
        throw new BadRequestException(
          'Ticket recovery is only available for matched queue sessions',
        );
      }

      const alreadySubmittedFeedback = session.feedbacks?.some(
        (f) => f.giverId === cleanUserId,
      );
      if (alreadySubmittedFeedback) {
        throw new BadRequestException(
          'Cannot recover ticket for a completed session',
        );
      }

      const createdAtMs = new Date(session.createdAt).getTime();
      const sessionAgeMs = Date.now() - createdAtMs;
      if (
        Number.isNaN(createdAtMs) ||
        sessionAgeMs < 0 ||
        sessionAgeMs >= this.earlyDisconnectWindowMs
      ) {
        throw new BadRequestException(
          'Session duration has already elapsed; ticket cannot be recovered',
        );
      }

      const user = await this.prisma.user.findUnique({
        where: { id: cleanUserId },
      });
      if (!user) {
        throw new NotFoundException('User not found');
      }

      const currentTickets = user.ticketsLeft ?? 5;
      const nextTickets = Math.min(5, currentTickets + 1);

      if (nextTickets > currentTickets) {
        await this.prisma.user.updateMany({
          where: { id: cleanUserId, ticketsLeft: { lt: 5 } },
          data: { ticketsLeft: { increment: 1 } },
        });
      }

      this.recoveredSessionKeys.set(
        dedupeKey,
        createdAtMs + this.defaultRoomTtlMs,
      );

      return {
        success: true,
        ticketsLeft: nextTickets,
      };
    });
  }
}