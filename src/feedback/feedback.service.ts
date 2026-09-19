import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { SubmitFeedbackDto } from './dto';
import { PartnerRating } from '@prisma/client';

@Injectable()
export class FeedbackService {
  constructor(private readonly prisma: PrismaService) {}

  async submitFeedback(giverId: string, dto: SubmitFeedbackDto) {
    // 1. Verify that the session exists or create it if not recorded yet
    let session = await this.prisma.session.findUnique({
      where: { id: dto.sessionId },
    });

    if (!session) {
      session = await this.prisma.session.create({
        data: {
          id: dto.sessionId,
          roomName: `JustSpeak-Session-${dto.sessionId.slice(0, 8)}`,
        },
      });
    }

    // 2. Verify receiver exists
    const receiver = await this.prisma.user.findUnique({
      where: { id: dto.partnerId },
    });

    if (!receiver) {
      throw new NotFoundException('Partner user not found');
    }

    // 3. Upsert session feedback
    const feedback = await this.prisma.sessionFeedback.upsert({
      where: {
        sessionId_giverId: {
          sessionId: session.id,
          giverId,
        },
      },
      update: {
        receiverId: dto.partnerId,
        levelFeedback: dto.levelFeedback,
        partnerRating: dto.partnerRating,
        compliments: dto.compliments || [],
      },
      create: {
        sessionId: session.id,
        giverId,
        receiverId: dto.partnerId,
        levelFeedback: dto.levelFeedback,
        partnerRating: dto.partnerRating,
        compliments: dto.compliments || [],
      },
    });


    // 4. If user chose BLOCKED ("Don't match again"), add to UserBlock list
    if (dto.partnerRating === PartnerRating.BLOCKED) {
      await this.prisma.userBlock.upsert({
        where: {
          userId_blockedId: {
            userId: giverId,
            blockedId: dto.partnerId,
          },
        },
        update: {},
        create: {
          userId: giverId,
          blockedId: dto.partnerId,
        },
      });
    }

    return {
      success: true,
      message: 'Thank you for your feedback! We will use it to improve your next matches.',
      feedbackId: feedback.id,
    };
  }

  async isBlocked(userA: string, userB: string): Promise<boolean> {
    const blockRecord = await this.prisma.userBlock.findFirst({
      where: {
        OR: [
          { userId: userA, blockedId: userB },
          { userId: userB, blockedId: userA },
        ],
      },
    });

    return !!blockRecord;
  }
}
