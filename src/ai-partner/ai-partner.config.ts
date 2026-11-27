/**
 * Central configuration for the AI Partner feature.
 * Everything is opt-in: with JUSTSPEAK_AI_ENABLED unset the module boots
 * but every endpoint answers 503 and the gateway rejects sessions.
 */

export function aiPartnerEnabled(): boolean {
  return process.env.JUSTSPEAK_AI_ENABLED?.trim().toLowerCase() === 'true';
}

export function anthropicApiKey(): string | null {
  return process.env.ANTHROPIC_API_KEY?.trim() || null;
}

export function deepgramApiKey(): string | null {
  return process.env.DEEPGRAM_API_KEY?.trim() || null;
}

export function elevenLabsApiKey(): string | null {
  return process.env.ELEVENLABS_API_KEY?.trim() || null;
}

/** Live conversation model. Default matches the plan: Claude Haiku. */
export function liveModel(): string {
  return process.env.AI_PARTNER_LIVE_MODEL?.trim() || 'claude-haiku-4-5';
}

/** Post-session report model. Default matches the plan: Claude Sonnet. */
export function feedbackModel(): string {
  return process.env.AI_PARTNER_FEEDBACK_MODEL?.trim() || 'claude-sonnet-4-5';
}

/** Placement / level-check model. Default: Claude Opus. */
export function placementModel(): string {
  return process.env.AI_PARTNER_PLACEMENT_MODEL?.trim() || 'claude-opus-4-5';
}

export function elevenLabsModelId(): string {
  return process.env.ELEVENLABS_MODEL_ID?.trim() || 'eleven_turbo_v2_5';
}

export function elevenLabsVoiceId(envVar: string): string | null {
  return process.env[envVar]?.trim() || null;
}

/** Free plan: 5 lifetime AI sessions (Omar's decision, matching Yoodli's free tier). */
export function freeSessionQuota(): number {
  const parsed = parseInt(process.env.AI_PARTNER_FREE_SESSIONS ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5;
}

/** Paid plans: sessions per day. Defaults documented in .env.example. */
export function paidDailySessionQuota(planTier: string): number {
  const plus = parseInt(process.env.AI_PARTNER_PLUS_DAILY_SESSIONS ?? '', 10);
  const elite = parseInt(process.env.AI_PARTNER_ELITE_DAILY_SESSIONS ?? '', 10);
  if (planTier === 'ELITE') {
    return Number.isFinite(elite) && elite > 0 ? elite : 30;
  }
  if (planTier === 'PLUS') {
    return Number.isFinite(plus) && plus > 0 ? plus : 10;
  }
  return 0;
}

/** Hard cap on one live session, whatever the plan. */
export function maxSessionMinutes(): number {
  const parsed = parseInt(process.env.AI_PARTNER_MAX_SESSION_MINUTES ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 20;
}

/** Cap on simultaneous live sessions, protecting the free-tier providers
 *  (Groq TPM, ElevenLabs characters) and the server's own memory. Past the
 *  cap a new starter gets a friendly "busy, try again" instead of a
 *  degraded session for everyone. */
export function maxConcurrentLiveSessions(): number {
  const parsed = parseInt(process.env.AI_PARTNER_MAX_CONCURRENT_LIVE ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 20;
}


/** Optional OpenAI-compatible provider for the live loop (e.g. Groq free tier).
 *  When AI_PARTNER_LIVE_BASE_URL is unset, the live loop stays on Anthropic. */
export function liveBaseUrl(): string | null {
  return process.env.AI_PARTNER_LIVE_BASE_URL?.trim() || null;
}

export function liveApiKey(): string | null {
  return (
    process.env.AI_PARTNER_LIVE_API_KEY?.trim() ||
    process.env.ANTHROPIC_API_KEY?.trim() ||
    null
  );
}

/** Live "say it better" rewrites. Defaults to the live model (same provider). */
export function rephraseModel(): string {
  return process.env.AI_PARTNER_REPHRASE_MODEL?.trim() || liveModel();
}

/** How long after the last STT final we still wait before committing the
 *  learner's turn (long = more room to finish a sentence). Yoodli lets a
 *  learner pause 3-5s mid-answer and replies ~4s after the real end. */
export function commitFallbackMs(): number {
  const parsed = parseInt(process.env.AI_PARTNER_COMMIT_FALLBACK_MS ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 6000;
}

/** Minimum voiced seconds before a scored session report is attempted. */
export function minReportSpeechSec(): number {
  const parsed = parseInt(process.env.AI_PARTNER_MIN_REPORT_SPEECH_SEC ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 60;
}

/** Optional Azure Pronunciation Assessment (real phoneme-level scoring). Off by default. */
export function pronunciationEnabled(): boolean {
  return (
    process.env.AZURE_SPEECH_PRONUNCIATION_ENABLED?.trim().toLowerCase() ===
    'true'
  );
}

export function azureSpeechKey(): string | null {
  return process.env.AZURE_SPEECH_KEY?.trim() || null;
}

export function azureSpeechRegion(): string {
  return process.env.AZURE_SPEECH_REGION?.trim() || 'eastus';
}

/** Cap on simultaneous Azure calls per process (provider quota protection). */
export function pronunciationMaxConcurrent(): number {
  const parsed = parseInt(process.env.AZURE_SPEECH_MAX_CONCURRENT ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 4;
}

/**
 * Session recording storage. Everything is opt-in and free-tier first:
 *  - AI_PARTNER_RECORDINGS_S3_BUCKET (+ _ENDPOINT, _ACCESS_KEY_ID,
 *    _SECRET_ACCESS_KEY, optional _PUBLIC_BASE_URL) selects any
 *    S3-compatible object store: Cloudflare R2 (10 GB free, free egress)
 *    or Backblaze B2 (10 GB free). Uploads and playback go through
 *    presigned URLs, so media bytes never cross the web service.
 *  - AI_PARTNER_RECORDINGS_DIR selects a local directory (development
 *    only; container disks are ephemeral on Railway).
 *  - With neither set, recording endpoints answer 503 and the client
 *    keeps recording UI hidden.
 */
export function recordingsS3(): {
  bucket: string;
  endpoint?: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicBaseUrl?: string;
} | null {
  const bucket = process.env.AI_PARTNER_RECORDINGS_S3_BUCKET?.trim();
  const accessKeyId = process.env.AI_PARTNER_RECORDINGS_S3_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.AI_PARTNER_RECORDINGS_S3_SECRET_ACCESS_KEY?.trim();
  if (!bucket || !accessKeyId || !secretAccessKey) return null;
  return {
    bucket,
    endpoint: process.env.AI_PARTNER_RECORDINGS_S3_ENDPOINT?.trim() || undefined,
    region: process.env.AI_PARTNER_RECORDINGS_S3_REGION?.trim() || 'auto',
    accessKeyId,
    secretAccessKey,
    publicBaseUrl: process.env.AI_PARTNER_RECORDINGS_S3_PUBLIC_BASE_URL?.trim() || undefined,
  };
}

export function recordingsLocalDir(): string | null {
  return process.env.AI_PARTNER_RECORDINGS_DIR?.trim() || null;
}

/** Presigned upload/playback URL lifetime. */
export function recordingsUrlTtlSec(): number {
  const parsed = parseInt(process.env.AI_PARTNER_RECORDINGS_URL_TTL_SEC ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, 3600) : 900;
}

/** Hard cap on one uploaded recording (also enforced client-side). */
export function recordingsMaxBytes(): number {
  const parsed = parseInt(process.env.AI_PARTNER_RECORDINGS_MAX_BYTES ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 150 * 1024 * 1024;
}
