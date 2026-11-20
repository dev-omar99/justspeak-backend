import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { LevelFeedback, PartnerRating } from '@prisma/client';
import { FeedbackService } from './feedback.service';
import { PrismaService } from '../prisma.service';
import { RoomsService } from '../rooms/rooms.service';

describe('FeedbackService (H3 Session Feedback Authorization)', () => {
  let service: FeedbackService;

  const mockPrisma = {
    session: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
    sessionFeedback: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    userBlock: {
      upsert: jest.fn(),
      findFirst: jest.fn(),
    },
    userBuddy: {
      upsert: jest.fn(),
    },
  };

  const mockRoomsService = {
    getAuthorizedUsersForRoom: jest.fn().mockReturnValue([]),
    hasUserRecoveredTicket: jest.fn().mockReturnValue(false),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockRoomsService.getAuthorizedUsersForRoom.mockReturnValue([]);
    mockRoomsService.hasUserRecoveredTicket.mockReturnValue(false);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeedbackService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: RoomsService, useValue: mockRoomsService },
      ],
    }).compile();

    service = module.get<FeedbackService>(FeedbackService);
  });

  it('should reject fabricated or unknown sessionId without auto-creating a session', async () => {
    mockPrisma.session.findUnique.mockResolvedValue(null);

    await expect(
      service.submitFeedback('user-a', {
        sessionId: 'fabricated-session-id',
        partnerId: 'user-b',
        levelFeedback: LevelFeedback.SAME,
        partnerRating: PartnerRating.LIKED,
      }),
    ).rejects.toThrow(NotFoundException);

    expect(mockPrisma.session.create).not.toHaveBeenCalled();
  });

  it('should reject self-feedback submissions', async () => {
    await expect(
      service.submitFeedback('user-a', {
        sessionId: 'sess-1',
        partnerId: 'user-a',
        levelFeedback: LevelFeedback.HIGHER,
        partnerRating: PartnerRating.LIKED,
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('should reject feedback from an unauthorized user who was not a participant in the session', async () => {
    mockPrisma.session.findUnique.mockResolvedValue({
      id: 'sess-real-1',
      roomName: 'justspeak-123',
      participantIds: ['user-a', 'user-b'],
    });

    await expect(
      service.submitFeedback('attacker-user-c', {
        sessionId: 'sess-real-1',
        partnerId: 'user-b',
        levelFeedback: LevelFeedback.SAME,
        partnerRating: PartnerRating.LIKED,
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('should reject feedback targeting a receiver who was not a participant in the session', async () => {
    mockPrisma.session.findUnique.mockResolvedValue({
      id: 'sess-real-1',
      roomName: 'justspeak-123',
      participantIds: ['user-a', 'user-b'],
    });

    await expect(
      service.submitFeedback('user-a', {
        sessionId: 'sess-real-1',
        partnerId: 'stranger-user-d',
        levelFeedback: LevelFeedback.LOWER,
        partnerRating: PartnerRating.BLOCKED,
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('should reject feedback for a solo session that never had 2 authorized participants', async () => {
    mockPrisma.session.findUnique.mockResolvedValue({
      id: 'sess-solo',
      roomName: 'JustSpeak-solo',
      participantIds: ['user-a'],
    });

    await expect(
      service.submitFeedback('user-a', {
        sessionId: 'sess-solo',
        partnerId: 'user-b',
        levelFeedback: LevelFeedback.SAME,
        partnerRating: PartnerRating.NEUTRAL,
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('should reject feedback submission after the user has already recovered a ticket for the same session', async () => {
    mockPrisma.session.findUnique.mockResolvedValue({
      id: 'sess-recovered-1',
      roomName: 'justspeak-rec123',
      participantIds: ['user-a', 'user-b'],
    });
    mockRoomsService.hasUserRecoveredTicket.mockImplementation(
      (sId: string, uId: string) => sId === 'sess-recovered-1' && uId === 'user-a',
    );

    await expect(
      service.submitFeedback('user-a', {
        sessionId: 'sess-recovered-1',
        partnerId: 'user-b',
        levelFeedback: LevelFeedback.SAME,
        partnerRating: PartnerRating.LIKED,
      }),
    ).rejects.toThrow(
      new BadRequestException(
        'Cannot submit feedback for a session after recovering its ticket',
      ),
    );

    expect(mockPrisma.sessionFeedback.create).not.toHaveBeenCalled();
  });

  it('should reject duplicate feedback submissions for the same session and giver', async () => {
    mockPrisma.session.findUnique.mockResolvedValue({
      id: 'sess-real-1',
      roomName: 'justspeak-123',
      participantIds: ['user-a', 'user-b'],
    });
    mockPrisma.sessionFeedback.findUnique.mockResolvedValue({
      id: 'existing-fb-1',
      sessionId: 'sess-real-1',
      giverId: 'user-a',
    });

    await expect(
      service.submitFeedback('user-a', {
        sessionId: 'sess-real-1',
        partnerId: 'user-b',
        levelFeedback: LevelFeedback.HIGHER,
        partnerRating: PartnerRating.LIKED,
      }),
    ).rejects.toThrow(ConflictException);
  });

  it('should allow valid feedback from an authorized participant for their session partner and record block when BLOCKED', async () => {
    mockPrisma.session.findUnique.mockResolvedValue({
      id: 'sess-real-1',
      roomName: 'justspeak-123',
      participantIds: ['user-a', 'user-b'],
    });
    mockPrisma.sessionFeedback.findUnique.mockResolvedValue(null);
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-b' });
    mockPrisma.sessionFeedback.create.mockResolvedValue({
      id: 'fb-valid-1',
    });
    mockPrisma.userBlock.upsert.mockResolvedValue({ id: 'blk-1' });

    const res = await service.submitFeedback('user-a', {
      sessionId: 'sess-real-1',
      partnerId: 'user-b',
      levelFeedback: LevelFeedback.SAME,
      partnerRating: PartnerRating.BLOCKED,
      compliments: ['Friendly'],
    });

    expect(res.success).toBe(true);
    expect(res.feedbackId).toBe('fb-valid-1');
    expect(mockPrisma.sessionFeedback.create).toHaveBeenCalledWith({
      data: {
        sessionId: 'sess-real-1',
        giverId: 'user-a',
        receiverId: 'user-b',
        levelFeedback: LevelFeedback.SAME,
        partnerRating: PartnerRating.BLOCKED,
        compliments: ['Friendly'],
      },
    });
    expect(mockPrisma.userBlock.upsert).toHaveBeenCalled();
    expect(mockPrisma.userBuddy.upsert).not.toHaveBeenCalled();
  });

  it('should persist UserBuddy relationship when partnerRating is LIKED and relationship is not blocked', async () => {
    mockPrisma.session.findUnique.mockResolvedValue({
      id: 'sess-liked-1',
      roomName: 'justspeak-liked1',
      participantIds: ['user-a', 'user-b'],
    });
    mockPrisma.sessionFeedback.findUnique.mockResolvedValue(null);
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-b' });
    mockPrisma.sessionFeedback.create.mockResolvedValue({
      id: 'fb-liked-1',
    });
    mockPrisma.userBlock.findFirst.mockResolvedValue(null);
    mockPrisma.userBuddy.upsert.mockResolvedValue({
      id: 'buddy-rel-1',
      userId: 'user-a',
      buddyId: 'user-b',
    });

    const res = await service.submitFeedback('user-a', {
      sessionId: 'sess-liked-1',
      partnerId: 'user-b',
      levelFeedback: LevelFeedback.SAME,
      partnerRating: PartnerRating.LIKED,
      compliments: ['Clear pronunciation'],
    });

    expect(res.success).toBe(true);
    expect(mockPrisma.userBuddy.upsert).toHaveBeenCalledWith({
      where: {
        userId_buddyId: {
          userId: 'user-a',
          buddyId: 'user-b',
        },
      },
      update: {},
      create: {
        userId: 'user-a',
        buddyId: 'user-b',
      },
    });
  });

  it('should NOT persist UserBuddy relationship when partnerRating is LIKED if either user has blocked the other', async () => {
    mockPrisma.session.findUnique.mockResolvedValue({
      id: 'sess-liked-blocked',
      roomName: 'justspeak-liked-blocked',
      participantIds: ['user-a', 'user-b'],
    });
    mockPrisma.sessionFeedback.findUnique.mockResolvedValue(null);
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-b' });
    mockPrisma.sessionFeedback.create.mockResolvedValue({
      id: 'fb-liked-blocked',
    });
    mockPrisma.userBlock.findFirst.mockResolvedValue({
      id: 'existing-block',
      userId: 'user-b',
      blockedId: 'user-a',
    });

    const res = await service.submitFeedback('user-a', {
      sessionId: 'sess-liked-blocked',
      partnerId: 'user-b',
      levelFeedback: LevelFeedback.SAME,
      partnerRating: PartnerRating.LIKED,
      compliments: [],
    });

    expect(res.success).toBe(true);
    expect(mockPrisma.userBuddy.upsert).not.toHaveBeenCalled();
  });
});
