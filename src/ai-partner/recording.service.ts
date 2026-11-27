import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Readable } from 'stream';
import { PrismaService } from '../prisma.service';
import {
  buildRecordingStorage,
  RecordingStorage,
  UploadPlan,
} from './recording-storage.service';
import { recordingsMaxBytes } from './ai-partner.config';

const KINDS = new Set(['audio', 'video']);

function extFor(mimeType: string): string {
  const base = (mimeType || '').split(';')[0].trim().toLowerCase();
  if (base.includes('mp4')) return 'mp4';
  if (base.includes('ogg')) return 'ogg';
  if (base.includes('mpeg')) return 'mp3';
  if (base.includes('wav')) return 'wav';
  return 'webm';
}

export interface RecordingView {
  id: string;
  kind: string;
  mimeType: string;
  bytes: number;
  durationMs: number;
  position: number;
  createdAt: string;
}

/**
 * Session recordings: audio always, video when the learner turns the camera
 * on. The camera is only ever used to record the session, never analysed.
 * Recording rows are never deleted; a failed upload stays as a failed row so
 * history stays truthful.
 */
@Injectable()
export class RecordingService {
  private storage: RecordingStorage | null | undefined;

  constructor(private readonly prisma: PrismaService) {}

  private store(): RecordingStorage {
    if (this.storage === undefined) this.storage = buildRecordingStorage();
    if (!this.storage) {
      throw new ServiceUnavailableException(
        'Session recording storage is not configured yet.',
      );
    }
    return this.storage;
  }

  /** True when a storage backend is configured (client feature flag source). */
  storageConfigured(): boolean {
    if (this.storage === undefined) this.storage = buildRecordingStorage();
    return this.storage !== null;
  }

  private async ownedSession(sessionId: string, userId: string) {
    const session = await this.prisma.aiPartnerSession.findUnique({
      where: { id: sessionId },
    });
    if (!session || session.userId !== userId) {
      throw new NotFoundException('Session not found.');
    }
    return session;
  }

  private async ownedRecording(recordingId: string, userId: string) {
    const recording = await this.prisma.aiPartnerRecording.findUnique({
      where: { id: recordingId },
    });
    if (!recording || recording.userId !== userId) {
      throw new NotFoundException('Recording not found.');
    }
    return recording;
  }

  /** Reserve the row and hand the client an upload plan. */
  async start(
    sessionId: string,
    userId: string,
    kind: string,
    mimeType: string,
  ): Promise<{ recordingId: string; upload: UploadPlan; maxBytes: number }> {
    const store = this.store();
    if (!KINDS.has(kind)) {
      throw new BadRequestException('kind must be "audio" or "video".');
    }
    await this.ownedSession(sessionId, userId);
    const last = await this.prisma.aiPartnerRecording.findFirst({
      where: { sessionId },
      orderBy: { position: 'desc' },
      select: { position: true },
    });
    const position = (last?.position ?? 0) + 1;
    const recording = await this.prisma.aiPartnerRecording.create({
      data: {
        sessionId,
        userId,
        kind,
        mimeType: (mimeType || '').slice(0, 120),
        position,
      },
    });
    const storageKey = `ai-partner/${userId}/${sessionId}/${recording.id}.${extFor(mimeType)}`;
    await this.prisma.aiPartnerRecording.update({
      where: { id: recording.id },
      data: { storageKey },
    });
    const upload = await store.uploadPlan(storageKey, recording.mimeType);
    return { recordingId: recording.id, upload, maxBytes: recordingsMaxBytes() };
  }

  /** Relay-mode blob upload (local storage). */
  async saveBlob(recordingId: string, userId: string, data: Buffer): Promise<{ bytes: number }> {
    const store = this.store();
    const recording = await this.ownedRecording(recordingId, userId);
    if (recording.status === 'ready') {
      throw new BadRequestException('Recording is already saved.');
    }
    if (!data?.length) throw new BadRequestException('Empty recording.');
    if (data.length > recordingsMaxBytes()) {
      await this.prisma.aiPartnerRecording.update({
        where: { id: recordingId },
        data: { status: 'failed' },
      });
      throw new BadRequestException('Recording is too large.');
    }
    if (!recording.storageKey) throw new BadRequestException('Recording has no storage key.');
    const stat = await store.putBlob(recording.storageKey, data);
    return { bytes: stat.bytes };
  }

