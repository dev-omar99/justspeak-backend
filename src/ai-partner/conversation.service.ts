import { Injectable, Logger } from '@nestjs/common';
import { ClaudeService, ChatTurn } from './claude.service';
import { DeepgramService, DeepgramStream } from './deepgram.service';
import { TtsService } from './tts.service';
import { AiPartnerService } from './ai-partner.service';
import {
  buildPersonaSystemPrompt,
  getPersona,
  Persona,
} from './content/personas';
import {
  ENGINE_RULES_PROMPT,
  HISTORY_TURNS_LIMIT,
  WRAP_UP_INSTRUCTION,
} from './content/engine-rules';
import { getInterviewField } from './content/interview-bank';
import { getLesson } from './content/course';
import { liveModel, maxSessionMinutes } from './ai-partner.config';

export interface LiveSessionEmit {
  (event: string, ...args: any[]): void;
}

const FILLER_PATTERN = /\b(um+|uh+|er+|erm|like|you know|basically|actually|literally)\b/gi;

interface Turn {
  role: 'user' | 'assistant';
  text: string;
  at: number;
}

/**
 * One LiveSession per connected client. Owns the Deepgram stream, the
 * Claude conversation loop, sentence-by-sentence ElevenLabs playback,
 * barge-in, session metrics and the wrap-up timer.
 */
export class LiveSession {
  private deepgram: DeepgramStream | null = null;
  private turns: Turn[] = [];
  private facts: string[] = [];
  private currentUserText = '';
  private replying = false;
  private replyAbort: AbortController | null = null;
  private replySeq = 0;
  private ended = false;

  // metrics
  private studentSpeechSec = 0;
  private studentWords = 0;
  private fillerCount = 0;
  private confidenceSum = 0;
  private confidenceSamples = 0;
  private currentUserSpeechStart = 0;
  private startedAt = Date.now();

  private wrapUpTimer: NodeJS.Timeout | null = null;
  private saveTimer: NodeJS.Timeout | null = null;
  private userTurnsSinceFacts = 0;

  constructor(
    private readonly opts: {
      sessionId: string;
      userId: string;
      userName: string;
      mode: string;
      persona: Persona;
      level: string;
      fieldId?: string | null;
      lessonId?: string | null;
      emit: LiveSessionEmit;
      deepgramService: DeepgramService;
      claude: ClaudeService;
      tts: TtsService;
      aiPartner: AiPartnerService;
      logger: Logger;
    },
  ) {}

  get sessionId(): string {
    return this.opts.sessionId;
  }

  async start(): Promise<void> {
    const voiceId = this.opts.tts.resolveVoiceId(this.opts.persona);
    if (!voiceId) {
      this.opts.emit('error', {
        code: 'VOICE_NOT_CONFIGURED',
        message: `Voice for persona ${this.opts.persona.id} is not configured (${this.opts.persona.voiceEnvVar}).`,
      });
      return;
    }

    this.deepgram = this.opts.deepgramService.openStream({
      onTranscript: (event) => this.handleTranscript(event),
      onSpeechStarted: () => this.handleBargeIn(),
      onError: (message) => this.opts.emit('error', { code: 'STT_ERROR', message }),
    });

    this.wrapUpTimer = setTimeout(
      () => void this.wrapUp(),
      maxSessionMinutes() * 60 * 1000,
    );
    this.saveTimer = setInterval(() => void this.persist(), 10000);

    this.opts.emit('session-state', { state: 'listening' });
    // The persona opens the conversation.
    await this.generateReply(null);
  }

  sendAudio(chunk: Buffer): void {
    this.deepgram?.sendAudio(chunk);
  }

  async stop(): Promise<void> {
    if (this.ended) return;
    this.ended = true;
    if (this.wrapUpTimer) clearTimeout(this.wrapUpTimer);
    if (this.saveTimer) clearInterval(this.saveTimer);
    this.replyAbort?.abort();
    this.deepgram?.finish();
    await this.persist();
    const durationSec = Math.round((Date.now() - this.startedAt) / 1000);
    await this.opts.aiPartner.endSession(this.opts.sessionId, this.opts.userId, durationSec);
  }

  // ---------------------------------------------------------------- STT

