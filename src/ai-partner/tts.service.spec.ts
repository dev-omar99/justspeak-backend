import { TtsService } from './tts.service';
import { getPersona } from './content/personas';

/** Builds a fetch Response stand-in. */
function reply(status: number, body = 'x'): any {
  const bytes = new TextEncoder().encode(body);
  let sent = false;
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
    body: {
      getReader: () => ({
        read: async () => (sent ? { done: true } : ((sent = true), { done: false, value: bytes })),
      }),
    },
  };
}

describe('TtsService free-plan handling', () => {
  const realFetch = global.fetch;
  beforeEach(() => {
    process.env.ELEVENLABS_API_KEY = 'test-key';
  });
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('falls back to a premade voice on 402 and remembers the refusal', async () => {
    const urls: string[] = [];
    global.fetch = jest.fn(async (url: any) => {
      urls.push(String(url));
      return String(url).includes('/lib-voice/') ? reply(402, 'paid_plan_required') : reply(200);
    }) as any;
    const tts = new TtsService();
    const chunks: Buffer[] = [];
    const params = { text: 'Hi', voiceId: 'lib-voice', fallbackVoiceId: 'premade', onChunk: (c: Buffer) => chunks.push(c) };
    await tts.synthesizeSentence(params);
    await tts.synthesizeSentence(params);
    expect(chunks.length).toBe(2);
    // first call tried lib-voice then premade, second went straight to premade
    expect(urls.filter((u) => u.includes('/lib-voice/')).length).toBe(1);
    expect(urls.filter((u) => u.includes('/premade/')).length).toBe(2);
  });

  it('retries on 429 then succeeds', async () => {
    let n = 0;
    global.fetch = jest.fn(async () => (n++ < 1 ? reply(429) : reply(200))) as any;
    const tts = new TtsService();
    await tts.synthesizeSentence({ text: 'Hi', voiceId: 'v', onChunk: () => undefined });
    expect(n).toBe(2);
  });

  it('every persona has a premade fallback', () => {
    const tts = new TtsService();
    for (const id of ['sara', 'adams', 'rachel', 'sam']) {
      expect(tts.resolveFallbackVoiceId(getPersona(id))).toBeTruthy();
    }
  });
});
