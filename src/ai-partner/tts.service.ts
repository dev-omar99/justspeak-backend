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
@Injectable()
export class TtsService {
  private readonly logger = new Logger('AiPartnerTts');

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
    onChunk: (chunk: Buffer) => void;
    signal?: AbortSignal;
  }): Promise<void> {
    const key = elevenLabsApiKey();
    if (!key) throw new Error('ELEVENLABS_API_KEY is not configured');

    const url =
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(params.voiceId)}/stream` +
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
      throw new Error(`ElevenLabs request failed (${res.status}): ${detail.slice(0, 200)}`);
    }

    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && value.length) params.onChunk(Buffer.from(value));
    }
  }
}
