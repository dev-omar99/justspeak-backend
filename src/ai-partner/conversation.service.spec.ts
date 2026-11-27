import { AiPartnerBusyError, ConversationService, LiveSession } from './conversation.service';
import { getPersona } from './content/personas';
import { Logger } from '@nestjs/common';

/**
 * Turn-loop tests for the live session: barge-in discipline, turn commit
 * (speech_final and the fallback timer) and the empty-completion guard.
 */

interface FakeStream {
  sendAudio: jest.Mock;
  finish: jest.Mock;
}

function makeSession(overrides: {
  replyImpl?: (params: any) => Promise<string>;
  onOrphaned?: (sessionId: string) => void;
} = {}) {
  const events: { event: string; args: any[] }[] = [];
  const emit = (event: string, ...args: any[]) => {
    events.push({ event, args });
  };
  let handlers: any = null;
  const stream: FakeStream = { sendAudio: jest.fn(), finish: jest.fn() };
  const deepgramService = {
    openStream: jest.fn((h: any) => {
      handlers = h;
      return stream;
    }),
  };
  const claude = {
    streamReply: jest.fn(
      overrides.replyImpl ?? (async () => 'That sounds great! Tell me more.'),
    ),
    complete: jest.fn(async () => '[]'),
  };
  const tts = {
    resolveVoiceId: jest.fn(() => 'voice-1'),
    synthesizeSentence: jest.fn(async ({ onChunk }: any) => {
      onChunk?.(Buffer.from('mp3'));
    }),
  };
  const saved: any[] = [];
  const aiPartner = {
    saveLiveState: jest.fn(async (state: any) => {
      saved.push(state);
    }),
    endSession: jest.fn(async () => undefined),
  };
  const logger = new Logger('test');
  jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
  jest.spyOn(logger, 'log').mockImplementation(() => undefined);

  const session = new LiveSession({
    sessionId: 's1',
    userId: 'u1',
    userName: 'Omar',
    mode: 'free-talk',
    persona: getPersona('sara'),
    level: 'B1',
    emit,
    onOrphaned: overrides.onOrphaned ?? (() => undefined),
    deepgramService: deepgramService as any,
    claude: claude as any,
    tts: tts as any,
    aiPartner: aiPartner as any,
    pronunciation: { assessUtterance: jest.fn(async () => null) } as any,
    logger,
  });
  return { session, events, stream, claude, saved, getHandlers: () => handlers };
}