  private handleTranscript(event: {
    isFinal: boolean;
    speechFinal: boolean;
    text: string;
    confidence: number;
  }): void {
    if (this.ended) return;
    if (!event.isFinal) {
      this.opts.emit('transcript', { role: 'user', text: event.text, isFinal: false });
      return;
    }

    if (event.text) {
      if (this.currentUserSpeechStart === 0) this.currentUserSpeechStart = Date.now();
      this.currentUserText = this.currentUserText
        ? `${this.currentUserText} ${event.text}`
        : event.text;
      this.opts.emit('transcript', { role: 'user', text: event.text, isFinal: true });
    }

    if (event.speechFinal) {
      // Metrics for this utterance.
      const now = Date.now();
      if (this.currentUserSpeechStart > 0) {
        this.studentSpeechSec += (now - this.currentUserSpeechStart) / 1000;
        this.currentUserSpeechStart = 0;
      }
      if (event.confidence > 0) {
        this.confidenceSum += event.confidence;
        this.confidenceSamples += 1;
      }

      const said = this.currentUserText.trim();
      this.currentUserText = '';
      if (!said) return;

      const words = said.split(/\s+/).filter(Boolean);
      this.studentWords += words.length;
      const fillers = said.match(FILLER_PATTERN);
      if (fillers) this.fillerCount += fillers.length;

      this.turns.push({ role: 'user', text: said, at: now });
      void this.generateReply(said);
    }
  }

  // -------------------------------------------------------- conversation

  private buildSystemPrompt(): string {
    const base = buildPersonaSystemPrompt(this.opts.persona, this.opts.userName, this.opts.level);
    let context = '';

    if (this.opts.mode === 'interview' && this.opts.fieldId) {
      const field = getInterviewField(this.opts.fieldId);
      if (field) {
        const questions = field.questions
          .map((q, i) => `${i + 1}. ${q.q} (probe if the answer is short: ${q.probe})`)
          .join('\n');
        context += `\n\nYou are interviewing {NAME} for a ${field.title} position. Ask the questions below roughly in order, one at a time, and use the probe when an answer is short or vague. Do not read them robotically; run a real interview.\n${questions}`.split('{NAME}').join(this.opts.userName);
      }
    }

    if (this.opts.mode === 'lesson' && this.opts.lessonId) {
      const lesson = getLesson(this.opts.lessonId);
      if (lesson) {
        context += `\n\nYou are running lesson "${lesson.title}". Goal: ${lesson.goal}. Follow the lesson skeleton: warm-up (${lesson.warmup}), target phrases (${lesson.targetLanguage.join('; ')}), a guided dialogue, a roleplay (${lesson.roleplay}), free practice, then a 3-question spoken quiz. One step at a time, at the student's pace.`;
      }
    }

    if (this.facts.length) {
      context += `\n\nThings the student has mentioned before: ${this.facts.join('; ')}.`;
    }

    return `${base}\n\n${ENGINE_RULES_PROMPT}${context}`;
  }

  private async generateReply(userSaid: string | null): Promise<void> {
    if (this.ended || this.replying) return;
    this.replying = true;
    const replyId = ++this.replySeq;
    this.replyAbort = new AbortController();
    this.opts.emit('session-state', { state: 'thinking' });

    try {
      const recentTurns: ChatTurn[] = this.turns
        .slice(-HISTORY_TURNS_LIMIT)
        .map((turn) => ({ role: turn.role, content: turn.text }));

      const voiceId = this.opts.tts.resolveVoiceId(this.opts.persona);
      if (!voiceId) throw new Error('Voice not configured');

      let assistantText = '';
      let sentenceIndex = 0;

      assistantText = await this.opts.claude.streamReply({
        model: liveModel(),
        system: this.buildSystemPrompt(),
        turns:
          recentTurns.length > 0
            ? recentTurns
            : [{ role: 'user', content: 'The session just started. Greet the student warmly and open the conversation.' }],
        maxTokens: 220,
        signal: this.replyAbort.signal,
        onSentence: (sentence) => {
          const myReply = replyId;
          const mySentence = sentenceIndex++;
          this.opts.emit('reply-text', { replyId: myReply, sentence: mySentence, text: sentence });
          void this.opts.tts
            .synthesizeSentence({
              text: sentence,
              voiceId,
              signal: this.replyAbort?.signal,
              onChunk: (chunk) => {
                if (this.replySeq === myReply && !this.ended) {
                  this.opts.emit('reply-audio', { replyId: myReply, sentence: mySentence }, chunk);
                }
              },
            })
            .then(() => {
              if (this.replySeq === myReply && !this.ended) {
                this.opts.emit('reply-sentence-end', { replyId: myReply, sentence: mySentence });
              }
            })
            .catch((err: Error) => {
              if (!this.ended && err.name !== 'AbortError') {
                this.opts.logger.warn(`TTS failed: ${err.message}`);
                this.opts.emit('error', { code: 'TTS_ERROR', message: 'Voice generation failed for one sentence.' });
              }
            });
        },
      });

      if (assistantText && !this.ended) {
        this.turns.push({ role: 'assistant', text: assistantText, at: Date.now() });
        this.opts.emit('reply-end', { replyId });
        this.opts.emit('session-state', { state: 'listening' });
        this.userTurnsSinceFacts += userSaid ? 1 : 0;
        if (this.userTurnsSinceFacts >= 4) {
          this.userTurnsSinceFacts = 0;
          void this.refreshFacts();
        }
        void this.persist();
        this.emitMetrics();
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        // Barge-in: a newer reply is on its way.
        this.opts.emit('session-state', { state: 'listening' });
      } else {
        this.opts.logger.warn(`Reply generation failed: ${(err as Error).message}`);
        this.opts.emit('error', { code: 'LLM_ERROR', message: 'The conversation hit a problem. Try again.' });
        this.opts.emit('session-state', { state: 'listening' });
      }
    } finally {
      this.replying = false;
    }
  }

