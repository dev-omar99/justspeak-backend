import { ClaudeService } from './claude.service';

const OPENAI_SSE =
  'data: {"choices":[{"delta":{"content":"Hello Omar! "}}]}\n\n' +
  'data: {"choices":[{"delta":{"content":"How are you today? "}}]}\n\n' +
  'data: {"choices":[{"delta":{"content":"Tell me about your work"}}]}\n\n' +
  'data: [DONE]\n\n';

const ANTHROPIC_SSE =
  'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hi there! "}}\n\n' +
  'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"How can I help"}}\n\n' +
  'data: {"type":"message_stop"}\n\n';

describe('ClaudeService live provider routing', () => {
  const originalFetch = global.fetch;
  const env = process.env;

  beforeEach(() => {
    process.env = { ...env };
    delete process.env.AI_PARTNER_LIVE_BASE_URL;
    delete process.env.AI_PARTNER_LIVE_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'anthropic-test';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env = env;
  });

  const baseParams = {
    model: 'test-model',
    system: 'You are a coach.',
    turns: [{ role: 'user' as const, content: 'hi' }],
  };

  it('uses the Anthropic endpoint by default', async () => {
    global.fetch = jest.fn().mockResolvedValue(new Response(ANTHROPIC_SSE, { status: 200 })) as any;
    const service = new ClaudeService();
    const sentences: string[] = [];
    const text = await service.streamReply({
      ...baseParams,
      onSentence: (s) => sentences.push(s),
    });
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.headers['x-api-key']).toBe('anthropic-test');
    expect(text).toBe('Hi there! How can I help');
    expect(sentences).toEqual(['Hi there!', 'How can I help']);
  });

  it('routes to the OpenAI-compatible provider when AI_PARTNER_LIVE_BASE_URL is set', async () => {
    process.env.AI_PARTNER_LIVE_BASE_URL = 'https://api.groq.com/openai/v1/';
    process.env.AI_PARTNER_LIVE_API_KEY = 'groq-test';
    global.fetch = jest.fn().mockResolvedValue(new Response(OPENAI_SSE, { status: 200 })) as any;
    const service = new ClaudeService();
    const sentences: string[] = [];
    const text = await service.streamReply({
      ...baseParams,
      onSentence: (s) => sentences.push(s),
    });
    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(init.headers.authorization).toBe('Bearer groq-test');
    const body = JSON.parse(init.body);
    expect(body.messages[0]).toEqual({ role: 'system', content: 'You are a coach.' });
    expect(body.messages[1]).toEqual({ role: 'user', content: 'hi' });
    expect(body.stream).toBe(true);
    expect(text).toBe('Hello Omar! How are you today? Tell me about your work');
    expect(sentences).toEqual([
      'Hello Omar!',
      'How are you today?',
      'Tell me about your work',
    ]);
  });

  it('falls back to ANTHROPIC_API_KEY for the compatible provider when no dedicated key is set', async () => {
    process.env.AI_PARTNER_LIVE_BASE_URL = 'https://example.test/v1';
    global.fetch = jest.fn().mockResolvedValue(new Response(OPENAI_SSE, { status: 200 })) as any;
    const service = new ClaudeService();
    await service.streamReply({ ...baseParams, onSentence: () => undefined });
    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(init.headers.authorization).toBe('Bearer anthropic-test');
  });

  it('throws a clear error when the compatible provider has no key at all', async () => {
    process.env.AI_PARTNER_LIVE_BASE_URL = 'https://example.test/v1';
    delete process.env.ANTHROPIC_API_KEY;
    global.fetch = jest.fn() as any;
    const service = new ClaudeService();
    await expect(
      service.streamReply({ ...baseParams, onSentence: () => undefined }),
    ).rejects.toThrow('AI_PARTNER_LIVE_API_KEY');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('surfaces provider HTTP errors on the compatible path', async () => {
    process.env.AI_PARTNER_LIVE_BASE_URL = 'https://example.test/v1';
    process.env.AI_PARTNER_LIVE_API_KEY = 'k';
    global.fetch = jest
      .fn()
      .mockResolvedValue(new Response('rate limited', { status: 429 })) as any;
    const service = new ClaudeService();
    await expect(
      service.streamReply({ ...baseParams, onSentence: () => undefined }),
    ).rejects.toThrow('429');
  });
});
