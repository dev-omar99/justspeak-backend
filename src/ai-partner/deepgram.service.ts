import { Injectable, Logger } from '@nestjs/common';
import WebSocket from 'ws';
import { deepgramApiKey } from './ai-partner.config';

export interface TranscriptEvent {
  isFinal: boolean;
  speechFinal: boolean;
  text: string;
  /** average word confidence on final results, 0..1 */
  confidence: number;
  words: { word: string; confidence: number }[];
  start: number;
  end: number;
}

export interface DeepgramStreamHandlers {
  onTranscript: (event: TranscriptEvent) => void;
  onSpeechStarted?: () => void;
  onError: (message: string) => void;
  onClose?: () => void;
}

/**
 * One Deepgram streaming STT connection per AI Partner session.
 * Browser sends raw linear16 PCM at 16 kHz; Deepgram streams interim and
 * final transcripts back over the same socket.
 */
@Injectable()
export class DeepgramService {
  private readonly logger = new Logger('AiPartnerDeepgram');

  openStream(handlers: DeepgramStreamHandlers): DeepgramStream {
    return new DeepgramStream(handlers, this.logger);
  }
}


export interface PrerecordedResult {
  transcript: string;
  durationSec: number;
  words: { word: string; start: number; end: number; confidence: number }[];
}

@Injectable()
export class DeepgramPrerecordedService {
  private readonly logger = new Logger('AiPartnerDeepgramPrerecorded');

  /** Transcribe an uploaded audio file with Deepgram's prerecorded API. */
  async transcribe(buffer: Buffer, mimetype: string): Promise<PrerecordedResult> {
    const key = deepgramApiKey();
    if (!key) throw new Error('DEEPGRAM_API_KEY is not configured');
    const params = new URLSearchParams({
      model: 'nova-3',
      language: 'en',
      smart_format: 'true',
      utterances: 'true',
    });
    const response = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
      method: 'POST',
      headers: {
        Authorization: `Token ${key}`,
        'Content-Type': mimetype || 'application/octet-stream',
      },
      body: new Uint8Array(buffer),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      this.logger.warn(`Prerecorded transcription failed: ${response.status} ${text.slice(0, 200)}`);
      throw new Error(`Transcription failed (${response.status})`);
    }
    const data = (await response.json()) as any;
    const channel = data?.results?.channels?.[0];
    const alt = channel?.alternatives?.[0];
    return {
      transcript: (alt?.transcript as string) ?? '',
      durationSec: Number(data?.metadata?.duration) || 0,
      words: Array.isArray(alt?.words)
        ? alt.words.map((w: any) => ({
            word: String(w.punctuated_word ?? w.word ?? ''),
            start: Number(w.start) || 0,
            end: Number(w.end) || 0,
            confidence: Number(w.confidence) || 0,
          }))
        : [],
    };
  }
}

export class DeepgramStream {
  private ws: WebSocket | null = null;
  private opened = false;
  private closed = false;
  private queue: Buffer[] = [];

  constructor(
    private readonly handlers: DeepgramStreamHandlers,
    private readonly logger: Logger,
  ) {
    const key = deepgramApiKey();
    if (!key) {
      // Defer so callers can subscribe before the error lands.
      setImmediate(() => this.handlers.onError('DEEPGRAM_API_KEY is not configured'));
      return;
    }

    const params = new URLSearchParams({
      model: 'nova-3',
      language: 'en',
      smart_format: 'true',
      interim_results: 'true',
      endpointing: '300',
      vad_events: 'true',
      encoding: 'linear16',
      sample_rate: '16000',
      channels: '1',
    });

    this.ws = new WebSocket(`wss://api.deepgram.com/v1/listen?${params.toString()}`, {
      headers: { Authorization: `Token ${key}` },
    });

    this.ws.on('open', () => {
      this.opened = true;
      for (const chunk of this.queue) this.ws?.send(chunk);
      this.queue = [];
    });

    this.ws.on('message', (data: WebSocket.RawData) => {
      this.handleMessage(data);
    });

    this.ws.on('error', (err) => {
      this.logger.warn(`Deepgram socket error: ${err.message}`);
      this.handlers.onError('Speech recognition connection failed');
    });

    this.ws.on('close', () => {
      this.closed = true;
      this.handlers.onClose?.();
    });
  }

  sendAudio(chunk: Buffer): void {
    if (this.closed) return;
    if (!this.opened) {
      // Buffer briefly while the socket connects; drop if it never opens.
      if (this.queue.length < 200) this.queue.push(chunk);
      return;
    }
    this.ws?.send(chunk);
  }

  finish(): void {
    if (this.closed) return;
    try {
      this.ws?.send(JSON.stringify({ type: 'CloseStream' }));
    } catch {
      // socket already gone
    }
    this.closed = true;
    this.ws?.close();
    this.ws = null;
  }

  private handleMessage(data: WebSocket.RawData): void {
    let msg: any;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }

    if (msg?.type === 'SpeechStarted') {
      this.handlers.onSpeechStarted?.();
      return;
    }
    if (msg?.type !== 'Results') return;

    const alt = msg?.channel?.alternatives?.[0];
    const text: string = typeof alt?.transcript === 'string' ? alt.transcript.trim() : '';
    if (!text && !msg.speech_final) return;

    const words = Array.isArray(alt?.words)
      ? alt.words.map((w: any) => ({
          word: String(w?.word ?? ''),
          confidence: typeof w?.confidence === 'number' ? w.confidence : 0,
        }))
      : [];
    const confidence =
      typeof alt?.confidence === 'number'
        ? alt.confidence
        : words.length
          ? words.reduce((sum, w) => sum + w.confidence, 0) / words.length
          : 0;

    this.handlers.onTranscript({
      isFinal: Boolean(msg.is_final),
      speechFinal: Boolean(msg.speech_final),
      text,
      confidence,
      words,
      start: typeof msg.start === 'number' ? msg.start : 0,
      end: typeof msg.start === 'number' && typeof msg.duration === 'number' ? msg.start + msg.duration : 0,
    });
  }
}
