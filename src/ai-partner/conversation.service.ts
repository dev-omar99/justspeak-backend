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
import { getRoleplay } from './content/roleplays';
import { getLesson } from './content/course';
import {
  azureSpeechKey,
  commitFallbackMs,
  liveModel,
  maxConcurrentLiveSessions,
  maxSessionMinutes,
  pronunciationEnabled,
  reconnectGraceMs,
  rephraseModel,
} from './ai-partner.config';
import {
  PronunciationService,
  UtteranceAssessment,
  summarizePronunciation,
} from './pronunciation.service';

export interface LiveSessionEmit {
  (event: string, ...args: any[]): void;
}

const FILLER_PATTERN = /\b(um+|uh+|er+|erm|like|you know|basically|actually|literally)\b/gi;

interface Turn {
  role: 'user' | 'assistant';
  text: string;
  at: number;
  /** Live "say it better" rewrite, filled in asynchronously after the turn. */
  rephrase?: string;
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
  private startedAt = Date.now();

  // Pause: while paused the coach is silent, audio is ignored and the session-length cap clock is
  // stopped. pausedTotalMs is the time already spent paused, so durations and metrics count only
  // active time. A pause that nobody ends is closed after maxPauseMs through onOrphaned.
  private paused = false;
  private pausedAt = 0;
  private pausedTotalMs = 0;
  private wrapUpDeadline = 0;
  private wrapUpRemainingMs = 0;
  private pauseLimitTimer: NodeJS.Timeout | null = null;

  // Optional Azure phoneme-level pronunciation assessment. The mic PCM is
  // buffered per utterance (55s cap) and assessed against its transcript.
  private readonly pronunciationActive =
    pronunciationEnabled() && !!azureSpeechKey();
  private pronunciationChunks: Buffer[] = [];
  private pronunciationBytes = 0;
  private assessments: UtteranceAssessment[] = [];
  private pendingAssessments = new Set<Promise<void>>();

  // Turn-commit fallback: Deepgram sometimes never sends speech_final
  // (mic noise keeps the endpoint open), so commit shortly after the last final.
  private commitTimer: NodeJS.Timeout | null = null;

