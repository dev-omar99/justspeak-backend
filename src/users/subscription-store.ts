import * as fs from 'fs';
import * as path from 'path';

export type PlanTierId = 'FREE' | 'PLUS' | 'ELITE';

export interface UserSubscriptionRecord {
  userId: string;
  planTier: PlanTierId;
  aiTokensBalance: number;
  updatedAt: string;
}

export interface PartnerMemoRecord {
  userId: string;
  partnerId: string;
  memo: string;
  updatedAt: string;
}

export interface AcademyProgressRecord {
  userId: string;
  cefrLevel: 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';
  placementCompleted: boolean;
  dailySpeakingGoalMins: number;
  learnedWordIds: string[];
  completedLessonIds?: string[];
  completedReadingIds: string[];
  completedListeningIds: string[];
  completedShadowingIds: string[];
  completedPronunciationIds: string[];
  dailyCompletedTaskIds: string[];
  dailyDateKey: string;
  scores: {
    fluency: number;
    pronunciation: number;
    vocabulary: number;
    grammar: number;
  };
  updatedAt: string;
}

interface PersistedDataShape {
  subscriptions: Record<string, UserSubscriptionRecord>;
  memos: Record<string, PartnerMemoRecord>;
  academy?: Record<string, AcademyProgressRecord>;
}

const PLAN_DEFAULT_TOKENS: Record<PlanTierId, number> = {
  FREE: 0,
  PLUS: 500,
  ELITE: 3500,
};

class ServerSubscriptionStore {
  private readonly filePath: string;
  private data: PersistedDataShape = {
    subscriptions: {},
    memos: {},
    academy: {},
  };

  constructor() {
    const dataDir = path.join(process.cwd(), 'data');
    this.filePath = path.join(dataDir, 'user-meta.json');
    this.loadFromDisk();
  }

  private loadFromDisk(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          this.data = {
            subscriptions: parsed.subscriptions || {},
            memos: parsed.memos || {},
            academy: parsed.academy || {},
          };
        }
      }
    } catch {
      // Fallback to in-memory store if disk is read-only
    }
  }

  private saveToDisk(): void {
    if (process.env.NODE_ENV === 'test') return;
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf8');
    } catch {
      // Ignore write errors in restricted environments
    }
  }

  getSubscription(userId: string): UserSubscriptionRecord {
    const existing = this.data.subscriptions[userId];
    if (existing) {
      return existing;
    }
    return {
      userId,
      planTier: 'FREE',
      aiTokensBalance: 0,
      updatedAt: new Date().toISOString(),
    };
  }

  setSubscription(
    userId: string,
    planTier: PlanTierId,
    aiTokensBalance?: number,
    addTokens?: number,
  ): UserSubscriptionRecord {
    const current = this.getSubscription(userId);
    let nextTokens = current.aiTokensBalance;

    if (typeof aiTokensBalance === 'number') {
      nextTokens = Math.max(0, Math.floor(aiTokensBalance));
    } else if (typeof addTokens === 'number') {
      nextTokens = Math.max(0, current.aiTokensBalance + Math.floor(addTokens));
    } else if (planTier !== current.planTier) {
      nextTokens =
        planTier === 'FREE'
          ? 0
          : current.aiTokensBalance + PLAN_DEFAULT_TOKENS[planTier];
    }

    const updated: UserSubscriptionRecord = {
      userId,
      planTier,
      aiTokensBalance: nextTokens,
      updatedAt: new Date().toISOString(),
    };
    this.data.subscriptions[userId] = updated;
    this.saveToDisk();
    return updated;
  }

  consumeAiTokens(userId: string, amount: number): UserSubscriptionRecord {
    const current = this.getSubscription(userId);
    const cost = Math.max(0, Math.floor(amount));
    const updated: UserSubscriptionRecord = {
      ...current,
      aiTokensBalance: Math.max(0, current.aiTokensBalance - cost),
      updatedAt: new Date().toISOString(),
    };
    this.data.subscriptions[userId] = updated;
    this.saveToDisk();
    return updated;
  }

  getUserMemos(userId: string): PartnerMemoRecord[] {
    return Object.values(this.data.memos).filter((m) => m.userId === userId);
  }

  saveUserMemo(
    userId: string,
    partnerId: string,
    memo: string,
  ): PartnerMemoRecord {
    const key = `${userId}::${partnerId}`;
    const record: PartnerMemoRecord = {
      userId,
      partnerId,
      memo: memo.trim().slice(0, 600),
      updatedAt: new Date().toISOString(),
    };
    this.data.memos[key] = record;
    this.saveToDisk();
    return record;
  }

  getAcademyProgress(userId: string): AcademyProgressRecord | null {
    return this.data.academy?.[userId] || null;
  }

  saveAcademyProgress(
    userId: string,
    payload: Omit<AcademyProgressRecord, 'userId' | 'updatedAt'>,
  ): AcademyProgressRecord {
    if (!this.data.academy) {
      this.data.academy = {};
    }
    const record: AcademyProgressRecord = {
      ...payload,
      userId,
      updatedAt: new Date().toISOString(),
    };
    this.data.academy[userId] = record;
    this.saveToDisk();
    return record;
  }
}

export const subscriptionStore = new ServerSubscriptionStore();
