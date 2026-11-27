import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { RecordingService } from './recording.service';

/** In-memory Prisma stub covering only the recording flow's queries. */
function stubPrisma() {
  const sessions = new Map<string, any>();
  const recordings = new Map<string, any>();
  let seq = 0;
  const prisma = {
    _sessions: sessions,
    _recordings: recordings,
    aiPartnerSession: {
      findUnique: async ({ where: { id } }: any) => sessions.get(id) ?? null,
    },
    aiPartnerRecording: {
      create: async ({ data }: any) => {
        const row = {
          id: `rec-${++seq}`,
          status: 'pending',
          storageKey: null,
          mimeType: '',
          bytes: 0,
          durationMs: 0,
          position: 0,
          createdAt: new Date(Date.now() + seq),
          ...data,
        };
        recordings.set(row.id, row);
        return row;
      },
      update: async ({ where: { id }, data }: any) => {
        const row = recordings.get(id);
        if (!row) throw new Error('not found');
        Object.assign(row, data);
        return row;
      },
      findUnique: async ({ where: { id } }: any) => recordings.get(id) ?? null,
      findFirst: async ({ where }: any) => {
        const rows = [...recordings.values()].filter((r) => r.sessionId === where.sessionId);
        rows.sort((a, b) => b.position - a.position);
        return rows[0] ?? null;
      },
      findMany: async ({ where }: any) => {
        let rows = [...recordings.values()];
        if (where.sessionId) rows = rows.filter((r) => r.sessionId === where.sessionId);
        if (where.userId) rows = rows.filter((r) => r.userId === where.userId);
        if (where.status) rows = rows.filter((r) => r.status === where.status);
        rows.sort((a, b) => a.position - b.position || a.createdAt - b.createdAt);
        return rows;
      },
    },
  };
  return prisma;
}

