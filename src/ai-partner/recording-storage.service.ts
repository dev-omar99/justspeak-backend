import { createReadStream, mkdirSync, statSync, existsSync } from 'fs';
import { writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { Readable } from 'stream';
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  recordingsLocalDir,
  recordingsMaxBytes,
  recordingsS3,
  recordingsUrlTtlSec,
} from './ai-partner.config';

export type UploadPlan =
  | { mode: 'direct'; url: string; headers: Record<string, string> }
  | { mode: 'relay' };

export interface StoredStat {
  bytes: number;
}

/**
 * Where session recordings live. Implementations:
 *  - S3RecordingStorage: any S3-compatible bucket (Cloudflare R2 free tier:
 *    10 GB + free egress; Backblaze B2: 10 GB free). Media bytes go straight
 *    between browser and bucket through presigned URLs, so the web service
 *    pays no egress and never buffers a recording.
 *  - LocalRecordingStorage: a plain directory, for development and tests.
 *  - no storage configured: recording is disabled, endpoints answer 503.
 */
export interface RecordingStorage {
  readonly kind: 's3' | 'local';
  uploadPlan(key: string, mimeType: string): Promise<UploadPlan>;
  /** Relay mode: persist an uploaded blob under key. */
  putBlob(key: string, data: Buffer): Promise<StoredStat>;
  stat(key: string): Promise<StoredStat | null>;
  /** A short-lived URL the client can play the recording from, or null when
   *  the client must use the authenticated relay route instead. */
  playbackUrl(key: string, mimeType: string): Promise<string | null>;
  /** Relay mode: open a read stream for the stored blob. */
  openStream(key: string): Readable;
}

@Injectable()
export class S3RecordingStorage implements RecordingStorage {
  readonly kind = 's3';
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor() {
    const cfg = recordingsS3();
    if (!cfg) {
      throw new ServiceUnavailableException('S3 recording storage is not configured.');
    }
    this.bucket = cfg.bucket;
    this.client = new S3Client({
      region: cfg.region,
      endpoint: cfg.endpoint,
      forcePathStyle: Boolean(cfg.endpoint),
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
      // Keep presigned PUTs free of checksum headers: R2/B2 reject URLs that
      // carry the SDK's default x-amz-checksum-crc32 parameter.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  }

  async uploadPlan(key: string, mimeType: string): Promise<UploadPlan> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: mimeType,
      ContentLength: undefined,
    });
    const url = await getSignedUrl(this.client, command, {
      expiresIn: recordingsUrlTtlSec(),
    });
    return { mode: 'direct', url, headers: { 'content-type': mimeType } };
  }

  /** Direct uploads go browser-to-bucket; relay is not used with S3. */
  async putBlob(): Promise<StoredStat> {
    throw new ServiceUnavailableException('Relay upload is only for local storage.');
  }

  async stat(): Promise<StoredStat | null> {
    // Verifying object size needs a HeadObject round-trip per completion;
    // the client-reported size is recorded instead and the row stays honest
    // because playback of a missing object simply 404s. HeadObject checks
    // can be added here if abuse ever becomes a concern.
    return null;
  }

  async playbackUrl(key: string, mimeType: string): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ResponseContentType: mimeType || undefined,
    });
    return getSignedUrl(this.client, command, { expiresIn: recordingsUrlTtlSec() });
  }

  openStream(): Readable {
    throw new ServiceUnavailableException('Stream relay is only for local storage.');
  }
}

@Injectable()
export class LocalRecordingStorage implements RecordingStorage {
  readonly kind = 'local';
  private readonly dir: string;

  constructor() {
    const dir = recordingsLocalDir();
    if (!dir) {
      throw new ServiceUnavailableException('Local recording storage is not configured.');
    }
    this.dir = dir;
    mkdirSync(this.dir, { recursive: true });
  }

  private pathFor(key: string): string {
    if (key.includes('..')) throw new ServiceUnavailableException('Bad key.');
    return join(this.dir, key);
  }

  async uploadPlan(): Promise<UploadPlan> {
    return { mode: 'relay' };
  }

  async putBlob(key: string, data: Buffer): Promise<StoredStat> {
    const path = this.pathFor(key);
    mkdirSync(dirname(path), { recursive: true });
    await writeFile(path, data);
    return { bytes: data.length };
  }

  async stat(key: string): Promise<StoredStat | null> {
    const path = this.pathFor(key);
    if (!existsSync(path)) return null;
    return { bytes: statSync(path).size };
  }

  async playbackUrl(): Promise<string | null> {
    return null;
  }

  openStream(key: string): Readable {
    const path = this.pathFor(key);
    if (!existsSync(path)) throw new ServiceUnavailableException('Recording blob missing.');
    return createReadStream(path);
  }
}

/** Picks the configured storage, or null when recording is disabled. */
export function buildRecordingStorage(): RecordingStorage | null {
  if (recordingsS3()) return new S3RecordingStorage();
  if (recordingsLocalDir()) return new LocalRecordingStorage();
  return null;
}
