import { Injectable, Logger } from '@nestjs/common';
import { anthropicApiKey, liveApiKey, liveBaseUrl } from './ai-partner.config';

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

/** Split a token stream into sentences so TTS can start early. */
function createSentenceSplitter(onSentence: (s: string, isLast: boolean) => void) {
  let pending = '';
  return {
    push(text: string) {
      pending += text;
      const match = pending.match(/([\s\S]*?[.!?])(\s+|$)([\s\S]*)$/);
      if (match && match[3].trim()) {
        onSentence(match[1].trim(), false);
        pending = match[3];
      }
    },
    end() {
      const sentence = pending.trim();
      if (sentence) onSentence(sentence, true);
      pending = '';
    },
  };
}

/**
 * Thin Anthropic Messages API client (plain fetch, no SDK dependency).
 * Used for the live conversation loop (streaming, Haiku) and for
 * post-session feedback reports (non-streaming, Sonnet/Opus).
 */
@Injectable()
export class ClaudeService {
  private readonly logger = new Logger('AiPartnerClaude');

  /**
   * Stream a reply. onSentence fires once per complete sentence so the
   * caller can start TTS while the rest of the reply is still generating
   * (this is how the sub-2-second reply target is met).
   */
  async streamReply(params: {
    model: string;
    system: string;
    turns: ChatTurn[];
    maxTokens?: number;
    onSentence: (sentence: string, isLast: boolean) => void;
    signal?: AbortSignal;
  }): Promise<string> {
    // Optional OpenAI-compatible provider for the live loop (Groq free tier,
    // Gemini OpenAI-compatible endpoint, ...). Anthropic stays the default.
    const baseUrl = liveBaseUrl();
    if (baseUrl) return this.streamOpenAICompatible(baseUrl, params);

    const key = anthropicApiKey();
    if (!key) throw new Error('ANTHROPIC_API_KEY is not configured');

    const res = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: params.model,
        max_tokens: params.maxTokens ?? 220,
        system: params.system,
        messages: params.turns,
        stream: true,
      }),
      signal: params.signal,
    });

    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Anthropic request failed (${res.status}): ${detail.slice(0, 200)}`);
    }

    let fullText = '';
    const splitter = createSentenceSplitter(params.onSentence);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split('\n\n');
      buffer = events.pop() ?? '';
      for (const eventBlock of events) {
        const dataLine = eventBlock
          .split('\n')
          .find((line) => line.startsWith('data:'));
        if (!dataLine) continue;
        const payload = dataLine.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        let event: any;
        try {
          event = JSON.parse(payload);
        } catch {
          continue;
        }
        if (event?.type === 'content_block_delta' && event?.delta?.type === 'text_delta') {
          const text: string = event.delta.text ?? '';
          fullText += text;
          splitter.push(text);
        }
        if (event?.type === 'message_stop') {
          splitter.end();
        }
      }
    }
    splitter.end();
    return fullText.trim();
  }

  /**
   * OpenAI-compatible streaming (chat/completions SSE). Used only when
   * AI_PARTNER_LIVE_BASE_URL is set. Same sentence-flush behavior as the
   * Anthropic path, so per-sentence TTS timing is unchanged.
   */
  private async streamOpenAICompatible(
    baseUrl: string,
    params: {
      model: string;
      system: string;
      turns: ChatTurn[];
      maxTokens?: number;
      onSentence: (sentence: string, isLast: boolean) => void;
      signal?: AbortSignal;
    },
  ): Promise<string> {
    const key = liveApiKey();
    if (!key) throw new Error('AI_PARTNER_LIVE_API_KEY is not configured');

    const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: params.model,
        max_tokens: params.maxTokens ?? 220,
        stream: true,
        messages: [
          { role: 'system', content: params.system },
          ...params.turns,
        ],
      }),
      signal: params.signal,
    });

    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Live provider request failed (${res.status}): ${detail.slice(0, 200)}`);
    }

    let fullText = '';
    const splitter = createSentenceSplitter(params.onSentence);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split('\n\n');
      buffer = events.pop() ?? '';
      for (const eventBlock of events) {
        const dataLine = eventBlock
          .split('\n')
          .find((line) => line.startsWith('data:'));
        if (!dataLine) continue;
        const payload = dataLine.slice(5).trim();
        if (!payload) continue;
        if (payload === '[DONE]') {
          splitter.end();
          continue;
        }
        let event: any;
        try {
          event = JSON.parse(payload);
        } catch {
          continue;
        }
        const text: string = event?.choices?.[0]?.delta?.content ?? '';
        if (text) {
          fullText += text;
          splitter.push(text);
        }
      }
    }
    splitter.end();
    return fullText.trim();
  }

  /** Non-streaming single call, used for feedback reports. */
  async complete(params: {
    model: string;
    system: string;
    prompt: string;
    maxTokens?: number;
  }): Promise<string> {
    const key = anthropicApiKey();
    if (!key) throw new Error('ANTHROPIC_API_KEY is not configured');

    const res = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: params.model,
        max_tokens: params.maxTokens ?? 1500,
        system: params.system,
        messages: [{ role: 'user', content: params.prompt }],
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Anthropic request failed (${res.status}): ${detail.slice(0, 200)}`);
    }
    const data: any = await res.json();
    const text = Array.isArray(data?.content)
      ? data.content
          .filter((block: any) => block?.type === 'text')
          .map((block: any) => block.text ?? '')
          .join('')
      : '';
    return text;
  }
}