describe('RecordingService', () => {
  let dir: string;
  const OLD = { ...process.env };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'recordings-test-'));
    process.env.AI_PARTNER_RECORDINGS_DIR = dir;
    delete process.env.AI_PARTNER_RECORDINGS_S3_BUCKET;
    delete process.env.AI_PARTNER_RECORDINGS_S3_ACCESS_KEY_ID;
    delete process.env.AI_PARTNER_RECORDINGS_S3_SECRET_ACCESS_KEY;
    delete process.env.AI_PARTNER_RECORDINGS_S3_ENDPOINT;
  });

  afterEach(() => {
    process.env = { ...OLD };
    rmSync(dir, { recursive: true, force: true });
  });

  function setup() {
    const prisma = stubPrisma();
    prisma._sessions.set('s1', { id: 's1', userId: 'u1' });
    prisma._sessions.set('s2', { id: 's2', userId: 'u2' });
    return { prisma, service: new RecordingService(prisma as any) };
  }

  it('answers 503 when no storage is configured', async () => {
    delete process.env.AI_PARTNER_RECORDINGS_DIR;
    const { service } = setup();
    expect(service.storageConfigured()).toBe(false);
    await expect(service.start('s1', 'u1', 'audio', 'audio/webm')).rejects.toMatchObject({
      status: 503,
    });
  });

  it('runs the full relay flow: start, blob, complete, list, playback', async () => {
    const { prisma, service } = setup();
    const started = await service.start('s1', 'u1', 'audio', 'audio/webm');
    expect(started.upload).toEqual({ mode: 'relay' });
    expect(started.maxBytes).toBeGreaterThan(0);

    const blob = Buffer.from('fake-opus-audio');
    await service.saveBlob(started.recordingId, 'u1', blob);
    const done = await service.complete(started.recordingId, 'u1', blob.length, 65000);
    expect(done.bytes).toBe(blob.length);
    expect(done.durationMs).toBe(65000);
    expect(done.position).toBe(1);

    const list = await service.list('s1', 'u1');
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(started.recordingId);

    const playback = await service.playback(started.recordingId, 'u1');
    expect(playback.url).toContain(`/recordings/${started.recordingId}/blob`);
    expect(playback.mimeType).toBe('audio/webm');

    const stream = await service.openBlob(started.recordingId, 'u1');
    const chunks: Buffer[] = [];
    for await (const chunk of stream.stream) chunks.push(chunk as Buffer);
    expect(Buffer.concat(chunks).toString()).toBe('fake-opus-audio');
    expect(prisma._recordings.get(started.recordingId).status).toBe('ready');
  });

  it('orders recordings by position within a session', async () => {
    const { service } = setup();
    const first = await service.start('s1', 'u1', 'audio', 'audio/webm');
    const second = await service.start('s1', 'u1', 'video', 'video/webm');
    expect(first.recordingId).not.toBe(second.recordingId);
    await service.saveBlob(first.recordingId, 'u1', Buffer.from('a'));
    await service.complete(first.recordingId, 'u1', 1, 1000);
    await service.saveBlob(second.recordingId, 'u1', Buffer.from('v'));
    await service.complete(second.recordingId, 'u1', 1, 1000);
    const list = await service.list('s1', 'u1');
    expect(list.map((r) => r.kind)).toEqual(['audio', 'video']);
    expect(list.map((r) => r.position)).toEqual([1, 2]);
  });

  it('marks the row failed (never deletes) when complete arrives without a blob', async () => {
    const { prisma, service } = setup();
    const started = await service.start('s1', 'u1', 'audio', 'audio/webm');
    await expect(service.complete(started.recordingId, 'u1', 100, 1000)).rejects.toThrow();
    expect(prisma._recordings.get(started.recordingId).status).toBe('failed');
    const list = await service.list('s1', 'u1');
    expect(list).toHaveLength(0);
  });

  it('rejects oversized blobs and keeps the failed row', async () => {
    const { prisma, service } = setup();
    const started = await service.start('s1', 'u1', 'video', 'video/webm');
    const huge = Buffer.alloc(151 * 1024 * 1024, 1);
    await expect(service.saveBlob(started.recordingId, 'u1', huge)).rejects.toMatchObject({
      status: 400,
    });
    expect(prisma._recordings.get(started.recordingId).status).toBe('failed');
  });

  it('never exposes recordings across users', async () => {
    const { service } = setup();
    const started = await service.start('s1', 'u1', 'audio', 'audio/webm');
    await expect(service.list('s1', 'u2')).rejects.toMatchObject({ status: 404 });
    await expect(service.playback(started.recordingId, 'u2')).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      service.saveBlob(started.recordingId, 'u2', Buffer.from('x')),
    ).rejects.toMatchObject({ status: 404 });
    await expect(service.start('s2', 'u1', 'audio', 'audio/webm')).rejects.toMatchObject({
      status: 404,
    });
  });

  it('rejects an unknown recording kind', async () => {
    const { service } = setup();
    await expect(service.start('s1', 'u1', 'screen', 'video/webm')).rejects.toMatchObject({
      status: 400,
    });
  });

  it('builds presigned direct upload and playback URLs with S3 env', async () => {
    process.env.AI_PARTNER_RECORDINGS_S3_BUCKET = 'justspeak-recordings';
    process.env.AI_PARTNER_RECORDINGS_S3_ACCESS_KEY_ID = 'testkey';
    process.env.AI_PARTNER_RECORDINGS_S3_SECRET_ACCESS_KEY = 'testsecret';
    process.env.AI_PARTNER_RECORDINGS_S3_ENDPOINT = 'https://acct.r2.cloudflarestorage.com';
    const { service } = setup();
    expect(service.storageConfigured()).toBe(true);
    const started = await service.start('s1', 'u1', 'audio', 'audio/webm');
    if (started.upload.mode !== 'direct') throw new Error('expected direct upload');
    expect(started.upload.url).toContain('justspeak-recordings');
    expect(started.upload.url).toContain('X-Amz-Signature');
    expect(started.upload.url).toContain('/ai-partner/u1/s1/');
    expect(started.upload.url).not.toContain('x-amz-checksum');
    const playback = await service.playback(started.recordingId, 'u1').catch(() => null);
    // Row is still pending, so playback must refuse.
    expect(playback).toBeNull();
  });
});