  // Emission target is mutable so a reconnected socket can take over the
  // session (see detach/reattach); while detached, events go to a no-op
  // sink instead of a dead socket.
  private emitFn: LiveSessionEmit = () => undefined;
  private detachTimer: NodeJS.Timeout | null = null;

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
      roleplayId?: string | null;
      topicSeed?: string;
      emit: LiveSessionEmit;
      onOrphaned: (sessionId: string) => void;
      deepgramService: DeepgramService;
      claude: ClaudeService;
      tts: TtsService;
      aiPartner: AiPartnerService;
      pronunciation: PronunciationService;
      logger: Logger;
    },
  ) {}

  get sessionId(): string {
    return this.opts.sessionId;
  }

  get isEnded(): boolean {
    return this.ended;
  }

  /**
   * The owning socket dropped. Keep the session (Deepgram, timers, model
   * state) fully alive for reconnectGraceMs() so the client can re-attach;
   * events emitted meanwhile are discarded rather than sent to a dead
   * socket. When the grace window lapses without a re-attach, the session
   * is stopped and ended through the onOrphaned callback.
   */
  detach(): void {
    if (this.ended || this.detachTimer) return;
    this.emitFn = () => undefined;
    this.opts.logger.log(
      `Socket detached from live session ${this.sessionId}; holding for reconnect up to ${reconnectGraceMs()}ms`,
    );
    this.detachTimer = setTimeout(() => {
      this.detachTimer = null;
      if (!this.ended) {
        this.opts.logger.warn(
          `Reconnect grace expired for live session ${this.sessionId}; ending it`,
        );
        void this.opts.onOrphaned(this.sessionId);
      }
    }, reconnectGraceMs());
  }

  /**
   * A reconnected socket takes over this live session: swap the emission
   * target, cancel the orphan timer, and push a state snapshot so the
   * client's UI resumes in the right mode. Returns false when the session
   * already ended (client should start a fresh one).
   */
  reattach(emit: LiveSessionEmit): boolean {
    if (this.ended) return false;
    if (this.detachTimer) {
      clearTimeout(this.detachTimer);
      this.detachTimer = null;
    }
    this.emitFn = emit;
    this.opts.logger.log(`Socket reattached to live session ${this.sessionId}`);
    this.emitFn('session-resumed', {
      sessionId: this.sessionId,
      state: this.replying ? 'thinking' : 'listening',
    });
    return true;
  }

  async start(): Promise<void> {
    this.emitFn = this.opts.emit;
    const voiceId = this.opts.tts.resolveVoiceId(this.opts.persona);
    if (!voiceId) {
      this.emitFn('error', {
        code: 'VOICE_NOT_CONFIGURED',
        message: `Voice for persona ${this.opts.persona.id} is not configured (${this.opts.persona.voiceEnvVar}).`,
      });
      return;
    }

    this.openDeepgram();

    this.wrapUpDeadline = Date.now() + maxSessionMinutes() * 60 * 1000;
    this.wrapUpTimer = setTimeout(
      () => void this.wrapUp(),
      maxSessionMinutes() * 60 * 1000,
    );
    this.saveTimer = setInterval(() => void this.persist(), 10000);

    this.emitFn('session-state', { state: 'listening' });
    // The persona opens the conversation.
    await this.generateReply(null);
  }

  private deepgramReconnects = 0;

  private openDeepgram(): void {
    this.deepgram = this.opts.deepgramService.openStream({
      onTranscript: (event) => this.handleTranscript(event),
      // Deepgram VAD says the utterance ended: commit right away instead of
      // waiting for the fallback timer (endpointing covers the same case,
      // this is the belt-and-braces signal for hesitant speakers).
      onUtteranceEnd: () => {
        if (!this.ended && this.currentUserText.trim()) {
          this.commitTurn('utterance-end', 0);
        }
      },
      // SpeechStarted alone does not barge in: TTS playback echoing into the
      // mic (laptop speakers) trips the VAD and would abort every reply.
      // Barge-in happens on real interim transcript text instead (see below).
      onError: (message) => this.emitFn('error', { code: 'STT_ERROR', message }),
      // If the STT socket dies mid-session (network blip, provider-side
      // close), reopen it so the coach never goes permanently deaf. Capped
      // so a hard-down provider does not spin forever.
      onClose: () => {
        if (this.ended) return;
        // Paused: the idle stream closing is expected. Drop it; resume() opens a fresh one.
        if (this.paused) {
          this.deepgram = null;
          return;
        }
        if (this.deepgramReconnects >= 10) {
          this.emitFn('error', {
            code: 'STT_ERROR',
            message: 'Speech recognition dropped and could not recover. Please restart the session.',
          });
          return;
        }
        this.deepgramReconnects += 1;
        this.opts.logger.warn(
          `Deepgram stream closed mid-session ${this.sessionId}; reopening (${this.deepgramReconnects})`,
        );
        this.openDeepgram();
      },
    });
  }

  sendAudio(chunk: Buffer): void {
    if (this.paused) return;
    this.deepgram?.sendAudio(chunk);
    if (this.pronunciationActive) {
      // Cap the buffered utterance at 55s of PCM (Azure short-audio limit).
      if (this.pronunciationBytes < 55 * 32000) {
        this.pronunciationChunks.push(chunk);
        this.pronunciationBytes += chunk.length;
      }
    }
  }

  private assessPronunciation(pcm: Buffer, text: string): void {
    if (!pcm.length || !text.trim()) return;
    const task = this.opts.pronunciation
      .assessUtterance(pcm, text)
      .then((result) => {
        if (result) this.assessments.push(result);
      })
      .catch(() => undefined)
      .finally(() => {
        this.pendingAssessments.delete(task);
      });
    this.pendingAssessments.add(task);
  }

  async stop(): Promise<void> {
    if (this.ended) return;
    this.ended = true;
    if (this.wrapUpTimer) clearTimeout(this.wrapUpTimer);
    if (this.detachTimer) clearTimeout(this.detachTimer);
    if (this.saveTimer) clearInterval(this.saveTimer);
    if (this.commitTimer) clearTimeout(this.commitTimer);
    if (this.pauseLimitTimer) clearTimeout(this.pauseLimitTimer);
    this.replyAbort?.abort();
    this.deepgram?.finish();
    // Let in-flight pronunciation assessments land before the final save.
    await Promise.allSettled([...this.pendingAssessments]);
    await this.persist();
    const durationSec = Math.round(this.activeMs() / 1000);
    await this.opts.aiPartner.endSession(this.opts.sessionId, this.opts.userId, durationSec);
  }

  // ---------------------------------------------------------------- STT

  /** Milliseconds of active (not paused) time since the session started. */
  private activeMs(): number {
    const now = Date.now();
    return now - this.startedAt - this.pausedTotalMs - (this.paused ? now - this.pausedAt : 0);
  }

  get isPaused(): boolean {
    return this.paused;
  }

  /**
   * Pause the call: silence the coach (any reply in flight is cancelled), stop listening, freeze the
   * session-length cap and close the idle speech stream. Returns false when the session is ended or
   * already paused. maxPauseMs is the longest a pause may last before the session is closed.
   */
  pause(maxPauseMs = 10 * 60 * 1000): boolean {
    if (this.ended || this.paused) return false;
    this.paused = true;
    this.pausedAt = Date.now();
    // Stop the cap clock, remember what is left.
    this.wrapUpRemainingMs = Math.max(0, this.wrapUpDeadline - this.pausedAt);
    if (this.wrapUpTimer) clearTimeout(this.wrapUpTimer);
    this.wrapUpTimer = null;
    if (this.commitTimer) clearTimeout(this.commitTimer);
    this.commitTimer = null;
    this.currentUserText = '';
    // Cancel the coach's reply: invalidates in-flight TTS chunks, same as a barge-in.
    this.replySeq += 1;
    this.replyAbort?.abort();
    this.replying = false;
    this.emitFn('interrupt');
    this.deepgram?.finish();
    this.deepgram = null;
    this.pauseLimitTimer = setTimeout(() => {
      this.pauseLimitTimer = null;
      if (!this.ended && this.paused) {
        this.opts.logger.warn(`Pause limit reached for live session ${this.sessionId}; ending it`);
        void this.opts.onOrphaned(this.sessionId);
      }
    }, maxPauseMs);
    this.emitFn('session-state', { state: 'paused' });
    return true;
  }

  /** Resume after a pause: reopen listening and restart the cap clock with the time that was left. */
  resume(): boolean {
    if (this.ended || !this.paused) return false;
    const now = Date.now();
    this.pausedTotalMs += now - this.pausedAt;
    this.paused = false;
    if (this.pauseLimitTimer) clearTimeout(this.pauseLimitTimer);
    this.pauseLimitTimer = null;
    this.wrapUpDeadline = now + this.wrapUpRemainingMs;
    this.wrapUpTimer = setTimeout(() => void this.wrapUp(), this.wrapUpRemainingMs);
    if (!this.deepgram) {
      this.deepgramReconnects = 0;
      this.openDeepgram();
    }
    this.emitFn('session-state', { state: 'listening' });
    return true;
  }

  private handleTranscript(event: {
    isFinal: boolean;
    speechFinal: boolean;
    text: string;
    confidence: number;
    start?: number;
    end?: number;
  }): void {
    if (this.paused) return; // late transcripts that arrive after Pause are ignored
    if (this.ended) return;
    if (!event.isFinal) {
      this.emitFn('transcript', { role: 'user', text: event.text, isFinal: false });
      // Barge in only on actual transcribed speech while the AI is talking,
      // never on the bare VAD signal (speaker echo trips the VAD too).
      if (event.text.trim() && this.replying) this.handleBargeIn();
      return;
    }

    if (event.text) {
      this.deepgramReconnects = 0;
      // Real voiced seconds from Deepgram's audio timestamps, not wall
      // clock: wall clock mixed AI speech and silence into student WPM and
      // produced nonsense readings (e.g. 1079 WPM).
      if (
        typeof event.start === 'number' &&
        typeof event.end === 'number' &&
        event.end > event.start
      ) {
        this.studentSpeechSec += event.end - event.start;
      }
      this.currentUserText = this.currentUserText
        ? `${this.currentUserText} ${event.text}`
        : event.text;
      this.emitFn('transcript', { role: 'user', text: event.text, isFinal: true });
      // If neither speech_final nor UtteranceEnd arrives, commit after a
      // pause following the last final.
      this.scheduleCommitFallback();
    }

    if (event.speechFinal) {
      this.commitTurn('speech-final', event.confidence);
    }
  }

  private scheduleCommitFallback(): void {
    if (this.commitTimer) clearTimeout(this.commitTimer);
    // Long on purpose (default 4s, env-overridable): the learner gets room
    // to think and finish a long sentence before the coach replies.
    this.commitTimer = setTimeout(() => {
      if (!this.ended && this.currentUserText.trim()) {
        this.commitTurn('fallback-timer', 0);
      }
    }, commitFallbackMs());
  }

  private commitTurn(reason: string, confidence: number): void {
    if (this.ended) return;
    if (this.commitTimer) {
      clearTimeout(this.commitTimer);
      this.commitTimer = null;
    }
    // Metrics for this utterance.
    const now = Date.now();
    if (confidence > 0) {
      this.confidenceSum += confidence;
      this.confidenceSamples += 1;
    }

    const said = this.currentUserText.trim();
    this.currentUserText = '';

    if (this.pronunciationActive) {
      const pcm = Buffer.concat(this.pronunciationChunks);
      this.pronunciationChunks = [];
      this.pronunciationBytes = 0;
      if (said) this.assessPronunciation(pcm, said);
    }
    if (!said) return;

    this.opts.logger.log(`User turn committed (${reason}): "${said.slice(0, 80)}"`);
    const words = said.split(/\s+/).filter(Boolean);
    this.studentWords += words.length;
    const fillers = said.match(FILLER_PATTERN);
    if (fillers) this.fillerCount += fillers.length;

    const turn: Turn = { role: 'user', text: said, at: now };
    this.turns.push(turn);
    void this.rephraseTurn(turn);
    void this.generateReply(said);
  }

  /**
   * Yoodli-style live check on every learner turn: a verdict (correct /
   * needs fixing) plus a corrected rewrite when needed. The client shows a
   * check mark or a magic wand next to the learner's bubble and reveals
   * the rewrite underneath on tap. One small free-model call per turn, in
   * parallel with the coach's reply; failures stay silent (the verdict is
   * a nice-to-have, never worth breaking the call for).
   */
  private async rephraseTurn(turn: Turn): Promise<void> {
    try {
      const raw = await this.opts.claude.complete({
        model: rephraseModel(),
        system:
          'You check what an English learner just said. ' +
          'If it is already correct, natural English, answer with exactly: OK. ' +
          'Otherwise rewrite it in correct, natural English: keep their meaning, keep it short and spoken-style, fix grammar, word choice and logic. ' +
          'Never explain: answer with only OK or the rewritten sentence.',
        prompt: turn.text,
        maxTokens: 150,
      });
      const suggestion = raw.trim().replace(/^["'`]+|["'`]+$/g, '').trim();
      if (this.ended) return;
      if (!suggestion || /^ok\b/i.test(suggestion) ||
          suggestion.toLowerCase() === turn.text.trim().toLowerCase()) {
        this.emitFn('sentence-check', { original: turn.text, ok: true });
        return;
      }
      turn.rephrase = suggestion;
      this.emitFn('sentence-check', { original: turn.text, ok: false, suggestion });
    } catch {
      // silent by design
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

    if (this.opts.roleplayId) {
      const scenario = getRoleplay(this.opts.roleplayId);
      if (scenario) {
        const beats = scenario.targets.map((t, i) => `${i + 1}. ${t}`).join('\n');
        const rubric = scenario.rubric.map((r) => `- ${r.label}: ${r.hint}`).join('\n');
        context += `\n\nYou are running the roleplay "${scenario.title}". You play: ${scenario.personaRole}. Stay in that role the whole session; the learner plays themselves.\nThe learner's goal for this scene: ${scenario.goal}\nWork through these beats roughly in order, one at a time, following the learner's answers and never rushing to the next beat before the current one lands:\n${beats}\nWhile coaching, keep these scoring criteria in mind (they shape your on-the-spot feedback):\n${rubric}\nWhen every beat is done, close the scene warmly, name the one thing they did best and the one thing to practise, and ask if they want to run it again.`;
      }
    }

    if (this.opts.topicSeed && this.opts.mode === 'free-talk') {
      context += `\n\nThe student chose to practise this exact question: "${this.opts.topicSeed}". Open the conversation by asking it naturally, then follow their answers as usual.`;
    }

    if (this.facts.length) {
      context += `\n\nThings the student has mentioned before: ${this.facts.join('; ')}.`;
    }

    const recentCoachLines = this.turns
      .filter((turn) => turn.role === 'assistant')
      .slice(-3)
      .map((turn) => `"${turn.text}"`);
    if (recentCoachLines.length) {
      context += `\n\nYour last lines were: ${recentCoachLines.join(' | ')}. Do not repeat or closely paraphrase any of them.`;
    }

    return `${base}\n\n${ENGINE_RULES_PROMPT}${context}`;
  }

  private async generateReply(userSaid: string | null): Promise<void> {
    if (this.ended || this.replying) return;
    this.replying = true;
    const replyId = ++this.replySeq;
    this.replyAbort = new AbortController();
    this.emitFn('session-state', { state: 'thinking' });

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
          this.emitFn('reply-text', { replyId: myReply, sentence: mySentence, text: sentence });
          void this.opts.tts
            .synthesizeSentence({
              text: sentence,
              voiceId,
              fallbackVoiceId: this.opts.tts.resolveFallbackVoiceId(this.opts.persona),
              signal: this.replyAbort?.signal,
              onChunk: (chunk) => {
                if (this.replySeq === myReply && !this.ended) {
                  this.emitFn('reply-audio', { replyId: myReply, sentence: mySentence }, chunk);
                }
              },
            })
            .then(() => {
              if (this.replySeq === myReply && !this.ended) {
                this.emitFn('reply-sentence-end', { replyId: myReply, sentence: mySentence });
              }
            })
            .catch((err: Error) => {
              if (!this.ended && err.name !== 'AbortError') {
                this.opts.logger.warn(`TTS failed: ${err.message}`);
                this.emitFn('error', { code: 'TTS_ERROR', message: 'Voice generation failed for one sentence.' });
              }
            });
        },
      });

      if (assistantText && !this.ended) {
        this.turns.push({ role: 'assistant', text: assistantText, at: Date.now() });
        this.emitFn('reply-end', { replyId });
        this.emitFn('session-state', { state: 'listening' });
        this.userTurnsSinceFacts += userSaid ? 1 : 0;
        if (this.userTurnsSinceFacts >= 4) {
          this.userTurnsSinceFacts = 0;
          void this.refreshFacts();
        }
        void this.persist();
        this.emitMetrics();
      } else if (!this.ended) {
        // Provider returned an empty completion: never hang silently.
        this.opts.logger.warn(
          `Empty completion from the live model in session ${this.sessionId}`,
        );
        this.emitFn('error', {
          code: 'LLM_EMPTY',
          message: 'The AI had no answer that time. Please say that again.',
        });
        this.emitFn('session-state', { state: 'listening' });
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        // Barge-in: a newer reply is on its way.
        this.emitFn('session-state', { state: 'listening' });
      } else {
        this.opts.logger.warn(`Reply generation failed: ${(err as Error).message}`);
        this.emitFn('error', { code: 'LLM_ERROR', message: 'The conversation hit a problem. Try again.' });
        this.emitFn('session-state', { state: 'listening' });
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
    this.emitFn('interrupt');
  }

  // ------------------------------------------------------------ metrics

  private computeMetrics() {
    const elapsedSec = Math.max(1, this.activeMs() / 1000);
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
    this.emitFn('metrics', this.computeMetrics());
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
    if (this.ended || this.paused) return;
    this.turns.push({ role: 'user', text: `[system] ${WRAP_UP_INSTRUCTION}`, at: Date.now() });
    await this.generateReply(WRAP_UP_INSTRUCTION);
    setTimeout(() => this.emitFn('session-state', { state: 'time-up' }), 15000);
  }

  private async persist(): Promise<void> {
    try {
      const metrics: Record<string, unknown> = this.computeMetrics();
      const pronunciation = summarizePronunciation(this.assessments);
      if (pronunciation) metrics.pronunciation = pronunciation;
      await this.opts.aiPartner.saveLiveState({
        sessionId: this.opts.sessionId,
        transcript: this.turns as unknown as unknown[],
        facts: this.facts,
        metrics,
      });
    } catch (err) {
      this.opts.logger.warn(`Persist failed for ${this.opts.sessionId}: ${(err as Error).message}`);
    }
  }
}

