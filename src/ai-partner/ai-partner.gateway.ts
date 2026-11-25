import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import { Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma.service';
import { ConversationService } from './conversation.service';
import { AiPartnerService } from './ai-partner.service';
import { aiPartnerEnabled } from './ai-partner.config';

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

/**
 * Live AI Partner voice sessions. One socket carries one session:
 * binary PCM in, transcripts and MP3 reply chunks out.
 *
 * Client protocol:
 *  -> 'start-session'  { sessionId }        (session created via REST first)
 *  -> 'audio'          Buffer               (linear16 PCM, 16 kHz, mono)
 *  -> 'stop-session'   {}
 *  <- 'session-state'  { state: 'listening' | 'thinking' | 'time-up' }
 *  <- 'transcript'     { role:'user', text, isFinal }
 *  <- 'reply-text'     { replyId, sentence, text }
 *  <- 'reply-audio'    { replyId, sentence }, Buffer  (MP3 chunk)
 *  <- 'reply-sentence-end' { replyId, sentence }
 *  <- 'reply-end'      { replyId }
 *  <- 'interrupt'      (barge-in: drop all queued playback immediately)
 *  <- 'metrics'        { ...live metrics }
 *  <- 'error'          { code, message }
 */
@WebSocketGateway({
  namespace: '/ai-partner',
  cors: { origin: resolveGatewayCorsOrigin() },
})
export class AiPartnerGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger('AiPartnerGateway');
  private socketSessions = new Map<string, string>(); // socketId -> sessionId

  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly conversation: ConversationService,
    private readonly aiPartner: AiPartnerService,
  ) {}

  private extractToken(client: Socket): string | null {
    const auth = client.handshake?.auth;
    const authToken = auth?.token || auth?.Authorization || auth?.authorization;
    if (typeof authToken === 'string' && authToken.trim()) {
      return authToken.replace(/^Bearer\s+/i, '').trim();
    }
    const headers = client.handshake?.headers;
    const headerAuth = headers?.authorization || headers?.['authorization'];
    if (typeof headerAuth === 'string' && headerAuth.trim()) {
      return headerAuth.replace(/^Bearer\s+/i, '').trim();
    }
    const queryToken = client.handshake?.query?.token;
    if (typeof queryToken === 'string' && queryToken.trim()) {
      return queryToken.trim();
    }
    return null;
  }

  async handleConnection(client: Socket) {
    if (!aiPartnerEnabled()) {
      client.emit('error', { code: 'DISABLED', message: 'AI Partner is not enabled.' });
      client.disconnect(true);
      return;
    }
    const token = this.extractToken(client);
    if (!token) {
      client.emit('auth-error', { message: 'Authentication required. Please log in.' });
      client.disconnect(true);
      return;
    }
    try {
      const payload = this.jwtService.verify<{ sub: string }>(token, {
        secret: process.env.JWT_SECRET,
      });
      if (!payload?.sub) throw new Error('bad payload');
      (client.data as any).userId = payload.sub;
    } catch {
      client.emit('auth-error', { message: 'Invalid or expired token. Please log in again.' });
      client.disconnect(true);
    }
  }

  async handleDisconnect(client: Socket) {
    const sessionId = this.socketSessions.get(client.id);
    if (sessionId) {
      this.socketSessions.delete(client.id);
      await this.conversation.destroy(sessionId);
    }
  }

  @SubscribeMessage('start-session')
  async startSession(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { sessionId?: string; topicSeed?: string },
  ) {
    const userId = (client.data as any).userId as string;
    const sessionId = body?.sessionId;
    if (!sessionId) {
      client.emit('error', { code: 'BAD_REQUEST', message: 'sessionId is required.' });
      return;
    }

    const session = await this.aiPartner.getOwnedSession(sessionId, userId).catch(() => null);
    if (!session) {
      client.emit('error', { code: 'NOT_FOUND', message: 'Session not found.' });
      return;
    }
    if (session.status !== 'active') {
      client.emit('error', { code: 'SESSION_ENDED', message: 'This session has already ended.' });
      return;
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { name: true },
    });

    // One live session per socket; stop any previous one.
    const previous = this.socketSessions.get(client.id);
    if (previous) await this.conversation.destroy(previous);

    this.socketSessions.set(client.id, sessionId);
    await this.conversation.createLiveSession({
      sessionId,
      userId,
      userName: user?.name?.split(' ')[0] || 'there',
      mode: session.mode,
      personaId: session.personaId,
      level: session.level,
      fieldId: session.fieldId,
      lessonId: session.lessonId,
      topicSeed: typeof body.topicSeed === 'string' ? body.topicSeed.slice(0, 300) : undefined,
      emit: (event, ...args) => client.emit(event, ...args),
    });
  }

  @SubscribeMessage('audio')
  audio(@ConnectedSocket() client: Socket, @MessageBody() chunk: Buffer) {
    const sessionId = this.socketSessions.get(client.id);
    if (!sessionId || !chunk) return;
    this.conversation.get(sessionId)?.sendAudio(Buffer.from(chunk));
  }

  @SubscribeMessage('stop-session')
  async stopSession(@ConnectedSocket() client: Socket) {
    const sessionId = this.socketSessions.get(client.id);
    if (sessionId) {
      this.socketSessions.delete(client.id);
      await this.conversation.destroy(sessionId);
      client.emit('session-state', { state: 'ended' });
    }
  }
}