  /** Mark the upload finished. Local storage verifies the byte count. */
  async complete(
    recordingId: string,
    userId: string,
    bytes: number,
    durationMs: number,
  ): Promise<RecordingView> {
    const store = this.store();
    const recording = await this.ownedRecording(recordingId, userId);
    if (!recording.storageKey) throw new BadRequestException('Recording has no storage key.');
    if (store.kind === 'local') {
      const stat = await store.stat(recording.storageKey);
      if (!stat || stat.bytes === 0) {
        await this.prisma.aiPartnerRecording.update({
          where: { id: recordingId },
          data: { status: 'failed' },
        });
        throw new BadRequestException('Recording blob was not uploaded.');
      }
      bytes = stat.bytes;
    }
    if (bytes <= 0 || bytes > recordingsMaxBytes()) {
      await this.prisma.aiPartnerRecording.update({
        where: { id: recordingId },
        data: { status: 'failed' },
      });
      throw new BadRequestException('Bad recording size.');
    }
    const updated = await this.prisma.aiPartnerRecording.update({
      where: { id: recordingId },
      data: {
        status: 'ready',
        bytes: Math.floor(bytes),
        durationMs: Math.max(0, Math.floor(durationMs || 0)),
      },
    });
    return this.view(updated);
  }

  /** Ordered, ready recordings of one owned session. Failed/pending rows stay
   *  in the database (history is never deleted) but are not playable. */
  async list(sessionId: string, userId: string): Promise<RecordingView[]> {
    await this.ownedSession(sessionId, userId);
    const rows = await this.prisma.aiPartnerRecording.findMany({
      where: { sessionId, status: 'ready' },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map((row) => this.view(row));
  }

  /** Session ids (of the given set) that have at least one playable recording. */
  async sessionsWithRecordings(userId: string, sessionIds: string[]): Promise<string[]> {
    if (!sessionIds.length) return [];
    const rows = await this.prisma.aiPartnerRecording.findMany({
      where: { userId, sessionId: { in: sessionIds }, status: 'ready' },
      select: { sessionId: true },
      distinct: ['sessionId'],
    });
    return rows.map((row) => row.sessionId);
  }

  /** A playable URL: presigned straight from the bucket with S3 storage, or
   *  the authenticated relay route with local storage. */
  async playback(
    recordingId: string,
    userId: string,
  ): Promise<{ url: string; mimeType: string; expiresInSec?: number }> {
    const store = this.store();
    const recording = await this.ownedRecording(recordingId, userId);
    if (recording.status !== 'ready' || !recording.storageKey) {
      throw new NotFoundException('Recording is not playable.');
    }
    const direct = await store.playbackUrl(recording.storageKey, recording.mimeType);
    if (direct) {
      return { url: direct, mimeType: recording.mimeType, expiresInSec: 900 };
    }
    return { url: `/api/ai-partner/recordings/${recording.id}/blob`, mimeType: recording.mimeType };
  }

  /** Relay-mode streaming (local storage only). */
  async openBlob(
    recordingId: string,
    userId: string,
  ): Promise<{ stream: Readable; mimeType: string; bytes: number }> {
    const store = this.store();
    const recording = await this.ownedRecording(recordingId, userId);
    if (recording.status !== 'ready' || !recording.storageKey) {
      throw new NotFoundException('Recording is not playable.');
    }
    const stream = store.openStream(recording.storageKey);
    return { stream, mimeType: recording.mimeType, bytes: recording.bytes };
  }

  private view(row: any): RecordingView {
    return {
      id: row.id,
      kind: row.kind,
      mimeType: row.mimeType,
      bytes: row.bytes,
      durationMs: row.durationMs,
      position: row.position,
      createdAt: (row.createdAt as Date).toISOString(),
    };
  }
}
