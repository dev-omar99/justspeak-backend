import { Test, TestingModule } from '@nestjs/testing';
import { RoomsService } from './rooms.service';
import { PrismaService } from '../prisma.service';

describe('RoomsService', () => {
  let service: RoomsService;
  let prismaService: PrismaService;

  const mockPrismaService = {
    session: {
      create: jest.fn(),
      findFirst: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
    userBlock: {
      findMany: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RoomsService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<RoomsService>(RoomsService);
    prismaService = module.get<PrismaService>(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createRoom', () => {
    it('should throw error if creatorUserId is empty or invalid', async () => {
      await expect(service.createRoom('')).rejects.toThrow(
        'Authenticated creator user ID is required to create a room.',
      );
      await expect(service.createRoom('   ')).rejects.toThrow(
        'Authenticated creator user ID is required to create a room.',
      );
    });

    it('should create room, persist session, and register authorization for creator', async () => {
      mockPrismaService.session.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: data.id, roomName: data.roomName, topic: data.topic }),
      );

      const room = await service.createRoom('user-creator-1');

      expect(room).toBeDefined();
      expect(room.roomName).toMatch(/^JustSpeak-/);
      expect(mockPrismaService.session.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            roomName: room.roomName,
            topic: room.topic,
          }),
        }),
      );

      // Verify creator is authorized
      const authCreator = service.isUserAuthorizedForRoom(room.roomName, 'user-creator-1');
      expect(authCreator).toEqual({ authorized: true });

      // Verify unauthorized user is rejected
      const authOther = service.isUserAuthorizedForRoom(room.roomName, 'user-other-99');
      expect(authOther).toEqual({ authorized: false, reason: 'UNAUTHORIZED_USER' });
    });
  });

  describe('joinQueue and Matchmaking authorization', () => {
    it('should put first user in waiting queue', async () => {
      mockPrismaService.userBlock.findMany.mockResolvedValue([]);
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'user-a',
        name: 'Alice',
        country: 'EG',
      });

      const result = await service.joinQueue('user-a', false);

      expect(result.status).toBe('waiting');
      expect(result.room).toBeUndefined();
    });

    it('should match two queued users, create session, and register authorization for both', async () => {
      mockPrismaService.userBlock.findMany.mockResolvedValue([]);
      mockPrismaService.user.findUnique.mockImplementation(({ where }) => {
        if (where.id === 'user-a') return Promise.resolve({ id: 'user-a', name: 'Alice', country: 'EG' });
        if (where.id === 'user-b') return Promise.resolve({ id: 'user-b', name: 'Bob', country: 'US' });
        return Promise.resolve(null);
      });
      mockPrismaService.session.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: 'sess-match-1', roomName: data.roomName, topic: data.topic }),
      );
      mockPrismaService.user.updateMany.mockResolvedValue({ count: 2 });

      // Alice enters queue
      const res1 = await service.joinQueue('user-a', false);
      expect(res1.status).toBe('waiting');

      // Bob enters queue -> match made!
      const res2 = await service.joinQueue('user-b', false);
      expect(res2.status).toBe('matched');
      expect(res2.room).toBeDefined();

      const roomName = res2.room!.roomName;

      // Alice polls queue -> gets matched room
      const res3 = await service.joinQueue('user-a', false);
      expect(res3.status).toBe('matched');
      expect(res3.room?.roomName).toBe(roomName);

      // Verify authorization registry:
      // Alice is authorized
      expect(service.isUserAuthorizedForRoom(roomName, 'user-a')).toEqual({ authorized: true });
      // Bob is authorized
      expect(service.isUserAuthorizedForRoom(roomName, 'user-b')).toEqual({ authorized: true });
      // Charlie (User C) is NOT authorized
      expect(service.isUserAuthorizedForRoom(roomName, 'user-c')).toEqual({
        authorized: false,
        reason: 'UNAUTHORIZED_USER',
      });
    });

    it('should not match blocked users', async () => {
      // User A enters queue
      mockPrismaService.userBlock.findMany.mockResolvedValueOnce([]);
      mockPrismaService.user.findUnique.mockResolvedValueOnce({ id: 'user-a', name: 'Alice', country: 'EG' });
      await service.joinQueue('user-a', false);

      // User B enters queue, but User A has blocked User B
      mockPrismaService.userBlock.findMany.mockResolvedValueOnce([
        { id: 'blk-1', userId: 'user-a', blockedId: 'user-b' },
      ]);
      mockPrismaService.user.findUnique.mockResolvedValueOnce({ id: 'user-b', name: 'Bob', country: 'US' });

      const res = await service.joinQueue('user-b', false);
      expect(res.status).toBe('waiting');
    });
  });

  describe('createBuddyCall', () => {
    it('should throw error if buddy is not found', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      await expect(service.createBuddyCall('user-caller', 'user-buddy-missing')).rejects.toThrow(
        'Buddy not found',
      );
    });

    it('should create buddy session and register authorization for caller and buddy', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'buddy-2',
        name: 'Friend',
        email: 'friend@justspeak.com',
        country: 'UK',
      });
      mockPrismaService.session.create.mockImplementation(({ data }) =>
        Promise.resolve({ id: 'sess-buddy-1', roomName: data.roomName, topic: data.topic }),
      );

      const room = await service.createBuddyCall('user-caller', 'buddy-2', 'Custom Topic');

      expect(room).toBeDefined();
      expect(room.roomName).toMatch(/^justspeak-buddy-/);
      expect(room.partnerId).toBe('buddy-2');

      // Authorization checks
      expect(service.isUserAuthorizedForRoom(room.roomName, 'user-caller')).toEqual({ authorized: true });
      expect(service.isUserAuthorizedForRoom(room.roomName, 'buddy-2')).toEqual({ authorized: true });
      expect(service.isUserAuthorizedForRoom(room.roomName, 'attacker-user')).toEqual({
        authorized: false,
        reason: 'UNAUTHORIZED_USER',
      });
    });
  });

  describe('isUserAuthorizedForRoom & lifecycle (expiration, closure)', () => {
    it('should return NOT_FOUND for unknown roomName or missing params', () => {
      expect(service.isUserAuthorizedForRoom('', 'user-1')).toEqual({
        authorized: false,
        reason: 'NOT_FOUND',
      });
      expect(service.isUserAuthorizedForRoom('non-existent-room', 'user-1')).toEqual({
        authorized: false,
        reason: 'NOT_FOUND',
      });
    });

    it('should return EXPIRED if room TTL has elapsed', () => {
      const roomName = 'expired-room';
      // Register with -1ms TTL
      service.registerRoomAuthorization(roomName, ['user-1'], -1000);

      const check = service.isUserAuthorizedForRoom(roomName, 'user-1');
      expect(check).toEqual({ authorized: false, reason: 'EXPIRED' });
    });

    it('should return CLOSED if room has been closed', () => {
      const roomName = 'closed-room';
      service.registerRoomAuthorization(roomName, ['user-1', 'user-2']);

      expect(service.isUserAuthorizedForRoom(roomName, 'user-1')).toEqual({ authorized: true });

      service.closeRoomSession(roomName);

      expect(service.isUserAuthorizedForRoom(roomName, 'user-1')).toEqual({
        authorized: false,
        reason: 'CLOSED',
      });
    });
  });

  describe('leaveQueue', () => {
    it('should remove user from queue and matched rooms', async () => {
      mockPrismaService.userBlock.findMany.mockResolvedValue([]);
      mockPrismaService.user.findUnique.mockResolvedValue({ id: 'user-a', name: 'Alice' });

      await service.joinQueue('user-a', false);
      await service.leaveQueue('user-a');

      // Re-joining queue should return 'waiting' rather than matching with itself
      const res = await service.joinQueue('user-a', false);
      expect(res.status).toBe('waiting');
    });
  });

  describe('Matchmaking Concurrency, Rollback & Privacy (H4, M1)', () => {
    it('should serialize concurrent joinQueue calls so a waiting user is matched only once and the 3rd user stays waiting', async () => {
      mockPrismaService.userBlock.findMany.mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 15));
        return [];
      });
      mockPrismaService.user.findUnique.mockImplementation(async ({ where }) => {
        await new Promise((r) => setTimeout(r, 10));
        return { id: where.id, name: `Name-${where.id}`, country: 'EG' };
      });
      mockPrismaService.user.updateMany.mockResolvedValue({ count: 2 });
      let sessionCounter = 0;
      mockPrismaService.session.create.mockImplementation(async ({ data }) => {
        sessionCounter += 1;
        return {
          id: `sess-conc-${sessionCounter}`,
          roomName: data.roomName,
          topic: data.topic,
          participantIds: data.participantIds,
        };
      });

      // User A joins first and waits
      const resA = await service.joinQueue('user-a', false);
      expect(resA.status).toBe('waiting');

      // Users B and C join concurrently while A is waiting
      const [resB, resC] = await Promise.all([
        service.joinQueue('user-b', false),
        service.joinQueue('user-c', false),
      ]);

      const matchedResults = [resB, resC].filter((r) => r.status === 'matched');
      const waitingResults = [resB, resC].filter((r) => r.status === 'waiting');

      expect(matchedResults).toHaveLength(1);
      expect(waitingResults).toHaveLength(1);
      expect(sessionCounter).toBe(1);

      // Now User D joins and should match with whoever of B/C was left waiting
      const resD = await service.joinQueue('user-d', false);
      expect(resD.status).toBe('matched');
      expect(sessionCounter).toBe(2);
    });

    it('should remove both users from waiting queue after a match so neither can be matched into a second room', async () => {
      mockPrismaService.userBlock.findMany.mockResolvedValue([]);
      mockPrismaService.user.findUnique.mockImplementation(async ({ where }) => ({
        id: where.id,
        name: `User-${where.id}`,
        country: 'US',
      }));
      mockPrismaService.user.updateMany.mockResolvedValue({ count: 2 });
      mockPrismaService.session.create.mockImplementation(async ({ data }) => ({
        id: 'sess-clean-1',
        roomName: data.roomName,
        topic: data.topic,
      }));

      // Both A and B are in waitingQueue initially (e.g., blocked by country filter first, then relaxed)
      await service.joinQueue('user-a', true);
      // Same country with differentCountryOnly = true -> B also waits
      const resBWait = await service.joinQueue('user-b', true);
      expect(resBWait.status).toBe('waiting');

      // Now B polls with differentCountryOnly = false, while A had true -> still filtered, so A polls with false
      const resAMatch = await service.joinQueue('user-a', false);
      // Since B had differentCountryOnly = true, let's have B switch to false first, then A switch to false
      await service.joinQueue('user-b', false);
      const finalMatch = await service.joinQueue('user-a', false);
      expect(finalMatch.status).toBe('matched');

      // A third user C joining should NOT match with A or B (queue is now empty except C)
      const resC = await service.joinQueue('user-c', false);
      expect(resC.status).toBe('waiting');
    });

    it('should preserve waiting partner in queue if session creation fails during matchmaking', async () => {
      mockPrismaService.userBlock.findMany.mockResolvedValue([]);
      mockPrismaService.user.findUnique.mockImplementation(async ({ where }) => ({
        id: where.id,
        name: `User-${where.id}`,
        country: 'EG',
      }));
      mockPrismaService.user.updateMany.mockResolvedValue({ count: 2 });

      // User A enters waiting queue
      await service.joinQueue('user-a', false);

      // User B tries to match, but DB session.create fails
      mockPrismaService.session.create.mockRejectedValueOnce(new Error('DB write error'));
      await expect(service.joinQueue('user-b', false)).rejects.toThrow('DB write error');

      // User A must still be in the waiting queue so User C can match with User A once DB recovers
      mockPrismaService.session.create.mockResolvedValueOnce({
        id: 'sess-recovered',
        roomName: 'justspeak-recovered',
        topic: 'Topic',
      });
      const resC = await service.joinQueue('user-c', false);
      expect(resC.status).toBe('matched');
      expect(resC.room?.partnerId).toBe('user-a');
    });

    it('should never expose user phone number as partnerName when name and email are missing', async () => {
      mockPrismaService.userBlock.findMany.mockResolvedValue([]);
      mockPrismaService.user.findUnique.mockImplementation(async ({ where }) => ({
        id: where.id,
        name: null,
        email: null,
        phone: '+201099998888',
        country: 'EG',
      }));
      mockPrismaService.user.updateMany.mockResolvedValue({ count: 2 });
      mockPrismaService.session.create.mockResolvedValue({
        id: 'sess-priv-1',
        roomName: 'justspeak-priv',
        topic: 'Topic',
      });

      await service.joinQueue('user-phone-1', false);
      const match = await service.joinQueue('user-phone-2', false);

      expect(match.status).toBe('matched');
      expect(match.room?.partnerName).toBe('Learner');
      expect(match.room?.partnerName).not.toContain('+201099998888');
    });
  });

  describe('recoverTicket Security, Ownership, Eligibility & Concurrency', () => {
    beforeEach(() => {
      (mockPrismaService.session as any).findUnique = jest.fn();
    });

    it('should reject missing userId or missing sessionId', async () => {
      await expect(service.recoverTicket('', 'sess-1')).rejects.toThrow('User ID is required');
      await expect(service.recoverTicket('user-1', '')).rejects.toThrow(
        'Session ID is required to recover a ticket',
      );
      await expect(service.recoverTicket('user-1', undefined)).rejects.toThrow(
        'Session ID is required to recover a ticket',
      );
    });

    it('should reject when session does not exist', async () => {
      (mockPrismaService.session as any).findUnique.mockResolvedValue(null);

      await expect(service.recoverTicket('user-1', 'non-existent')).rejects.toThrow(
        'Session not found',
      );
    });

    it('should reject with ForbiddenException when user is not a participant of the session', async () => {
      (mockPrismaService.session as any).findUnique.mockResolvedValue({
        id: 'sess-valid',
        roomName: 'justspeak-abc123',
        participantIds: ['user-a', 'user-b'],
        createdAt: new Date(Date.now() - 60_000),
        feedbacks: [],
      });

      await expect(service.recoverTicket('attacker-user', 'sess-valid')).rejects.toThrow(
        'You are not a participant of this session',
      );
    });

    it('should reject ticket recovery for solo or buddy-call sessions that did not consume a queue ticket', async () => {
      (mockPrismaService.session as any).findUnique.mockResolvedValueOnce({
        id: 'sess-buddy',
        roomName: 'justspeak-buddy-123',
        participantIds: ['user-a', 'user-b'],
        createdAt: new Date(Date.now() - 30_000),
        feedbacks: [],
      });

      await expect(service.recoverTicket('user-a', 'sess-buddy')).rejects.toThrow(
        'Ticket recovery is only available for matched queue sessions',
      );

      (mockPrismaService.session as any).findUnique.mockResolvedValueOnce({
        id: 'sess-solo',
        roomName: 'JustSpeak-solo',
        participantIds: ['user-a'],
        createdAt: new Date(Date.now() - 30_000),
        feedbacks: [],
      });

      await expect(service.recoverTicket('user-a', 'sess-solo')).rejects.toThrow(
        'Ticket recovery is only available for matched queue sessions',
      );
    });

    it('should reject ticket recovery if the user already submitted feedback for the session', async () => {
      (mockPrismaService.session as any).findUnique.mockResolvedValue({
        id: 'sess-completed',
        roomName: 'justspeak-done123',
        participantIds: ['user-a', 'user-b'],
        createdAt: new Date(Date.now() - 120_000),
        feedbacks: [{ giverId: 'user-a' }],
      });

      await expect(service.recoverTicket('user-a', 'sess-completed')).rejects.toThrow(
        'Cannot recover ticket for a completed session',
      );
    });

    it('should reject ticket recovery if the 7-minute session duration has already elapsed', async () => {
      (mockPrismaService.session as any).findUnique.mockResolvedValue({
        id: 'sess-old',
        roomName: 'justspeak-old123',
        participantIds: ['user-a', 'user-b'],
        createdAt: new Date(Date.now() - 8 * 60 * 1000),
        feedbacks: [],
      });

      await expect(service.recoverTicket('user-a', 'sess-old')).rejects.toThrow(
        'Session duration has already elapsed; ticket cannot be recovered',
      );
    });

    it('should refund exactly 1 ticket and be strictly idempotent under concurrent calls', async () => {
      let currentTickets = 3;
      (mockPrismaService.session as any).findUnique.mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 15));
        return {
          id: 'sess-early-1',
          roomName: 'justspeak-early1',
          participantIds: ['user-a', 'user-b'],
          createdAt: new Date(Date.now() - 90_000),
          feedbacks: [],
        };
      });
      mockPrismaService.user.findUnique.mockImplementation(async () => ({
        id: 'user-a',
        ticketsLeft: currentTickets,
      }));
      mockPrismaService.user.updateMany.mockImplementation(async () => {
        currentTickets += 1;
        return { count: 1 };
      });

      // Fire 3 concurrent recoverTicket requests for the same (user-a, sess-early-1)
      const [r1, r2, r3] = await Promise.all([
        service.recoverTicket('user-a', 'sess-early-1'),
        service.recoverTicket('user-a', 'sess-early-1'),
        service.recoverTicket('user-a', 'sess-early-1'),
      ]);

      expect(r1).toEqual({ success: true, ticketsLeft: 4 });
      expect(r2).toEqual({ success: true, ticketsLeft: 4 });
      expect(r3).toEqual({ success: true, ticketsLeft: 4 });
      expect(mockPrismaService.user.updateMany).toHaveBeenCalledTimes(1);
      expect(service.hasUserRecoveredTicket('sess-early-1', 'user-a')).toBe(true);
      expect(service.hasUserRecoveredTicket('sess-early-1', 'user-b')).toBe(false);
    });
  });

  describe('Queue Ticket Enforcement & 24-Hour Reset Logic', () => {
    it('should reject joinQueue with BadRequestException when user has 0 tickets and lastTicketReset is within 24 hours', async () => {
      mockPrismaService.userBlock.findMany.mockResolvedValue([]);
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'user-zero',
        name: 'ZeroTicketUser',
        country: 'EG',
        ticketsLeft: 0,
        lastTicketReset: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
      });

      await expect(service.joinQueue('user-zero', false)).rejects.toThrow(
        'No daily tickets remaining. Please wait for your daily ticket recharge.',
      );

      expect(mockPrismaService.user.updateMany).not.toHaveBeenCalled();
    });

    it('should reset tickets to 5 and allow joinQueue when user has 0 tickets but lastTicketReset is >= 24 hours ago', async () => {
      mockPrismaService.userBlock.findMany.mockResolvedValue([]);
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'user-reset',
        name: 'EligibleResetUser',
        country: 'EG',
        ticketsLeft: 0,
        lastTicketReset: new Date(Date.now() - 25 * 60 * 60 * 1000), // 25 hours ago
      });
      mockPrismaService.user.updateMany.mockResolvedValue({ count: 1 });

      const res = await service.joinQueue('user-reset', false);

      expect(res.status).toBe('waiting');
      expect(mockPrismaService.user.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-reset' },
          data: expect.objectContaining({
            ticketsLeft: 5,
          }),
        }),
      );
    });

    it('should evict a waiting candidate whose tickets dropped to 0 before matching', async () => {
      mockPrismaService.userBlock.findMany.mockResolvedValue([]);

      // Step 1: User A enters waiting queue when they have 1 ticket
      let userATickets = 1;
      mockPrismaService.user.findUnique.mockImplementation(async ({ where }) => {
        if (where.id === 'user-a') {
          return {
            id: 'user-a',
            name: 'Alice',
            country: 'EG',
            ticketsLeft: userATickets,
            lastTicketReset: new Date(),
          };
        }
        if (where.id === 'user-b') {
          return {
            id: 'user-b',
            name: 'Bob',
            country: 'US',
            ticketsLeft: 3,
            lastTicketReset: new Date(),
          };
        }
        return null;
      });

      const resA = await service.joinQueue('user-a', false);
      expect(resA.status).toBe('waiting');

      // Suppose User A's tickets drop to 0 before User B joins
      userATickets = 0;

      const resB = await service.joinQueue('user-b', false);
      // User A should be evicted, and User B should wait rather than matching with 0-ticket User A
      expect(resB.status).toBe('waiting');
      expect(mockPrismaService.session.create).not.toHaveBeenCalled();
    });

    it('should prevent concurrent joinQueue calls from bypassing ticket enforcement or matching twice with 1 ticket', async () => {
      mockPrismaService.userBlock.findMany.mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 10));
        return [];
      });

      const ticketStore: Record<string, number> = {
        'user-1ticket': 1,
        'user-partner-1': 3,
        'user-partner-2': 3,
      };

      mockPrismaService.user.findUnique.mockImplementation(async ({ where }) => {
        await new Promise((r) => setTimeout(r, 10));
        const id = where.id;
        if (!(id in ticketStore)) return null;
        return {
          id,
          name: `Name-${id}`,
          country: 'US',
          ticketsLeft: ticketStore[id],
          lastTicketReset: new Date(),
        };
      });

      mockPrismaService.user.updateMany.mockImplementation(async ({ where }) => {
        const ids: string[] = where?.id?.in || [];
        let deducted = 0;
        for (const id of ids) {
          if (ticketStore[id] > 0) {
            ticketStore[id] -= 1;
            deducted += 1;
          }
        }
        return { count: deducted };
      });

      let sessionsCreated = 0;
      mockPrismaService.session.create.mockImplementation(async ({ data }) => {
        sessionsCreated += 1;
        return {
          id: `sess-ticket-conc-${sessionsCreated}`,
          roomName: data.roomName,
          topic: data.topic,
        };
      });

      // user-1ticket enters queue first
      await service.joinQueue('user-1ticket', false);

      // Two partners concurrently join while user-1ticket only has 1 ticket
      const [resP1, resP2] = await Promise.all([
        service.joinQueue('user-partner-1', false),
        service.joinQueue('user-partner-2', false),
      ]);

      const matchedCount = [resP1, resP2].filter((r) => r.status === 'matched').length;
      expect(matchedCount).toBe(1);
      expect(sessionsCreated).toBe(1);
      expect(ticketStore['user-1ticket']).toBe(0);

      // Now if user-1ticket leaves the matched room and tries to joinQueue again with 0 tickets, it must be rejected
      await service.leaveQueue('user-1ticket');
      await expect(service.joinQueue('user-1ticket', false)).rejects.toThrow(
        'No daily tickets remaining. Please wait for your daily ticket recharge.',
      );
    });
  });
});

