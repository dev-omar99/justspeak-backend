import { Test, TestingModule } from '@nestjs/testing';
import { SignalingGateway } from './signaling.gateway';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma.service';
import { RoomsService } from './rooms.service';
import { Socket, Server } from 'socket.io';

describe('SignalingGateway', () => {
  let gateway: SignalingGateway;
  let jwtService: JwtService;
  let prismaService: PrismaService;
  let roomsService: RoomsService;

  const mockJwtService = {
    verify: jest.fn(),
  };

  const mockPrismaService = {
    user: {
      findUnique: jest.fn(),
    },
    session: {
      findFirst: jest.fn(),
    },
  };

  const mockRoomsService = {
    isUserAuthorizedForRoom: jest.fn(),
  };

  const mockServer = {
    to: jest.fn().mockReturnThis(),
    emit: jest.fn(),
    sockets: {
      sockets: new Map<string, any>(),
    },
  } as unknown as Server;

  function createMockSocket(id: string, token?: string): Partial<Socket> & { data: any } {
    const socketObj: any = {
      id,
      data: {},
      handshake: {
        auth: token ? { token } : {},
        headers: {},
      },
      emit: jest.fn(),
      disconnect: jest.fn(),
      join: jest.fn().mockResolvedValue(undefined),
      leave: jest.fn().mockResolvedValue(undefined),
      to: jest.fn().mockReturnThis(),
    };
    return socketObj;
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    (mockServer.sockets.sockets as Map<string, any>).clear();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SignalingGateway,
        { provide: JwtService, useValue: mockJwtService },
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: RoomsService, useValue: mockRoomsService },
      ],
    }).compile();

    gateway = module.get<SignalingGateway>(SignalingGateway);
    gateway.server = mockServer;
    jwtService = module.get<JwtService>(JwtService);
    prismaService = module.get<PrismaService>(PrismaService);
    roomsService = module.get<RoomsService>(RoomsService);
  });

  it('should be defined', () => {
    expect(gateway).toBeDefined();
  });

  describe('handleConnection', () => {
    it('should reject connection when no auth token is provided', async () => {
      const client = createMockSocket('sock-1') as unknown as Socket;

      await gateway.handleConnection(client);

      expect(client.emit).toHaveBeenCalledWith('auth-error', {
        message: 'Authentication required. Please log in.',
      });
      expect(client.disconnect).toHaveBeenCalledWith(true);
      expect(client.data.user).toBeUndefined();
    });

    it('should reject connection when token is invalid or expired', async () => {
      const client = createMockSocket('sock-1', 'invalid.jwt.token') as unknown as Socket;
      mockJwtService.verify.mockImplementation(() => {
        throw new Error('jwt expired');
      });

      await gateway.handleConnection(client);

      expect(client.emit).toHaveBeenCalledWith('auth-error', {
        message: 'Invalid or expired authentication token.',
      });
      expect(client.disconnect).toHaveBeenCalledWith(true);
      expect(client.data.user).toBeUndefined();
    });

    it('should reject connection when user does not exist in database', async () => {
      const client = createMockSocket('sock-1', 'valid.jwt.token') as unknown as Socket;
      mockJwtService.verify.mockReturnValue({ sub: 'user-unknown' });
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      await gateway.handleConnection(client);

      expect(client.emit).toHaveBeenCalledWith('auth-error', {
        message: 'User account not found.',
      });
      expect(client.disconnect).toHaveBeenCalledWith(true);
    });

    it('should authenticate client successfully when valid token and user exist', async () => {
      const client = createMockSocket('sock-1', 'Bearer valid.jwt.token') as unknown as Socket;
      mockJwtService.verify.mockReturnValue({ sub: 'user-1', email: 'test@justspeak.com' });
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'test@justspeak.com',
        phone: null,
        name: 'Ahmed',
        country: 'Egypt',
      });

      await gateway.handleConnection(client);

      expect(client.disconnect).not.toHaveBeenCalled();
      expect(client.data.user).toEqual({
        id: 'user-1',
        email: 'test@justspeak.com',
        name: 'Ahmed',
        country: 'Egypt',
      });
    });

    it('should default display name to Learner and never expose phone number when name and email are absent', async () => {
      const client = createMockSocket('sock-phone', 'Bearer valid.jwt.token') as unknown as Socket;
      mockJwtService.verify.mockReturnValue({ sub: 'user-phone' });
      mockPrismaService.user.findUnique.mockResolvedValue({
        id: 'user-phone',
        email: null,
        phone: '+201099887766',
        name: null,
        country: 'EG',
      });

      await gateway.handleConnection(client);

      expect(client.disconnect).not.toHaveBeenCalled();
      expect(client.data.user.name).toBe('Learner');
      expect(client.data.user.name).not.toContain('201099887766');
    });
  });

  describe('handleJoinRoom authorization checks', () => {
    it('should reject unauthenticated socket trying to join room', async () => {
      const client = createMockSocket('sock-unauth') as unknown as Socket;

      await gateway.handleJoinRoom(client, { roomName: 'room-101' });

      expect(client.emit).toHaveBeenCalledWith('auth-error', expect.any(Object));
      expect(client.disconnect).toHaveBeenCalledWith(true);
    });

    it('should reject join-room if roomName is empty', async () => {
      const client = createMockSocket('sock-1') as unknown as Socket;
      client.data.user = { id: 'user-1', name: 'User 1', country: 'EG' };

      await gateway.handleJoinRoom(client, { roomName: '   ' });

      expect(client.emit).toHaveBeenCalledWith('room-error', {
        message: 'A valid roomName is required.',
      });
      expect(client.join).not.toHaveBeenCalled();
    });

    it('should REJECT unauthorized User C from joining a room session created for User A and User B', async () => {
      const clientC = createMockSocket('sock-c') as unknown as Socket;
      clientC.data.user = { id: 'user-c', name: 'Charlie (Intruder)', country: 'FR' };

      // RoomsService reports UNAUTHORIZED_USER for User C
      mockRoomsService.isUserAuthorizedForRoom.mockReturnValue({
        authorized: false,
        reason: 'UNAUTHORIZED_USER',
      });

      await gateway.handleJoinRoom(clientC, { roomName: 'justspeak-match-123' });

      expect(mockRoomsService.isUserAuthorizedForRoom).toHaveBeenCalledWith(
        'justspeak-match-123',
        'user-c',
      );
      expect(clientC.emit).toHaveBeenCalledWith('room-error', {
        message: 'You are not authorized to join this practice room.',
      });
      expect(clientC.join).not.toHaveBeenCalled();
      expect(mockPrismaService.session.findFirst).not.toHaveBeenCalled();
    });

    it('should reject join if room session is EXPIRED', async () => {
      const client = createMockSocket('sock-1') as unknown as Socket;
      client.data.user = { id: 'user-1', name: 'User 1', country: 'EG' };

      mockRoomsService.isUserAuthorizedForRoom.mockReturnValue({
        authorized: false,
        reason: 'EXPIRED',
      });

      await gateway.handleJoinRoom(client, { roomName: 'room-expired' });

      expect(client.emit).toHaveBeenCalledWith('room-error', {
        message: 'This practice session has expired.',
      });
      expect(client.join).not.toHaveBeenCalled();
    });

    it('should reject join if room session is CLOSED', async () => {
      const client = createMockSocket('sock-1') as unknown as Socket;
      client.data.user = { id: 'user-1', name: 'User 1', country: 'EG' };

      mockRoomsService.isUserAuthorizedForRoom.mockReturnValue({
        authorized: false,
        reason: 'CLOSED',
      });

      await gateway.handleJoinRoom(client, { roomName: 'room-closed' });

      expect(client.emit).toHaveBeenCalledWith('room-error', {
        message: 'This practice session has ended.',
      });
      expect(client.join).not.toHaveBeenCalled();
    });

    it('should reject join-room if room does not exist in sessions table', async () => {
      const client = createMockSocket('sock-1') as unknown as Socket;
      client.data.user = { id: 'user-1', name: 'User 1', country: 'EG' };
      mockRoomsService.isUserAuthorizedForRoom.mockReturnValue({ authorized: true });
      mockPrismaService.session.findFirst.mockResolvedValue(null);

      await gateway.handleJoinRoom(client, { roomName: 'fake-room-999' });

      expect(client.emit).toHaveBeenCalledWith('room-error', {
        message: 'Room session does not exist or has expired.',
      });
      expect(client.join).not.toHaveBeenCalled();
    });

    it('should recover room authorization from persisted Session.participantIds after a server restart (NOT_FOUND in memory)', async () => {
      const client = createMockSocket('sock-restart') as unknown as Socket;
      client.data.user = { id: 'user-1', name: 'User 1', country: 'EG' };
      mockRoomsService.isUserAuthorizedForRoom.mockReturnValue({
        authorized: false,
        reason: 'NOT_FOUND',
      });
      (mockRoomsService as any).registerRoomAuthorization = jest.fn();
      mockPrismaService.session.findFirst.mockResolvedValue({
        id: 'sess-restart',
        roomName: 'room-restart',
        participantIds: ['user-1', 'user-2'],
        createdAt: new Date(Date.now() - 5 * 60 * 1000), // 5 mins ago (within 60m TTL)
      });

      await gateway.handleJoinRoom(client, { roomName: 'room-restart' });

      expect((mockRoomsService as any).registerRoomAuthorization).toHaveBeenCalledWith(
        'room-restart',
        ['user-1', 'user-2'],
        expect.any(Number),
      );
      expect(client.join).toHaveBeenCalledWith('room-restart');
    });

    it('should allow authorized users to join room session successfully', async () => {
      mockRoomsService.isUserAuthorizedForRoom.mockReturnValue({ authorized: true });
      mockPrismaService.session.findFirst.mockResolvedValue({ id: 'sess-1', roomName: 'room-abc' });

      const client1 = createMockSocket('sock-1') as unknown as Socket;
      client1.data.user = { id: 'user-1', name: 'User One', country: 'EG' };

      await gateway.handleJoinRoom(client1, { roomName: 'room-abc' });

      expect(client1.join).toHaveBeenCalledWith('room-abc');
      expect(client1.emit).toHaveBeenCalledWith('existing-participants', []);

      // Now authorized client2 joins the same room
      const client2 = createMockSocket('sock-2') as unknown as Socket;
      client2.data.user = { id: 'user-2', name: 'User Two', country: 'US' };

      await gateway.handleJoinRoom(client2, { roomName: 'room-abc' });

      expect(client2.join).toHaveBeenCalledWith('room-abc');
      expect(client2.emit).toHaveBeenCalledWith('existing-participants', [
        {
          socketId: 'sock-1',
          userId: 'user-1',
          userName: 'User One',
          userCountry: 'EG',
        },
      ]);
    });

    it('should reconcile reconnecting user socket without occupying duplicate slot', async () => {
      mockRoomsService.isUserAuthorizedForRoom.mockReturnValue({ authorized: true });
      mockPrismaService.session.findFirst.mockResolvedValue({ id: 'sess-1', roomName: 'room-recon' });

      // User A connects first time
      const oldSocket = createMockSocket('sock-old') as unknown as Socket;
      oldSocket.data.user = { id: 'user-a', name: 'Alice', country: 'EG' };
      (mockServer.sockets.sockets as Map<string, any>).set('sock-old', oldSocket);

      await gateway.handleJoinRoom(oldSocket, { roomName: 'room-recon' });

      // User B connects
      const clientB = createMockSocket('sock-b') as unknown as Socket;
      clientB.data.user = { id: 'user-b', name: 'Bob', country: 'US' };
      await gateway.handleJoinRoom(clientB, { roomName: 'room-recon' });

      // User A reconnects with new socket ID 'sock-new'
      const newSocket = createMockSocket('sock-new') as unknown as Socket;
      newSocket.data.user = { id: 'user-a', name: 'Alice', country: 'EG' };

      await gateway.handleJoinRoom(newSocket, { roomName: 'room-recon' });

      // Old socket was instructed to leave room
      expect(oldSocket.leave).toHaveBeenCalledWith('room-recon');
      // New socket joined successfully
      expect(newSocket.join).toHaveBeenCalledWith('room-recon');
      // Existing participants returned should be Bob (sock-b), not duplicate Alice
      expect(newSocket.emit).toHaveBeenCalledWith('existing-participants', [
        {
          socketId: 'sock-b',
          userId: 'user-b',
          userName: 'Bob',
          userCountry: 'US',
        },
      ]);
    });

    it('should reject 3rd distinct participant when room already has 2 participants', async () => {
      mockRoomsService.isUserAuthorizedForRoom.mockReturnValue({ authorized: true });
      mockPrismaService.session.findFirst.mockResolvedValue({ id: 'sess-1', roomName: 'room-full' });

      const client1 = createMockSocket('sock-1') as unknown as Socket;
      client1.data.user = { id: 'user-1', name: 'U1', country: 'EG' };
      await gateway.handleJoinRoom(client1, { roomName: 'room-full' });

      const client2 = createMockSocket('sock-2') as unknown as Socket;
      client2.data.user = { id: 'user-2', name: 'U2', country: 'US' };
      await gateway.handleJoinRoom(client2, { roomName: 'room-full' });

      // Third authorized user tries to join
      const client3 = createMockSocket('sock-3') as unknown as Socket;
      client3.data.user = { id: 'user-3', name: 'U3', country: 'UK' };
      await gateway.handleJoinRoom(client3, { roomName: 'room-full' });

      expect(client3.emit).toHaveBeenCalledWith('room-error', {
        message: 'This room is already full (maximum 2 participants).',
      });
      expect(client3.join).not.toHaveBeenCalled();
    });

    it('should safely limit capacity to 2 participants when 3 distinct authorized users join concurrently via Promise.all', async () => {
      mockRoomsService.isUserAuthorizedForRoom.mockReturnValue({ authorized: true });
      mockPrismaService.session.findFirst.mockResolvedValue({ id: 'sess-concurrent', roomName: 'room-concurrent' });

      const client1 = createMockSocket('sock-c1') as unknown as Socket;
      client1.data.user = { id: 'user-c1', name: 'User 1', country: 'EG' };

      const client2 = createMockSocket('sock-c2') as unknown as Socket;
      client2.data.user = { id: 'user-c2', name: 'User 2', country: 'US' };

      const client3 = createMockSocket('sock-c3') as unknown as Socket;
      client3.data.user = { id: 'user-c3', name: 'User 3', country: 'UK' };

      // Dispatch join-room concurrently for 3 distinct authorized users
      await Promise.all([
        gateway.handleJoinRoom(client1, { roomName: 'room-concurrent' }),
        gateway.handleJoinRoom(client2, { roomName: 'room-concurrent' }),
        gateway.handleJoinRoom(client3, { roomName: 'room-concurrent' }),
      ]);

      const roomParticipants = (gateway as any).rooms.get('room-concurrent');
      expect(roomParticipants).toBeDefined();
      expect(roomParticipants.size).toBe(2);

      const clients = [client1, client2, client3];
      const admittedClients = clients.filter((c) => roomParticipants.has(c.id));
      const rejectedClients = clients.filter((c) => !roomParticipants.has(c.id));

      expect(admittedClients.length).toBe(2);
      expect(rejectedClients.length).toBe(1);

      const rejectedClient = rejectedClients[0];
      expect(rejectedClient.emit).toHaveBeenCalledWith('room-error', {
        message: 'This room is already full (maximum 2 participants).',
      });
      expect(rejectedClient.join).not.toHaveBeenCalled();

      for (const admitted of admittedClients) {
        expect(admitted.join).toHaveBeenCalledWith('room-concurrent');
      }
    });

    it('should roll back internal room maps and socket tracking when client.join rejects with an adapter error', async () => {
      mockRoomsService.isUserAuthorizedForRoom.mockReturnValue({ authorized: true });
      mockPrismaService.session.findFirst.mockResolvedValue({ id: 'sess-err', roomName: 'room-fail' });

      const client = createMockSocket('sock-fail') as unknown as Socket;
      client.data.user = { id: 'user-fail', name: 'Faulty User', country: 'FR' };

      // Simulate a Socket.IO adapter or network error during client.join
      const adapterError = new Error('Socket.IO adapter error');
      (client.join as jest.Mock).mockRejectedValueOnce(adapterError);

      await gateway.handleJoinRoom(client, { roomName: 'room-fail' });

      // Verify that room-error is emitted
      expect(client.emit).toHaveBeenCalledWith('room-error', {
        message: 'Failed to join room. Please try again.',
      });

      // Verify that no successful join notifications are broadcast
      expect(client.emit).not.toHaveBeenCalledWith('existing-participants', expect.anything());
      expect(client.to).not.toHaveBeenCalled();

      // Verify that internal room map is removed since room is empty
      const roomMap = (gateway as any).rooms.get('room-fail');
      expect(roomMap).toBeUndefined();

      // Verify that socketRooms mapping no longer contains room-fail
      const userRooms = (gateway as any).socketRooms.get(client.id);
      expect(userRooms?.has('room-fail')).toBe(false);
    });
  });

  describe('WebRTC signaling isolation', () => {
    beforeEach(async () => {
      mockRoomsService.isUserAuthorizedForRoom.mockReturnValue({ authorized: true });
      mockPrismaService.session.findFirst.mockResolvedValue({ id: 'sess-1', roomName: 'room-talk' });
    });

    it('should relay offer, answer, and ice-candidate between sockets in the same room', async () => {
      const client1 = createMockSocket('sock-1') as unknown as Socket;
      client1.data.user = { id: 'user-1', name: 'U1', country: 'EG' };
      await gateway.handleJoinRoom(client1, { roomName: 'room-talk' });

      const client2 = createMockSocket('sock-2') as unknown as Socket;
      client2.data.user = { id: 'user-2', name: 'U2', country: 'US' };
      await gateway.handleJoinRoom(client2, { roomName: 'room-talk' });

      // Client1 sends offer to Client2
      gateway.handleOffer(client1, { toSocketId: 'sock-2', offer: { type: 'offer', sdp: 'dummy-sdp' } });
      expect(mockServer.to).toHaveBeenCalledWith('sock-2');
      expect(mockServer.emit).toHaveBeenCalledWith('offer', {
        fromSocketId: 'sock-1',
        offer: { type: 'offer', sdp: 'dummy-sdp' },
      });

      // Client2 sends answer to Client1
      gateway.handleAnswer(client2, { toSocketId: 'sock-1', answer: { type: 'answer', sdp: 'dummy-answer' } });
      expect(mockServer.to).toHaveBeenCalledWith('sock-1');
      expect(mockServer.emit).toHaveBeenCalledWith('answer', {
        fromSocketId: 'sock-2',
        answer: { type: 'answer', sdp: 'dummy-answer' },
      });

      // Client1 sends ice candidate to Client2
      gateway.handleIceCandidate(client1, { toSocketId: 'sock-2', candidate: { candidate: 'candidate-str' } });
      expect(mockServer.to).toHaveBeenCalledWith('sock-2');
      expect(mockServer.emit).toHaveBeenCalledWith('ice-candidate', {
        fromSocketId: 'sock-1',
        candidate: { candidate: 'candidate-str' },
      });
    });

    it('should block signaling injection to a socket in a different room', async () => {
      mockPrismaService.session.findFirst.mockImplementation(({ where }) =>
        Promise.resolve({ id: `sess-${where.roomName}`, roomName: where.roomName }),
      );

      const client1 = createMockSocket('sock-1') as unknown as Socket;
      client1.data.user = { id: 'user-1', name: 'U1', country: 'EG' };
      await gateway.handleJoinRoom(client1, { roomName: 'room-talk' });

      const client3 = createMockSocket('sock-3') as unknown as Socket;
      client3.data.user = { id: 'user-3', name: 'U3', country: 'FR' };
      await gateway.handleJoinRoom(client3, { roomName: 'room-other' });

      jest.clearAllMocks();

      // Client3 tries to send offer to Client1 (different rooms)
      gateway.handleOffer(client3, { toSocketId: 'sock-1', offer: { malicious: true } });

      expect(mockServer.to).not.toHaveBeenCalled();
      expect(mockServer.emit).not.toHaveBeenCalled();
    });
  });

  describe('In-room events (reactions, topics, chat, leave)', () => {
    beforeEach(async () => {
      mockRoomsService.isUserAuthorizedForRoom.mockReturnValue({ authorized: true });
      mockPrismaService.session.findFirst.mockResolvedValue({ id: 'sess-1', roomName: 'room-chat' });
    });

    it('should broadcast reaction, topic-switch, and chat only when client is an authorized room member', async () => {
      const client1 = createMockSocket('sock-1') as unknown as Socket;
      client1.data.user = { id: 'user-1', name: 'Ahmed', country: 'EG' };
      await gateway.handleJoinRoom(client1, { roomName: 'room-chat' });

      jest.clearAllMocks();

      // Send reaction
      gateway.handleSendReaction(client1, { roomName: 'room-chat', emoji: '🎉' });
      expect(mockServer.to).toHaveBeenCalledWith('room-chat');
      expect(mockServer.emit).toHaveBeenCalledWith('reaction-received', {
        emoji: '🎉',
        fromSocketId: 'sock-1',
      });

      // Switch topic
      gateway.handleSwitchTopic(client1, { roomName: 'room-chat', questionIndex: 3 });
      expect(mockServer.to).toHaveBeenCalledWith('room-chat');
      expect(mockServer.emit).toHaveBeenCalledWith('topic-switched', {
        questionIndex: 3,
        fromSocketId: 'sock-1',
      });

      // Chat message (uses authenticated user name 'Ahmed')
      gateway.handleChatMessage(client1, { roomName: 'room-chat', text: 'Hello buddy!' });
      expect(mockServer.to).toHaveBeenCalledWith('room-chat');
      expect(mockServer.emit).toHaveBeenCalledWith(
        'chat-message-received',
        expect.objectContaining({
          text: 'Hello buddy!',
          senderName: 'Ahmed',
          fromSocketId: 'sock-1',
        }),
      );
    });

    it('should block chat or reaction if user is not in the room', async () => {
      const clientOutside = createMockSocket('sock-outsider') as unknown as Socket;
      clientOutside.data.user = { id: 'user-hacker', name: 'Attacker' };

      jest.clearAllMocks();

      gateway.handleChatMessage(clientOutside, { roomName: 'room-chat', text: 'Spam text' });
      expect(mockServer.to).not.toHaveBeenCalled();

      gateway.handleSendReaction(clientOutside, { roomName: 'room-chat', emoji: '💩' });
      expect(mockServer.to).not.toHaveBeenCalled();
    });

    it('should handle leave-room and notify room members', async () => {
      const client1 = createMockSocket('sock-1') as unknown as Socket;
      client1.data.user = { id: 'user-1', name: 'Ahmed', country: 'EG' };
      await gateway.handleJoinRoom(client1, { roomName: 'room-chat' });

      jest.clearAllMocks();

      gateway.handleLeaveRoom(client1, { roomName: 'room-chat' });

      expect(client1.leave).toHaveBeenCalledWith('room-chat');
      expect(mockServer.to).toHaveBeenCalledWith('room-chat');
      expect(mockServer.emit).toHaveBeenCalledWith('user-left', { socketId: 'sock-1' });
    });

    it('should reject oversized reactions, out-of-range topic indices, and oversized chat messages', async () => {
      const client1 = createMockSocket('sock-1') as unknown as Socket;
      client1.data.user = { id: 'user-1', name: 'Ahmed', country: 'EG' };
      await gateway.handleJoinRoom(client1, { roomName: 'room-chat' });

      jest.clearAllMocks();

      // Oversized reaction (>16 chars)
      gateway.handleSendReaction(client1, { roomName: 'room-chat', emoji: 'x'.repeat(20) });
      expect(mockServer.to).not.toHaveBeenCalled();

      // Out-of-bounds questionIndex
      gateway.handleSwitchTopic(client1, { roomName: 'room-chat', questionIndex: -1 });
      gateway.handleSwitchTopic(client1, { roomName: 'room-chat', questionIndex: 100 });
      gateway.handleSwitchTopic(client1, { roomName: 'room-chat', questionIndex: 1.5 });
      expect(mockServer.to).not.toHaveBeenCalled();

      // Oversized chat message (>500 chars)
      gateway.handleChatMessage(client1, { roomName: 'room-chat', text: 'a'.repeat(501) });
      expect(mockServer.to).not.toHaveBeenCalled();
    });
  });
});