  private handleBargeIn(): void {
    if (!this.replying) return;
    this.replySeq += 1; // invalidate in-flight TTS chunks
    this.replyAbort?.abort();
    this.replying = false;
    this.opts.emit('interrupt');
  }

  // ------------------------------------------------------------ metrics

  private computeMetrics() {
    const elapsedSec = Math.max(1, (Date.now() - this.startedAt) / 1000);
    const speechMinutes = this.studentSpeechSec / 60;
    return {
      student_speech_sec: Math.round(this.studentSpeechSec),
      words_per_minute: speechMinutes > 0 ? Math.round(this.studentWords / speechMinutes) : 0,
      fillers_per_minute: speechMinutes > 0 ? Math.round((this.fillerCount / speechMinutes) * 10) / 10 : 0,
      student_talk_ratio: Math.round((this.studentSpeechSec / elapsedSec) * 100) / 100,
      avg_stt_confidence: this.confidenceSamples
        ? Math.round((this.confidenceSum / this.confidenceSamples) * 100) / 100
        : 0,
      filler_count: this.fillerCount,
      turns: this.turns.filter((t) => t.role === 'user').length,
    };
  }

  private emitMetrics(): void {
    this.opts.emit('metrics', this.computeMetrics());
  }

  private async refreshFacts(): Promise<void> {
    const userTurns = this.turns.filter((t) => t.role === 'user').slice(-6);
    if (!userTurns.length) return;
    try {
      const raw = await this.opts.claude.complete({
        model: liveModel(),
        system:
          'Extract personal facts the student mentioned (people, places, plans, opinions, job, studies). Respond with a JSON array of short strings, or an empty array. JSON only.',
        prompt: userTurns.map((t) => `- ${t.text}`).join('\n'),
        maxTokens: 200,
      });
      const match = raw.match(/\[[\s\S]*\]/);
      if (match) {
        const facts = JSON.parse(match[0]);
        if (Array.isArray(facts)) {
          for (const fact of facts) {
            if (typeof fact === 'string' && fact.trim() && this.facts.length < 30) {
              this.facts.push(fact.trim());
            }
          }
        }
      }
    } catch {
      // facts are a nice-to-have; never break the session for them
    }
  }

  private async wrapUp(): Promise<void> {
    if (this.ended) return;
    this.turns.push({ role: 'user', text: `[system] ${WRAP_UP_INSTRUCTION}`, at: Date.now() });
    await this.generateReply(WRAP_UP_INSTRUCTION);
    setTimeout(() => this.opts.emit('session-state', { state: 'time-up' }), 15000);
  }

  private async persist(): Promise<void> {
    try {
      await this.opts.aiPartner.saveLiveState({
        sessionId: this.opts.sessionId,
        transcript: this.turns as unknown as unknown[],
        facts: this.facts,
        metrics: this.computeMetrics(),
      });
    } catch (err) {
      this.opts.logger.warn(`Persist failed for ${this.opts.sessionId}: ${(err as Error).message}`);
    }
  }
}

@Injectable()
export class ConversationService {
  private readonly logger = new Logger('AiPartnerConversation');
  private sessions = new Map<string, LiveSession>();

  constructor(
    private readonly deepgramService: DeepgramService,
    private readonly claude: ClaudeService,
    private readonly tts: TtsService,
    private readonly aiPartner: AiPartnerService,
  ) {}

  async createLiveSession(params: {
    sessionId: string;
    userId: string;
    userName: string;
    mode: string;
    personaId: string;
    level: string;
    fieldId?: string | null;
    lessonId?: string | null;
    emit: LiveSessionEmit;
  }): Promise<LiveSession> {
    const persona = getPersona(params.personaId);
    const live = new LiveSession({
      sessionId: params.sessionId,
      userId: params.userId,
      userName: params.userName,
      mode: params.mode,
      persona,
      level: params.level,
      fieldId: params.fieldId,
      lessonId: params.lessonId,
      emit: params.emit,
      deepgramService: this.deepgramService,
      claude: this.claude,
      tts: this.tts,
      aiPartner: this.aiPartner,
      logger: this.logger,
    });
    this.sessions.set(params.sessionId, live);
    await live.start();
    return live;
  }

  get(sessionId: string): LiveSession | undefined {
    return this.sessions.get(sessionId);
  }

  async destroy(sessionId: string): Promise<void> {
    const live = this.sessions.get(sessionId);
    if (live) {
      await live.stop();
      this.sessions.delete(sessionId);
    }
  }
}
