import { LiveSession } from './conversation.service';
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
    // no speech_final at all: the 1.5s fallback must commit the turn
    await waitFor(
      () => claude.streamReply.mock.calls.length > callsAfterGreeting,
      4000,
    );
    await session.stop();
  }, 10000);

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
});
