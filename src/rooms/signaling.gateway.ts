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

interface RoomParticipant {
  socketId: string;
  userId?: string;
  userName?: string;
  userCountry?: string;
}

@WebSocketGateway({
  cors: {
    origin: '*',
  },
})
export class SignalingGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private logger = new Logger('SignalingGateway');
  // Map: roomName -> Map<socketId, RoomParticipant>
  private rooms = new Map<string, Map<string, RoomParticipant>>();
  // Map: socketId -> Set of roomNames
  private socketRooms = new Map<string, Set<string>>();

  handleConnection(client: Socket) {
    this.logger.log(`Client connected: ${client.id}`);
    this.socketRooms.set(client.id, new Set());
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
  handleJoinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: {
      roomName: string;
      userId?: string;
      userName?: string;
      userCountry?: string;
    },
  ) {
    const { roomName, userId, userName, userCountry } = data;
    if (!roomName) return;

    client.join(roomName);

    if (!this.rooms.has(roomName)) {
      this.rooms.set(roomName, new Map());
    }

    const room = this.rooms.get(roomName)!;
    const participant: RoomParticipant = {
      socketId: client.id,
      userId,
      userName: userName || 'Partner',
      userCountry: userCountry || '',
    };

    // Get participants currently in the room before this user joined
    const existingParticipants = Array.from(room.values());

    room.set(client.id, participant);

    let userRooms = this.socketRooms.get(client.id);
    if (!userRooms) {
      userRooms = new Set();
      this.socketRooms.set(client.id, userRooms);
    }
    userRooms.add(roomName);

    this.logger.log(
      `User ${userName || client.id} joined room ${roomName} (${room.size} participants)`,
    );

    // Send the list of existing participants to the newcomer
    client.emit('existing-participants', existingParticipants);

    // Notify others in room that a newcomer has joined
    client.to(roomName).emit('user-joined', participant);
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
    this.server.to(data.roomName).emit('reaction-received', {
      emoji: data.emoji,
      fromSocketId: client.id,
    });
  }

  @SubscribeMessage('switch-topic')
  handleSwitchTopic(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomName: string; questionIndex: number },
  ) {
    this.server.to(data.roomName).emit('topic-switched', {
      questionIndex: data.questionIndex,
      fromSocketId: client.id,
    });
  }

  @SubscribeMessage('chat-message')
  handleChatMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomName: string; text: string; senderName?: string },
  ) {
    this.server.to(data.roomName).emit('chat-message-received', {
      text: data.text,
      senderName: data.senderName,
      fromSocketId: client.id,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    });
  }

  @SubscribeMessage('leave-room')
  handleLeaveRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomName: string },
  ) {
    const { roomName } = data;
    client.leave(roomName);
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
}
