import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';
import { PrismaService } from '../prisma.service';
import { RoomsService } from '../rooms/rooms.service';

describe('UsersService', () => {
  let service: UsersService;

  const mockPrismaService = {
    user: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      count: jest.fn().mockResolvedValue(15),
    },
    sessionFeedback: {
      findMany: jest.fn(),
    },
    userSubscription: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
    userBlock: {
      findMany: jest.fn(),
      deleteMany: jest.fn(),
    },
    userBuddy: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    },
  };

  const mockRoomsService = {
    getActiveRoomCount: jest.fn().mockReturnValue(3),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockRoomsService.getActiveRoomCount.mockReturnValue(3);
    mockPrismaService.user.count.mockResolvedValue(15);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: RoomsService, useValue: mockRoomsService },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('should throw NotFoundException in getDashboard when user does not exist', async () => {
    mockPrismaService.user.findUnique.mockResolvedValue(null);

    await expect(service.getDashboard('missing-user')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('should return real liveRoomsCount and never expose partner phone numbers in getDashboard', async () => {
    mockPrismaService.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'user1@test.com',
      phone: '+201000000001',
      name: 'User One',
      country: 'Egypt',
      englishLevel: 'Intermediate',
      ticketsLeft: 4,
      lastTicketReset: new Date(),
      tribeId: 2,
    });
    mockPrismaService.sessionFeedback.findMany
      .mockResolvedValueOnce([
        {
          createdAt: new Date(),
          partnerRating: 'LIKED',
          receiver: {
            id: 'partner-phone-only',
            name: null,
            email: null,
            country: 'Morocco',
          },
        },
      ])
      .mockResolvedValueOnce([
        {
          createdAt: new Date(),
          partnerRating: 'LIKED',
          giver: {
            id: 'partner-2',
            name: 'Sara',
            email: 'sara@test.com',
            country: 'Jordan',
          },
        },
      ]);
    mockPrismaService.userBlock.findMany.mockResolvedValue([]);
    mockPrismaService.userBuddy.findMany.mockResolvedValue([]);

    const dashboard = await service.getDashboard('user-1');

    expect(dashboard.stats.liveRoomsCount).toBe(3);
    expect(dashboard.stats.totalSessions).toBe(1);
    expect(dashboard.stats.lovedCount).toBe(1);
    expect(dashboard.stats.contributionPoints).toBe(10); // 1 session * 5 + 1 loved * 5
    expect(dashboard.tickets.ticketsLeft).toBe(4);
    expect(dashboard.tickets.bonusTickets).toBe(6); // 5 + 1 loved
    expect(dashboard.tribe?.userTribeName).toBe('Aurora Tribe');
    expect(dashboard.tribe?.activeTribeName).toBeDefined();
    expect(dashboard.tribe?.activeTribeWindow).toMatch(/^\d{2}:\d{2} - \d{2}:\d{2}$/);
    expect(dashboard.tribe?.activeMembersCount).toBe(21); // 15 tribe members + 3 * 2
    expect(mockRoomsService.getActiveRoomCount).toHaveBeenCalled();
    expect(dashboard.recentPartners).toHaveLength(2);
    expect(dashboard.recentPartners[0].name).toBe('Partner');
  });

  it('should throw BadRequestException when trying to add oneself as buddy', async () => {
    await expect(service.toggleBuddy('user-1', 'user-1')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('should throw NotFoundException when target buddy user does not exist', async () => {
    mockPrismaService.user.findUnique.mockResolvedValue(null);

    await expect(service.toggleBuddy('user-1', 'nonexistent')).rejects.toThrow(
      NotFoundException,
    );
  });

  it('should mask blocked user emails and never expose phone numbers in getBuddies, getBlockedUsers, or getLeaderboard', async () => {
    mockPrismaService.userBuddy.findMany.mockResolvedValue([
      {
        createdAt: new Date(),
        buddy: {
          id: 'buddy-1',
          name: null,
          email: null,
          country: 'Egypt',
          englishLevel: 'Advanced',
        },
      },
    ]);

    const buddies = await service.getBuddies('user-1');
    expect(buddies[0].name).toBe('Buddy');

    mockPrismaService.userBlock.findMany.mockResolvedValue([
      {
        id: 'block-1',
        createdAt: new Date(),
        blocked: {
          id: 'blocked-1',
          name: null,
          email: 'secretuser@example.com',
          country: 'USA',
        },
      },
    ]);

    const blocked = await service.getBlockedUsers('user-1');
    expect(blocked[0].blockedUser.name).toBe('secretuser');
    expect(blocked[0].blockedUser.email).toBe('se***@example.com');

    mockPrismaService.user.findMany.mockResolvedValue([
      {
        id: 'u-anon',
        name: null,
        email: null,
        country: 'Egypt',
        englishLevel: 'Beginner',
        avatarUrl: null,
        tribeId: 1,
        givenFeedbacks: [],
        receivedFeedbacks: [],
      },
    ]);

    const leaderboard = await service.getLeaderboard('user-1');
    expect(leaderboard.topSpeakers[0].name).toBe('Learner');
  });
});
