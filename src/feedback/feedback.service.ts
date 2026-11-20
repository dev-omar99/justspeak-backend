import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { SubmitFeedbackDto } from './dto';
import { PartnerRating } from '@prisma/client';
import { RoomsService } from '../rooms/rooms.service';

@Injectable()
export class FeedbackService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly roomsService?: RoomsService,
  ) {}

  async submitFeedback(giverId: string, dto: SubmitFeedbackDto) {
    const cleanGiverId = (giverId || '').trim();
    const cleanSessionId = (dto?.sessionId || '').trim();
    const cleanPartnerId = (dto?.partnerId || '').trim();

    if (!cleanGiverId || !cleanSessionId || !cleanPartnerId) {
      throw new BadRequestException('sessionId and partnerId are required');
    }

    if (cleanGiverId === cleanPartnerId) {
      throw new BadRequestException('You cannot submit feedback for yourself');
    }

    // 1. Verify that the session exists; never auto-create arbitrary sessions
    const session: any = await this.prisma.session.findUnique({
      where: { id: cleanSessionId },
    });

    if (!session) {
      throw new NotFoundException('Session not found');
    }

    // 2. Verify that the session has authorized participants and both giver and receiver participated
    const dbParticipants: string[] = Array.isArray(session.participantIds)
      ? session.participantIds
      : [];
    const memoryParticipants: string[] =
      dbParticipants.length === 0 && this.roomsService
        ? this.roomsService.getAuthorizedUsersForRoom(session.roomName)
        : [];
    const authorizedParticipants =
      dbParticipants.length > 0 ? dbParticipants : memoryParticipants;

    if (
      authorizedParticipants.length < 2 ||
      !authorizedParticipants.includes(cleanGiverId) ||
      !authorizedParticipants.includes(cleanPartnerId)
    ) {
      throw new ForbiddenException(
        'You are not an authorized participant of this session',
      );
    }

    // 2b. Prevent submitting feedback for a session after recovering its ticket
    if (
      this.roomsService?.hasUserRecoveredTicket?.(session.id, cleanGiverId)
    ) {
      throw new BadRequestException(
        'Cannot submit feedback for a session after recovering its ticket',
      );
    }

    // 3. Reject duplicate feedback submissions for the same session and giver
    const existingFeedback = await this.prisma.sessionFeedback.findUnique({
      where: {
        sessionId_giverId: {
          sessionId: session.id,
          giverId: cleanGiverId,
        },
      },
    });

    if (existingFeedback) {
      throw new ConflictException(
        'Feedback has already been submitted for this session',
      );
    }

    // 4. Verify receiver exists
    const receiver = await this.prisma.user.findUnique({
      where: { id: cleanPartnerId },
    });

    if (!receiver) {
      throw new NotFoundException('Partner user not found');
    }

    // 5. Create session feedback (with atomic unique constraint protection)
    const sanitizedCompliments = Array.isArray(dto.compliments)
      ? dto.compliments
          .filter((c): c is string => typeof c === 'string')
          .map((c) => c.trim().slice(0, 60))
          .filter(Boolean)
          .slice(0, 10)
      : [];

    let feedback: any;
    try {
      feedback = await this.prisma.sessionFeedback.create({
        data: {
          sessionId: session.id,
          giverId: cleanGiverId,
          receiverId: cleanPartnerId,
          levelFeedback: dto.levelFeedback,
          partnerRating: dto.partnerRating,
          compliments: sanitizedCompliments,
        },
      });
    } catch (err: any) {
      if (err?.code === 'P2002') {
        throw new ConflictException(
          'Feedback has already been submitted for this session',
        );
      }
      throw err;
    }

    // 6. If user chose BLOCKED ("Don't match again"), add to UserBlock list
    if (dto.partnerRating === PartnerRating.BLOCKED) {
      await this.prisma.userBlock.upsert({
        where: {
          userId_blockedId: {
            userId: cleanGiverId,
            blockedId: cleanPartnerId,
          },
        },
        update: {},
        create: {
          userId: cleanGiverId,
          blockedId: cleanPartnerId,
        },
      });
    } else if (dto.partnerRating === PartnerRating.LIKED) {
      // 7. If user chose LIKED, persist UserBuddy relationship unless blocked in either direction
      const blocked = await this.isBlocked(cleanGiverId, cleanPartnerId);
      if (!blocked) {
        await this.prisma.userBuddy.upsert({
          where: {
            userId_buddyId: {
              userId: cleanGiverId,
              buddyId: cleanPartnerId,
            },
          },
          update: {},
          create: {
            userId: cleanGiverId,
            buddyId: cleanPartnerId,
          },
        });
      }
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
