import { Injectable, Logger } from '@nestjs/common';
import {
  elevenLabsApiKey,
  elevenLabsModelId,
  elevenLabsVoiceId,
} from './ai-partner.config';
import { Persona } from './content/personas';

/**
 * ElevenLabs text-to-speech. One HTTP streaming request per sentence:
 * each response is a complete MP3 for that sentence, so the browser can
 * decode and queue it while the next sentence is still generating.
 */
/**
 * ElevenLabs "premade" voices. The free plan may call these through the API,
 * but it rejects library voices with 402 paid_plan_required. They are the
 * automatic fallback when a configured voice is refused for that reason.
 */
const PREMADE_FALLBACK_VOICES: Record<string, string> = {
  ELEVENLABS_VOICE_SARA: 'EXAVITQu4vr4xnSDxMaL', // Sarah
  ELEVENLABS_VOICE_ADAMS: 'pNInz6obpgDQGcFmaJgB', // Adam
  ELEVENLABS_VOICE_RACHEL: '21m00Tcm4TlvDq8ikWAM', // Rachel
  ELEVENLABS_VOICE_SAM: 'TxGEqnHWrfWFTfGW9XjX', // Josh
};

/** Max simultaneous ElevenLabs requests across all sessions (free plan allows few). */
const MAX_CONCURRENT_REQUESTS = 2;
/** Retries when ElevenLabs answers 429 (too many concurrent requests). */
const MAX_RATE_LIMIT_RETRIES = 4;

@Injectable()
export class TtsService {
  private readonly logger = new Logger('AiPartnerTts');
  /** Voice ids the account is not allowed to use (402): skip straight to the fallback. */
  private readonly refusedVoices = new Set<string>();
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  /** Premade fallback voice for a persona, or null if none is known. */
  resolveFallbackVoiceId(persona: Persona): string | null {
    return PREMADE_FALLBACK_VOICES[persona.voiceEnvVar] ?? null;
  }

  private async acquireSlot(): Promise<void> {
    if (this.active < MAX_CONCURRENT_REQUESTS) {
      this.active++;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  private releaseSlot(): void {
    const next = this.waiters.shift();
    if (next) next();
    else this.active--;
  }

  resolveVoiceId(persona: Persona): string | null {
    return elevenLabsVoiceId(persona.voiceEnvVar);
  }

  /**
   * Synthesize one sentence. onChunk fires with MP3 bytes as they arrive;
   * resolves when the sentence audio is fully streamed.
   */
  async synthesizeSentence(params: {
    text: string;
    voiceId: string;
    fallbackVoiceId?: string | null;
    onChunk: (chunk: Buffer) => void;
    signal?: AbortSignal;
  }): Promise<void> {
    await this.acquireSlot();
    try {
      let voiceId = params.voiceId;
      if (this.refusedVoices.has(voiceId) && params.fallbackVoiceId) {
        voiceId = params.fallbackVoiceId;
      }
      try {
        await this.requestWithRetry(params, voiceId);
      } catch (err) {
        const refused = err instanceof TtsHttpError && err.status === 402;
        if (refused && params.fallbackVoiceId && voiceId !== params.fallbackVoiceId) {
          this.logger.warn(
            `Voice ${voiceId} needs a paid plan; using premade fallback ${params.fallbackVoiceId}`,
          );
          this.refusedVoices.add(voiceId);
          await this.requestWithRetry(params, params.fallbackVoiceId);
        } else {
          throw err;
        }
      }
    } finally {
      this.releaseSlot();
    }
  }

  private async requestWithRetry(
    params: { text: string; onChunk: (chunk: Buffer) => void; signal?: AbortSignal },
    voiceId: string,
  ): Promise<void> {
    for (let attempt = 0; ; attempt++) {
      try {
        await this.request(params, voiceId);
        return;
      } catch (err) {
        const limited = err instanceof TtsHttpError && err.status === 429;
        if (!limited || attempt >= MAX_RATE_LIMIT_RETRIES || params.signal?.aborted) throw err;
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
      }
    }
  }

  private async request(
    params: { text: string; onChunk: (chunk: Buffer) => void; signal?: AbortSignal },
    voiceIdArg: string,
  ): Promise<void> {
    const key = elevenLabsApiKey();
    if (!key) throw new Error('ELEVENLABS_API_KEY is not configured');

    const url =
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceIdArg)}/stream` +
      `?output_format=mp3_44100_128&optimize_streaming_latency=3`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'xi-api-key': key,
      },
      body: JSON.stringify({
        text: params.text,
        model_id: elevenLabsModelId(),
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75,
          style: 0.4,
          use_speaker_boost: true,
        },
      }),
      signal: params.signal,
    });

    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => '');
      throw new TtsHttpError(res.status, `ElevenLabs request failed (${res.status}): ${detail.slice(0, 200)}`);
    }

    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && value.length) params.onChunk(Buffer.from(value));
    }
  }
}

/** HTTP failure from ElevenLabs, carrying the status so callers can react. */
class TtsHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
