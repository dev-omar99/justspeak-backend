import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma.service';
import { RoomsService } from './rooms.service';

interface RoomParticipant {
  socketId: string;
  userId: string;
  userName: string;
  userCountry: string;
}

interface SocketUser {
  id: string;
  email: string | null;
  name: string;
  country: string;
}

function resolveGatewayCorsOrigin(): string | string[] {
  const configured = process.env.CORS_ORIGINS?.trim();
  if (configured) {
    return configured
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);
  }
  return '*';
}

@WebSocketGateway({
  cors: {
    origin: resolveGatewayCorsOrigin(),
  },
})
export class SignalingGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger('SignalingGateway');
  // Map: roomName -> Map<socketId, RoomParticipant>
  private rooms = new Map<string, Map<string, RoomParticipant>>();
  // Map: socketId -> Set of roomNames
  private socketRooms = new Map<string, Set<string>>();

  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly roomsService: RoomsService,
  ) {}

  /**
   * Read-only snapshot of the rooms that have participants connected right
   * now. Used by the admin dashboard; the gateway stays the single owner of
   * the in-memory room state.
   */
  getLiveRooms(): {
    roomName: string;
    participants: { userId: string; userName: string; userCountry: string }[];
  }[] {
    return Array.from(this.rooms.entries()).map(([roomName, room]) => ({
      roomName,
      participants: Array.from(room.values()).map((p) => ({
        userId: p.userId,
        userName: p.userName,
        userCountry: p.userCountry,
      })),
    }));
  }

  private extractToken(client: Socket): string | null {
    // 1. Check handshake.auth
    const auth = client.handshake?.auth;
    const authToken = auth?.token || auth?.Authorization || auth?.authorization;
    if (typeof authToken === 'string' && authToken.trim()) {
      return authToken.replace(/^Bearer\s+/i, '').trim();
    }

    // 2. Check handshake.headers
    const headers = client.handshake?.headers;
    const headerAuth = headers?.authorization || headers?.['authorization'];
    if (typeof headerAuth === 'string' && headerAuth.trim()) {
      return headerAuth.replace(/^Bearer\s+/i, '').trim();
    }

    // 3. Check handshake.query.token fallback (for mobile/webview transports)
    const queryToken = client.handshake?.query?.token;
    if (typeof queryToken === 'string' && queryToken.trim()) {
      return queryToken.replace(/^Bearer\s+/i, '').trim();
    }

    return null;
  }

  async handleConnection(client: Socket) {
    const token = this.extractToken(client);
    if (!token) {
      this.logger.warn(`Rejected unauthenticated connection: missing token (socket: ${client.id})`);
      client.emit('auth-error', { message: 'Authentication required. Please log in.' });
      client.disconnect(true);
      return;
    }

    try {
      const payload = this.jwtService.verify<{ sub: string; email?: string }>(token, {
        secret: process.env.JWT_SECRET,
      });

      if (!payload || !payload.sub) {
        this.logger.warn(`Rejected unauthenticated connection: invalid payload (socket: ${client.id})`);
        client.emit('auth-error', { message: 'Invalid token payload.' });
        client.disconnect(true);
        return;
      }

      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: {
          id: true,
          email: true,
          phone: true,
          name: true,
          country: true,
        },
      });

      if (!user) {
        this.logger.warn(`Rejected unauthenticated connection: user not found (userId: ${payload.sub})`);
        client.emit('auth-error', { message: 'User account not found.' });
        client.disconnect(true);
        return;
      }

      const userName =
        user.name?.trim() || (user.email ? user.email.split('@')[0] : 'Learner');
      const socketUser: SocketUser = {
        id: user.id,
        email: user.email,
        name: userName,
        country: user.country || '',
      };

      client.data.user = socketUser;
      this.socketRooms.set(client.id, new Set());
      if (typeof client.join === 'function') {
        void client.join(`user:${user.id}`);
      }
      this.logger.log(`Client authenticated: ${client.id} (user: ${user.id})`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Invalid token';
      this.logger.warn(`Rejected unauthenticated connection: ${msg} (socket: ${client.id})`);
      client.emit('auth-error', { message: 'Invalid or expired authentication token.' });
      client.disconnect(true);
      return;
    }
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
    const userRooms = this.socketRooms.get(client.id);

    if (userRooms) {
      for (const roomName of userRooms) {
        const room = this.rooms.get(roomName);
        if (room) {
          room.delete(client.id);
          this.server.to(roomName).emit('user-left', { socketId: client.id });
          if (room.size === 0) {
            this.rooms.delete(roomName);
          }
        }
      }
      this.socketRooms.delete(client.id);
    }
  }

  @SubscribeMessage('join-room')
  async handleJoinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      roomName: string;
    },
  ) {
    const user: SocketUser | undefined = client.data?.user;
    if (!user) {
      client.emit('auth-error', { message: 'Unauthorized: connection not authenticated.' });
      client.disconnect(true);
      return;
    }

    const roomName = typeof data?.roomName === 'string' ? data.roomName.trim() : '';
    if (!roomName) {
      client.emit('room-error', { message: 'A valid roomName is required.' });
      return;
    }

    // 1. Authoritative Room Authorization Check (Synchronous in-memory lookup, with DB recovery on NOT_FOUND after restart)
    let authCheck = this.roomsService.isUserAuthorizedForRoom(roomName, user.id);
    if (!authCheck.authorized && authCheck.reason === 'NOT_FOUND') {
      const dbSession = await this.prisma.session.findFirst({
        where: { roomName },
      });
      const dbParticipants: string[] = Array.isArray((dbSession as any)?.participantIds)
        ? (dbSession as any).participantIds
        : [];
      if (dbSession && dbParticipants.length > 0) {
        const createdAtMs = dbSession.createdAt
          ? new Date(dbSession.createdAt).getTime()
          : Date.now();
        const remainingTtlMs = 60 * 60 * 1000 - (Date.now() - createdAtMs);
        if (remainingTtlMs <= 0) {
          authCheck = { authorized: false, reason: 'EXPIRED' };
        } else if (!dbParticipants.includes(user.id)) {
          authCheck = { authorized: false, reason: 'UNAUTHORIZED_USER' };
        } else {
          if (typeof (this.roomsService as any).registerRoomAuthorization === 'function') {
            (this.roomsService as any).registerRoomAuthorization(
              roomName,
              dbParticipants,
              remainingTtlMs,
            );
          }
          authCheck = { authorized: true };
        }
      }
    }

    if (!authCheck.authorized) {
      let message = 'You are not authorized to join this practice room.';
      if (authCheck.reason === 'EXPIRED') {
        message = 'This practice session has expired.';
      } else if (authCheck.reason === 'CLOSED') {
        message = 'This practice session has ended.';
      } else if (authCheck.reason === 'NOT_FOUND') {
        message = 'Room session does not exist.';
      }
      this.logger.warn(
        `Rejected join for user ${user.id} in room ${roomName} (${authCheck.reason})`,
      );
      client.emit('room-error', { message });
      return;
    }

    // 2. Capacity & Duplicate Connection Reconciliation (Synchronous in-memory)
    let room = this.rooms.get(roomName);
    if (!room) {
      room = new Map();
      this.rooms.set(roomName, room);
    }

    // Check if the same user is reconnecting on a different socket
    for (const [existingSocketId, existingParticipant] of room.entries()) {
      if (existingParticipant.userId === user.id && existingSocketId !== client.id) {
        // Evict previous stale socket for this user
        room.delete(existingSocketId);
        const oldUserRooms = this.socketRooms.get(existingSocketId);
        if (oldUserRooms) {
          oldUserRooms.delete(roomName);
        }
        try {
          const oldSocket = this.server?.sockets?.sockets?.get?.(existingSocketId);
          if (oldSocket) {
            void oldSocket.leave(roomName);
          }
        } catch {}
      }
    }

    // Strict 2-participant limit
    if (room.size >= 2 && !room.has(client.id)) {
      this.logger.warn(
        `User ${user.id} rejected: room ${roomName} is full (${room.size} participants)`,
      );
      client.emit('room-error', {
        message: 'This room is already full (maximum 2 participants).',
      });
      return;
    }

    // 3. Synchronously reserve slot before yielding event loop
    const participant: RoomParticipant = {
      socketId: client.id,
      userId: user.id,
      userName: user.name,
      userCountry: user.country,
    };

    const existingParticipants = Array.from(room.values());
    room.set(client.id, participant);

    let userRooms = this.socketRooms.get(client.id);
    if (!userRooms) {
      userRooms = new Set();
      this.socketRooms.set(client.id, userRooms);
    }
    userRooms.add(roomName);

    // 4. Asynchronous verification of DB session record and Socket.IO join
    try {
      const session = await this.prisma.session.findFirst({
        where: { roomName },
      });

      if (!session) {
        // Rollback reservation
        room.delete(client.id);
        userRooms.delete(roomName);
        if (room.size === 0) this.rooms.delete(roomName);
        this.logger.warn(`Session record not found for room ${roomName}, rolled back reservation`);
        client.emit('room-error', { message: 'Room session does not exist or has expired.' });
        return;
      }

      await client.join(roomName);
    } catch (err: unknown) {
      // Rollback reservation on failure
      room.delete(client.id);
      userRooms.delete(roomName);
      if (room.size === 0) this.rooms.delete(roomName);
      const msg = err instanceof Error ? err.message : 'Join error';
      this.logger.error(`Error completing join for ${client.id} in ${roomName}: ${msg}`);
      client.emit('room-error', { message: 'Failed to join room. Please try again.' });
      return;
    }

    this.logger.log(
      `User ${participant.userName} (${user.id}) joined room ${roomName} (${room.size} participants)`,
    );

    client.emit('existing-participants', existingParticipants);
    client.to(roomName).emit('user-joined', participant);
  }

  private areSocketsInSameRoom(socketIdA: string, socketIdB: string): string | null {
    if (!socketIdA || !socketIdB || socketIdA === socketIdB) return null;
    const roomsA = this.socketRooms.get(socketIdA);
    const roomsB = this.socketRooms.get(socketIdB);
    if (!roomsA || !roomsB) return null;

    for (const roomName of roomsA) {
      if (roomsB.has(roomName)) {
        return roomName;
      }
    }
    return null;
  }

  private isClientInRoom(socketId: string, roomName: string): boolean {
    if (!socketId || !roomName) return false;
    const rooms = this.socketRooms.get(socketId);
    return !!rooms && rooms.has(roomName.trim());
  }

  @SubscribeMessage('offer')
  handleOffer(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      toSocketId: string;
      offer: any;
    },
  ) {
    if (!client.data?.user || !data?.toSocketId) return;

    const commonRoom = this.areSocketsInSameRoom(client.id, data.toSocketId);
    if (!commonRoom) {
      this.logger.warn(`Unauthorized offer attempt from ${client.id} to ${data.toSocketId}`);
      return;
    }

    const authCheck = this.roomsService.isUserAuthorizedForRoom(commonRoom, client.data.user.id);
    if (!authCheck.authorized) return;

    this.server.to(data.toSocketId).emit('offer', {
      fromSocketId: client.id,
      offer: data.offer,
    });
  }

  @SubscribeMessage('answer')
  handleAnswer(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      toSocketId: string;
      answer: any;
    },
  ) {
    if (!client.data?.user || !data?.toSocketId) return;

    const commonRoom = this.areSocketsInSameRoom(client.id, data.toSocketId);
    if (!commonRoom) {
      this.logger.warn(`Unauthorized answer attempt from ${client.id} to ${data.toSocketId}`);
      return;
    }

    const authCheck = this.roomsService.isUserAuthorizedForRoom(commonRoom, client.data.user.id);
    if (!authCheck.authorized) return;

    this.server.to(data.toSocketId).emit('answer', {
      fromSocketId: client.id,
      answer: data.answer,
    });
  }

  @SubscribeMessage('ice-candidate')
  handleIceCandidate(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      toSocketId: string;
      candidate: any;
    },
  ) {
    if (!client.data?.user || !data?.toSocketId) return;

    const commonRoom = this.areSocketsInSameRoom(client.id, data.toSocketId);
    if (!commonRoom) {
      this.logger.warn(`Unauthorized ice-candidate attempt from ${client.id} to ${data.toSocketId}`);
      return;
    }

    const authCheck = this.roomsService.isUserAuthorizedForRoom(commonRoom, client.data.user.id);
    if (!authCheck.authorized) return;

    this.server.to(data.toSocketId).emit('ice-candidate', {
      fromSocketId: client.id,
      candidate: data.candidate,
    });
  }

  @SubscribeMessage('send-reaction')
  handleSendReaction(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomName: string; emoji: string },
  ) {
    if (
      !client.data?.user ||
      !data?.roomName ||
      typeof data.emoji !== 'string'
    ) {
      return;
    }
    const emoji = data.emoji.trim();
    if (!emoji || emoji.length > 16) return;

    if (!this.isClientInRoom(client.id, data.roomName)) {
      this.logger.warn(`Unauthorized send-reaction attempt from ${client.id} for room ${data.roomName}`);
      return;
    }

    const authCheck = this.roomsService.isUserAuthorizedForRoom(data.roomName, client.data.user.id);
    if (!authCheck.authorized) return;

    this.server.to(data.roomName.trim()).emit('reaction-received', {
      emoji,
      fromSocketId: client.id,
    });
  }

  @SubscribeMessage('switch-topic')
  handleSwitchTopic(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomName: string; questionIndex: number },
  ) {
    if (
      !client.data?.user ||
      !data?.roomName ||
      typeof data.questionIndex !== 'number' ||
      !Number.isInteger(data.questionIndex) ||
      data.questionIndex < 0 ||
      data.questionIndex >= 100
    ) {
      return;
    }

    if (!this.isClientInRoom(client.id, data.roomName)) {
      this.logger.warn(`Unauthorized switch-topic attempt from ${client.id} for room ${data.roomName}`);
      return;
    }

    const authCheck = this.roomsService.isUserAuthorizedForRoom(data.roomName, client.data.user.id);
    if (!authCheck.authorized) return;

    this.server.to(data.roomName.trim()).emit('topic-switched', {
      questionIndex: data.questionIndex,
      fromSocketId: client.id,
    });
  }

  @SubscribeMessage('chat-message')
  handleChatMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomName: string; text: string },
  ) {
    const user: SocketUser | undefined = client.data?.user;
    if (!user || !data?.roomName || typeof data.text !== 'string') return;

    const text = data.text.trim();
    if (!text || text.length > 500) return;

    if (!this.isClientInRoom(client.id, data.roomName)) {
      this.logger.warn(`Unauthorized chat-message attempt from ${client.id} for room ${data.roomName}`);
      return;
    }

    const authCheck = this.roomsService.isUserAuthorizedForRoom(data.roomName, user.id);
    if (!authCheck.authorized) return;

    this.server.to(data.roomName.trim()).emit('chat-message-received', {
      text,
      senderName: user.name,
      fromSocketId: client.id,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    });
  }

  @SubscribeMessage('leave-room')
  handleLeaveRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomName: string },
  ) {
    if (!data?.roomName || typeof data.roomName !== 'string') return;
    const roomName = data.roomName.trim();

    void client.leave(roomName);

    const room = this.rooms.get(roomName);
    if (room) {
      room.delete(client.id);
      this.server.to(roomName).emit('user-left', { socketId: client.id });
      if (room.size === 0) {
        this.rooms.delete(roomName);
      }
    }

    const userRooms = this.socketRooms.get(client.id);
    if (userRooms) {
      userRooms.delete(roomName);
    }
  }

  @SubscribeMessage('ring-buddy')
  handleRingBuddy(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      buddyId: string;
      roomName: string;
      sessionId: string;
      topic?: string;
    },
  ) {
    const user: SocketUser | undefined = client.data?.user;
    if (!user || !data?.buddyId || !data?.roomName) return;

    const authCheck = this.roomsService.isUserAuthorizedForRoom(
      data.roomName.trim(),
      user.id,
    );
    if (!authCheck.authorized) return;

    this.server.to(`user:${data.buddyId.trim()}`).emit('incoming-buddy-call', {
      callerId: user.id,
      callerName: user.name,
      callerCountry: user.country,
      roomName: data.roomName.trim(),
      sessionId: data.sessionId || '',
      topic: data.topic || 'Free Conversation Practice',
    });
  }
}
