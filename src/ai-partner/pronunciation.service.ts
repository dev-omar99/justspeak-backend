import { Injectable, Logger } from '@nestjs/common';
import {
  azureSpeechKey,
  azureSpeechRegion,
  pronunciationMaxConcurrent,
} from './ai-partner.config';

export interface PhonemeScore {
  phoneme: string;
  accuracy: number;
}

export interface WordAssessment {
  word: string;
  accuracy: number;
  errorType: string | null;
  phonemes: PhonemeScore[];
}

export interface UtteranceAssessment {
  referenceText: string;
  accuracy: number;
  fluency: number;
  completeness: number;
  prosody: number | null;
  pronScore: number;
  durationSec: number;
  words: WordAssessment[];
}

export interface SessionPronunciationSummary {
  engine: 'azure-pronunciation-assessment';
  utterances: number;
  wordsAssessed: number;
  accuracy: number;
  fluency: number;
  completeness: number;
  prosody: number | null;
  pronScore: number;
  worstWords: {
    word: string;
    accuracy: number;
    errorType: string | null;
    weakPhonemes: string[];
  }[];
}

const SAMPLE_RATE = 16000;
const BYTES_PER_SECOND = SAMPLE_RATE * 2; // linear16 mono
const MAX_UTTERANCE_SECONDS = 55; // short-audio REST cap is 60s
const MIN_UTTERANCE_SECONDS = 0.4;
const REQUEST_TIMEOUT_MS = 20000;

/** Build a 44-byte RIFF/WAV header for linear16 mono 16 kHz PCM. */
export function pcmToWav(pcm: Buffer): Buffer {
  const dataSize = pcm.length;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(BYTES_PER_SECOND, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, pcm]);
}

/**
 * Azure Pronunciation Assessment via the short-audio REST endpoint.
 *
 * Additive and optional: with AZURE_SPEECH_PRONUNCIATION_ENABLED unset this
 * service is never called. Failures return null so a provider outage can
 * never break a live session or a report.
 *
 * Scalability: an in-process semaphore caps concurrent Azure calls
 * (AZURE_SPEECH_MAX_CONCURRENT, default 4); each request has a 20s timeout
 * and one retry on 429/5xx. Cost is per audio hour (standard STT rate),
 * so spend scales with assessed seconds, not requests.
 */
@Injectable()
export class PronunciationService {
  private readonly logger = new Logger('AiPartnerPronunciation');
  private inFlight = 0;
  private waiters: (() => void)[] = [];

  /** Assess one user utterance (linear16 16 kHz mono PCM) against its transcript. */
  async assessUtterance(
    pcm: Buffer,
    referenceText: string,
  ): Promise<UtteranceAssessment | null> {
    const key = azureSpeechKey();
    if (!key) return null;
    const durationSec = pcm.length / BYTES_PER_SECOND;
    if (durationSec < MIN_UTTERANCE_SECONDS) return null;
    const trimmed =
      durationSec > MAX_UTTERANCE_SECONDS
        ? pcm.subarray(0, MAX_UTTERANCE_SECONDS * BYTES_PER_SECOND)
        : pcm;
    const text = referenceText.trim();
    if (!text) return null;

    await this.acquire();
    try {
      return await this.assessWithRetry(trimmed, text, durationSec);
    } catch (err) {
      this.logger.warn(
        `Pronunciation assessment failed: ${(err as Error).message}`,
      );
      return null;
    } finally {
      this.release();
    }
  }