async function waitFor(cond: () => boolean, ms = 3000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe('LiveSession turn loop', () => {
  it('does not register a bare-VAD barge-in handler (speaker echo protection)', async () => {
    const { session, getHandlers } = makeSession();
    await session.start();
    expect(getHandlers().onSpeechStarted).toBeUndefined();
    await session.stop();
  });

  it('commits the user turn and replies on speech_final', async () => {
    const { session, events, claude } = makeSession();
    await session.start();
    // greeting reply finishes
    await waitFor(() => events.some((e) => e.event === 'reply-end'));
    const callsAfterGreeting = claude.streamReply.mock.calls.length;

    const openStream = (session as any).opts.deepgramService.openStream;
    const captured = openStream.mock.calls[0][0];
    captured.onTranscript({ isFinal: false, speechFinal: false, text: 'I will', confidence: 0.9 });
    captured.onTranscript({ isFinal: true, speechFinal: false, text: 'I will go to Alex', confidence: 0.9 });
    captured.onTranscript({ isFinal: true, speechFinal: true, text: '', confidence: 0.9 });

    await waitFor(
      () => claude.streamReply.mock.calls.length > callsAfterGreeting,
    );
    await waitFor(() => events.filter((e) => e.event === 'reply-end').length >= 2);
    expect(claude.streamReply.mock.calls.length).toBe(callsAfterGreeting + 1);
    await session.stop();
  });

  it('commits the turn via the fallback timer when speech_final never arrives', async () => {
    const { session, events, claude } = makeSession();
    await session.start();
    await waitFor(() => events.some((e) => e.event === 'reply-end'));
    const callsAfterGreeting = claude.streamReply.mock.calls.length;

    const openStream = (session as any).opts.deepgramService.openStream;
    const captured = openStream.mock.calls[0][0];
    captured.onTranscript({ isFinal: true, speechFinal: false, text: 'hello there coach', confidence: 0.9 });
    // no speech_final at all: the fallback timer must commit the turn
    await waitFor(
      () => claude.streamReply.mock.calls.length > callsAfterGreeting,
      8000,
    );
    await session.stop();
  }, 15000);

  it('barges in only on interim text while replying, not on silence', async () => {
    let releaseReply: (v: string) => void = () => undefined;
    const replyImpl = jest.fn(
      () =>
        new Promise<string>((resolve) => {
          releaseReply = resolve;
        }),
    );
    const { session, events } = makeSession({ replyImpl });
    // start() awaits the greeting reply, which we hold open deliberately.
    const startPromise = session.start();
    await waitFor(() => replyImpl.mock.calls.length === 1);

    const openStream = (session as any).opts.deepgramService.openStream;
    const captured = openStream.mock.calls[0][0];
    // empty interim: no barge-in
    captured.onTranscript({ isFinal: false, speechFinal: false, text: '', confidence: 0 });
    expect(events.some((e) => e.event === 'interrupt')).toBe(false);
    // real interim text while replying: barge-in
    captured.onTranscript({ isFinal: false, speechFinal: false, text: 'wait stop', confidence: 0.8 });
    expect(events.some((e) => e.event === 'interrupt')).toBe(true);
    releaseReply('OK, paused.');
    await startPromise;
    await session.stop();
  });

  it('emits LLM_EMPTY and returns to listening on an empty completion', async () => {
    let calls = 0;
    const replyImpl = jest.fn(async () => {
      calls += 1;
      return calls === 1 ? 'Welcome! How are you?' : '';
    });
    const { session, events } = makeSession({ replyImpl });
    await session.start();
    await waitFor(() => events.some((e) => e.event === 'reply-end'));

    const openStream = (session as any).opts.deepgramService.openStream;
    const captured = openStream.mock.calls[0][0];
    captured.onTranscript({ isFinal: true, speechFinal: true, text: 'hi', confidence: 0.9 });

    await waitFor(() =>
      events.some(
        (e) => e.event === 'error' && e.args[0]?.code === 'LLM_EMPTY',
      ),
    );
    // state returns to listening instead of hanging in "thinking"
    const states = events
      .filter((e) => e.event === 'session-state')
      .map((e) => e.args[0].state);
    expect(states[states.length - 1]).toBe('listening');
    await session.stop();
  });

  it('emits a "say it better" rephrase for an incorrect user turn', async () => {
    const { session, events, claude } = makeSession();
    claude.complete.mockImplementation((async (params: any) => {
      return params.system.includes('rewrite') ? 'I have lived here for three years.' : '[]';
    }) as any);
    await session.start();
    await waitFor(() => events.some((e) => e.event === 'reply-end'));

    const openStream = (session as any).opts.deepgramService.openStream;
    const captured = openStream.mock.calls[0][0];
    captured.onTranscript({
      isFinal: true,
      speechFinal: true,
      text: 'I am living here since three years.',
      confidence: 0.9,
    });
    await waitFor(() =>
      events.some(
        (e) =>
          e.event === 'sentence-check' &&
          e.args[0].ok === false &&
          e.args[0].suggestion === 'I have lived here for three years.',
      ),
    );
    // the rewrite is stored on the turn, so it lands in the saved transcript
    await waitFor(() =>
      (session as any).turns.some((t: any) => t.rephrase === 'I have lived here for three years.'),
    );
    await session.stop();
  });

  it('emits a check-mark verdict when the learner sentence is already correct', async () => {
    const { session, events, claude } = makeSession();
    claude.complete.mockImplementation((async (params: any) => {
      return params.system.includes('rewrite') ? 'OK' : '[]';
    }) as any);
    await session.start();
    await waitFor(() => events.some((e) => e.event === 'reply-end'));

    const openStream = (session as any).opts.deepgramService.openStream;
    const captured = openStream.mock.calls[0][0];
    captured.onTranscript({
      isFinal: true,
      speechFinal: true,
      text: 'I have lived here for three years.',
      confidence: 0.9,
    });
    await waitFor(() =>
      events.some((e) => e.event === 'sentence-check' && e.args[0].ok === true),
    );
    expect(events.some((e) => e.event === 'sentence-check' && e.args[0].ok === false)).toBe(false);
    await session.stop();
  });

  it('keeps the turn loop alive when the rephrase call fails', async () => {
    const { session, events, claude } = makeSession();
    claude.complete.mockImplementation((async (params: any) => {
      if (params.system.includes('rewrite')) throw new Error('provider down');
      return '[]';
    }) as any);
    await session.start();
    await waitFor(() => events.some((e) => e.event === 'reply-end'));

    const openStream = (session as any).opts.deepgramService.openStream;
    const captured = openStream.mock.calls[0][0];
    const callsBefore = claude.streamReply.mock.calls.length;
    captured.onTranscript({ isFinal: true, speechFinal: true, text: 'hi', confidence: 0.9 });
    // the coach still answers; the failed verdict stays silent
    await waitFor(() => claude.streamReply.mock.calls.length > callsBefore);
    expect(events.some((e) => e.event === 'sentence-check')).toBe(false);
    await session.stop();
  });
});


describe('LiveSession reconnect (socket drop)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('keeps the session alive on detach and resumes on reattach with a state snapshot', async () => {
    const orphaned = jest.fn();
    const { session, events } = makeSession({ onOrphaned: orphaned });
    await session.start();
    events.length = 0;

    session.detach();
    // Events emitted while detached go nowhere (dead socket), and the
    // orphan timer has not fired yet.
    jest.advanceTimersByTime(30000);
    expect(orphaned).not.toHaveBeenCalled();

    const resumed: { event: string; args: any[] }[] = [];
    const ok = session.reattach((event, ...args) => resumed.push({ event, args }));
    expect(ok).toBe(true);
    expect(resumed[0].event).toBe('session-resumed');
    expect(resumed[0].args[0].sessionId).toBe('s1');

    // Well past the grace window: nothing orphaned, session still alive.
    jest.advanceTimersByTime(120000);
    expect(orphaned).not.toHaveBeenCalled();
    await session.stop();
  });

  it('ends the session through onOrphaned when the grace window lapses', async () => {
    const orphaned = jest.fn();
    const { session } = makeSession({ onOrphaned: orphaned });
    await session.start();

    session.detach();
    jest.advanceTimersByTime(90000);
    expect(orphaned).toHaveBeenCalledWith('s1');
    // stop() is idempotent-safe after orphaning path runs destroy().
    await session.stop();
  });

  it('detach is idempotent and reattach refuses an ended session', async () => {
    const { session } = makeSession();
    await session.start();
    session.detach();
    session.detach();
    await session.stop();
    expect(session.reattach(() => undefined)).toBe(false);
  });
});

