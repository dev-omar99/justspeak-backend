import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

export interface AdminUserListItem {
  id: string;
  email: string | null;
  phone?: string | null;
  name: string | null;
  country: string | null;
  isAdmin: boolean;
  createdAt: Date;
  sessionsCount: number;
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

    return users.map((u) => ({
      id: u.id,
      email: u.email,
      phone: u.phone,
      name: u.name,
      country: u.country,
      isAdmin: u.isAdmin,
      createdAt: u.createdAt,
      sessionsCount: u._count.givenFeedbacks,
    }));

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
    await this.prisma.user.delete({ where: { id } });
    return { success: true };
  }
}