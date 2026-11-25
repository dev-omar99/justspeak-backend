import { Injectable, Logger } from '@nestjs/common';
import { anthropicApiKey } from './ai-partner.config';

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

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
    let pending = '';
    const flushSentence = (isLast: boolean) => {
      const sentence = pending.trim();
      if (sentence) params.onSentence(sentence, isLast);
      pending = '';
    };

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
          pending += text;
          // Flush on sentence boundaries.
          const match = pending.match(/([\s\S]*?[.!?])(\s+|$)([\s\S]*)$/);
          if (match && match[3].trim()) {
            pending = match[1] + match[2] + match[3];
            const firstSentence = match[1];
            const rest = match[3];
            params.onSentence(firstSentence.trim(), false);
            pending = rest;
          }
        }
        if (event?.type === 'message_stop') {
          flushSentence(true);
        }
      }
    }
    flushSentence(true);
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
