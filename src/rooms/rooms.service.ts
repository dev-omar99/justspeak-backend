import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
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

@Injectable()
export class RoomsService {
  private readonly appRoomBaseUrl = '/room';
  private waitingQueue: string[] = [];
  private queuePrefs: Map<string, { differentCountryOnly: boolean }> = new Map();
  private matchedRooms: Map<string, CreatedRoom> = new Map();

  constructor(private readonly prisma: PrismaService) {}

  private pickRandomTopic(): TopicItem {
    return ENGLISH_TOPICS[Math.floor(Math.random() * ENGLISH_TOPICS.length)];
  }

  async createRoom(): Promise<CreatedRoom> {
    const randomId = randomBytes(8).toString('hex');
    const sessionId = randomBytes(12).toString('hex');
    const roomName = `JustSpeak-${randomId}`;
    const selectedTopic = this.pickRandomTopic();

    // Persist session
    await this.prisma.session.create({
      data: {
        id: sessionId,
        roomName,
        topic: selectedTopic.question,
      },
    });

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

  async joinQueue(userId: string, differentCountryOnly: boolean = false): Promise<QueueStatus> {
    // 1. Check if user already got matched by another partner
    if (this.matchedRooms.has(userId)) {
      const room = this.matchedRooms.get(userId)!;
      this.matchedRooms.delete(userId);
      this.queuePrefs.delete(userId);
      return { status: 'matched', room };
    }

    // 2. Fetch all blocks involving current user
    const blocks = await this.prisma.userBlock.findMany({
      where: {
        OR: [{ userId }, { blockedId: userId }],
      },
    });

    const blockedUserIds = new Set<string>();
    for (const b of blocks) {
      if (b.userId === userId) blockedUserIds.add(b.blockedId);
      if (b.blockedId === userId) blockedUserIds.add(b.userId);
    }

    const currentUser = await this.prisma.user.findUnique({ where: { id: userId } });

    // 3. Find candidate partner in queue who is NOT blocked & passes country filter
    let partnerId: string | null = null;
    let partnerIndex = -1;

    for (let i = 0; i < this.waitingQueue.length; i++) {
      const candidateId = this.waitingQueue[i];
      if (candidateId === userId) continue;
      if (blockedUserIds.has(candidateId)) continue;

      const candidateUser = await this.prisma.user.findUnique({ where: { id: candidateId } });
      const candidatePref = this.queuePrefs.get(candidateId);

      // Check Country Filter (if either requested different country)
      const shouldFilterCountry = differentCountryOnly || candidatePref?.differentCountryOnly;
      if (
        shouldFilterCountry &&
        currentUser?.country &&
        candidateUser?.country &&
        currentUser.country.toLowerCase().trim() === candidateUser.country.toLowerCase().trim()
      ) {
        // Skip same country candidate
        continue;
      }

      partnerId = candidateId;
      partnerIndex = i;
      break;
    }

    if (partnerId !== null && partnerIndex !== -1) {
      // Remove partner from waiting queue
      this.waitingQueue.splice(partnerIndex, 1);
      this.queuePrefs.delete(partnerId);
      this.queuePrefs.delete(userId);

      const randomSuffix = randomBytes(6).toString('hex');
      const roomName = `justspeak-${randomSuffix}`;
      const commonUrl = `${this.appRoomBaseUrl}/${roomName}`;
      const selectedTopic = this.pickRandomTopic();

      // Collect randomized topic list with selected topic as first
      const otherQuestions = ENGLISH_TOPICS.filter((t) => t.id !== selectedTopic.id).map(
        (t) => t.question,
      );
      const allQuestions = [selectedTopic.question, ...otherQuestions];

      const partnerUser = await this.prisma.user.findUnique({ where: { id: partnerId } });

      // Deduct 1 daily ticket from both users
      await this.prisma.user.updateMany({
        where: { id: { in: [userId, partnerId] }, ticketsLeft: { gt: 0 } },
        data: { ticketsLeft: { decrement: 1 } },
      });

      // Create session in database
      const session = await this.prisma.session.create({
        data: {
          roomName,
          topic: selectedTopic.question,
        },
      });

      const sessionId = session.id;

      // Room info for the waiting partner
      const roomForPartner: CreatedRoom = {
        sessionId,
        roomName,
        roomUrl: commonUrl,
        topic: selectedTopic.question,
        prompts: selectedTopic.prompts,
        topicQuestions: allQuestions,
        partnerId: userId,
        partnerName: currentUser?.name || (currentUser?.email ? currentUser.email.split('@')[0] : (currentUser?.phone || 'Learner')),
        partnerCountry: currentUser?.country || undefined,
      };

      // Room info for current user
      const roomForCurrent: CreatedRoom = {
        sessionId,
        roomName,
        roomUrl: commonUrl,
        topic: selectedTopic.question,
        prompts: selectedTopic.prompts,
        topicQuestions: allQuestions,
        partnerId,
        partnerName: partnerUser?.name || (partnerUser?.email ? partnerUser.email.split('@')[0] : (partnerUser?.phone || 'Learner')),
        partnerCountry: partnerUser?.country || undefined,
      };


      this.matchedRooms.set(partnerId, roomForPartner);
      return { status: 'matched', room: roomForCurrent };
    }

    // 4. If user not already in queue, add them with preferences
    if (!this.waitingQueue.includes(userId)) {
      this.waitingQueue.push(userId);
    }
    this.queuePrefs.set(userId, { differentCountryOnly });

    return { status: 'waiting' };
  }

  async leaveQueue(userId: string): Promise<void> {
    this.waitingQueue = this.waitingQueue.filter((id) => id !== userId);
    this.queuePrefs.delete(userId);
    this.matchedRooms.delete(userId);
  }

  async createBuddyCall(userId: string, buddyId: string, customTopic?: string): Promise<CreatedRoom> {
    const buddy = await this.prisma.user.findUnique({ where: { id: buddyId } });
    if (!buddy) {
      throw new Error('Buddy not found');
    }

    const randomSuffix = randomBytes(6).toString('hex');
    const roomName = `justspeak-buddy-${randomSuffix}`;
    const roomUrl = `${this.appRoomBaseUrl}/${roomName}`;

    const topicItem = ENGLISH_TOPICS[Math.floor(Math.random() * ENGLISH_TOPICS.length)];
    const topic = customTopic || topicItem.question;
    const allTopicQuestions = ENGLISH_TOPICS.map((t) => t.question);

    const session = await this.prisma.session.create({
      data: {
        roomName,
        topic,
      },
    });

    return {
      sessionId: session.id,
      roomName,
      roomUrl,
      topic,
      topicQuestions: allTopicQuestions,
      partnerId: buddy.id,
      partnerName: buddy.name || (buddy.email ? buddy.email.split('@')[0] : (buddy.phone || 'Buddy')),
      partnerCountry: buddy.country || 'Global',
    };
  }
}