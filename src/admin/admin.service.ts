import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { subscriptionStore, PlanTierId } from '../users/subscription-store';

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
}

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

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

    return users.map((u) => {
      const sub = subscriptionStore.getSubscription(u.id);
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
    const [totalUsers, totalSessions, totalFeedbacks, totalBlocks] =
      await Promise.all([
        this.prisma.user.count(),
        this.prisma.session.count(),
        this.prisma.sessionFeedback.count(),
        this.prisma.userBlock.count(),
      ]);

    return { totalUsers, totalSessions, totalFeedbacks, totalBlocks };
  }

  async deleteUser(id: string): Promise<{ success: boolean }> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, phone: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
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
    return { success: true };
  }

  async updateUserSubscription(
    id: string,
    payload: { planTier?: PlanTierId; aiTokensBalance?: number; addTokens?: number },
  ) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const current = subscriptionStore.getSubscription(id);
    const nextTier = payload.planTier || current.planTier;
    if (!['FREE', 'PLUS', 'ELITE'].includes(nextTier)) {
      throw new BadRequestException('Invalid planTier');
    }

    const updated = subscriptionStore.setSubscription(
      id,
      nextTier,
      payload.aiTokensBalance,
      payload.addTokens,
    );

    return {
      success: true,
      userId: id,
      planTier: updated.planTier,
      aiTokensBalance: updated.aiTokensBalance,
    };
  }
}