  private async assessWithRetry(
    pcm: Buffer,
    referenceText: string,
    durationSec: number,
  ): Promise<UtteranceAssessment | null> {
    let lastStatus = 0;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      const result = await this.callAzure(pcm, referenceText, durationSec);
      if (result.ok) return result.assessment;
      lastStatus = result.status;
      if (result.status < 500 && result.status !== 429) break; // 4xx (not 429): no retry
    }
    this.logger.warn(`Azure pronunciation assessment gave up (status ${lastStatus})`);
    return null;
  }

  private async callAzure(
    pcm: Buffer,
    referenceText: string,
    durationSec: number,
  ): Promise<
    | { ok: true; assessment: UtteranceAssessment | null }
    | { ok: false; status: number }
  > {
    const params = {
      ReferenceText: referenceText,
      GradingSystem: 'HundredMark',
      Granularity: 'Phoneme',
      Dimension: 'Comprehensive',
      EnableMiscue: true,
    };
    const url =
      `https://${azureSpeechRegion()}.stt.speech.microsoft.com` +
      `/speech/recognition/conversation/cognitiveservices/v1?language=en-US&format=detailed`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': azureSpeechKey() as string,
          'Content-Type': 'audio/wav; codecs=audio/pcm; samplerate=16000',
          'Pronunciation-Assessment': Buffer.from(JSON.stringify(params)).toString('base64'),
          Accept: 'application/json',
        },
        body: new Uint8Array(pcmToWav(pcm)),
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        this.logger.warn(
          `Azure PA HTTP ${response.status}: ${body.slice(0, 200)}`,
        );
        return { ok: false, status: response.status };
      }
      const data = (await response.json()) as any;
      if (data?.RecognitionStatus !== 'Success') {
        this.logger.warn(`Azure PA recognition status: ${data?.RecognitionStatus}`);
        return { ok: true, assessment: null };
      }
      const best = data?.NBest?.[0];
      if (!best) return { ok: true, assessment: null };
      const words: WordAssessment[] = Array.isArray(best.Words)
        ? best.Words.map((w: any) => ({
            word: String(w.Word ?? ''),
            accuracy: Number(w.PronunciationAssessment?.AccuracyScore) || 0,
            errorType:
              w.PronunciationAssessment?.ErrorType &&
              w.PronunciationAssessment.ErrorType !== 'None'
                ? String(w.PronunciationAssessment.ErrorType)
                : null,
            phonemes: Array.isArray(w.Phonemes)
              ? w.Phonemes.map((p: any) => ({
                  phoneme: String(p.Phoneme ?? ''),
                  accuracy: Number(p.PronunciationAssessment?.AccuracyScore) || 0,
                }))
              : [],
          }))
        : [];
      return {
        ok: true,
        assessment: {
          referenceText,
          accuracy: Number(best.AccuracyScore) || 0,
          fluency: Number(best.FluencyScore) || 0,
          completeness: Number(best.CompletenessScore) || 0,
          prosody:
            best.ProsodyScore !== undefined && best.ProsodyScore !== null
              ? Number(best.ProsodyScore)
              : null,
          pronScore: Number(best.PronScore) || 0,
          durationSec,
          words,
        },
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  // In-process concurrency cap so a burst of utterance assessments cannot
  // stampede the provider quota when many sessions end together.
  private async acquire(): Promise<void> {
    if (this.inFlight < pronunciationMaxConcurrent()) {
      this.inFlight += 1;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.inFlight += 1;
  }

  private release(): void {
    this.inFlight -= 1;
    const next = this.waiters.shift();
    if (next) next();
  }
}

/** Aggregate per-utterance results into one session summary (duration-weighted). */
export function summarizePronunciation(
  results: UtteranceAssessment[],
): SessionPronunciationSummary | null {
  if (!results.length) return null;
  let totalDur = 0;
  let acc = 0;
  let flu = 0;
  let comp = 0;
  let prosodySum = 0;
  let prosodyDur = 0;
  let pron = 0;
  let wordsAssessed = 0;
  const worstByWord = new Map<
    string,
    { word: string; accuracy: number; errorType: string | null; weakPhonemes: Set<string> }
  >();

  for (const r of results) {
    const w = Math.max(r.durationSec, 0.1);
    totalDur += w;
    acc += r.accuracy * w;
    flu += r.fluency * w;
    comp += r.completeness * w;
    pron += r.pronScore * w;
    if (r.prosody !== null) {
      prosodySum += r.prosody * w;
      prosodyDur += w;
    }
    wordsAssessed += r.words.length;
    for (const word of r.words) {
      if (word.accuracy >= 85) continue;
      const key = word.word.toLowerCase();
      const weak = word.phonemes.filter((p) => p.accuracy < 85).map((p) => p.phoneme);
      const existing = worstByWord.get(key);
      if (!existing) {
        worstByWord.set(key, {
          word: word.word,
          accuracy: word.accuracy,
          errorType: word.errorType,
          weakPhonemes: new Set(weak),
        });
      } else {
        existing.accuracy = Math.min(existing.accuracy, word.accuracy);
        if (!existing.errorType && word.errorType) existing.errorType = word.errorType;
        for (const p of weak) existing.weakPhonemes.add(p);
      }
    }
  }

  const worstWords = [...worstByWord.values()]
    .sort((a, b) => a.accuracy - b.accuracy)
    .slice(0, 8)
    .map((w) => ({
      word: w.word,
      accuracy: Math.round(w.accuracy),
      errorType: w.errorType,
      weakPhonemes: [...w.weakPhonemes].slice(0, 4),
    }));

  const round = (n: number) => Math.round(n * 10) / 10;
  return {
    engine: 'azure-pronunciation-assessment',
    utterances: results.length,
    wordsAssessed,
    accuracy: round(acc / totalDur),
    fluency: round(flu / totalDur),
    completeness: round(comp / totalDur),
    prosody: prosodyDur > 0 ? round(prosodySum / prosodyDur) : null,
    pronScore: round(pron / totalDur),
    worstWords,
  };
}