/** Thrown when the concurrent live-session cap is reached. Carries a
 *  stable code the gateway maps to a friendly client message. */
export class AiPartnerBusyError extends Error {
  readonly code = 'AI_PARTNER_BUSY';
  constructor() {
    super('Too many live AI Partner sessions right now.');
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
    private readonly pronunciation: PronunciationService,
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
    roleplayId?: string | null;
    topicSeed?: string;
    emit: LiveSessionEmit;
  }): Promise<LiveSession> {
    // Concurrency guard: refuse cleanly past the cap so one busy evening
    // cannot degrade every live session or exhaust the free-tier keys.
    if (this.sessions.size >= maxConcurrentLiveSessions()) {
      throw new AiPartnerBusyError();
    }
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
      roleplayId: params.roleplayId,
      topicSeed: params.topicSeed,
      emit: params.emit,
      onOrphaned: (sessionId) => {
        // Grace window lapsed with no reconnect: end the session normally
        // (persists transcript, closes Deepgram, marks the row ended).
        void this.destroy(sessionId);
      },
      deepgramService: this.deepgramService,
      claude: this.claude,
      tts: this.tts,
      aiPartner: this.aiPartner,
      pronunciation: this.pronunciation,
      logger: this.logger,
    });
    this.sessions.set(params.sessionId, live);
    await live.start();
    return live;
  }

  get(sessionId: string): LiveSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Re-attach an orphaned live session to a fresh socket. Returns true when
   * the session is alive again under the new emission target.
   */
  reattachSession(sessionId: string, emit: LiveSessionEmit): boolean {
    const live = this.sessions.get(sessionId);
    if (!live) return false;
    return live.reattach(emit);
  }

  async destroy(sessionId: string): Promise<void> {
    const live = this.sessions.get(sessionId);
    if (live) {
      await live.stop();
      this.sessions.delete(sessionId);
    }
  }
}