describe('ConversationService concurrency cap', () => {
  afterEach(() => {
    delete process.env.AI_PARTNER_MAX_CONCURRENT_LIVE;
  });

  it('refuses a new live session once the cap is reached', async () => {
    process.env.AI_PARTNER_MAX_CONCURRENT_LIVE = '1';
    const service = new ConversationService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    // One session already live (the map entry only needs to exist).
    (service as any).sessions.set('live-1', {});
    await expect(
      service.createLiveSession({
        sessionId: 'live-2',
        userId: 'u',
        userName: 'Omar',
        mode: 'free-talk',
        personaId: 'tutor',
        level: 'B1',
        emit: () => undefined,
      }),
    ).rejects.toBeInstanceOf(AiPartnerBusyError);
  });

  it('allows a session while under the cap', async () => {
    process.env.AI_PARTNER_MAX_CONCURRENT_LIVE = '5';
    const service = new ConversationService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    (service as any).sessions.set('live-1', {});
    // The guard passes; construction then fails on the stubbed Deepgram
    // dependency, which proves the busy guard itself did not throw.
    await expect(
      service.createLiveSession({
        sessionId: 'live-2',
        userId: 'u',
        userName: 'Omar',
        mode: 'free-talk',
        personaId: 'tutor',
        level: 'B1',
        emit: () => undefined,
      }),
    ).rejects.not.toBeInstanceOf(AiPartnerBusyError);
  });
});
