/**
 * Per-sentence check of what the learner said: a verdict, the exact words
 * that are wrong (quoted from the learner's own sentence) and a refreshed
 * version. Pure helpers: the prompt, the parser and the honesty filter.
 * The model call itself lives in AiPartnerService.checkTurns.
 */

export type TurnIssueKind = 'grammar' | 'vocabulary' | 'unclear';

export interface TurnIssue {
  kind: TurnIssueKind;
  /** Exact words from the learner's sentence. Always a substring of it. */
  said: string;
  /** Short reason, written for the learner. */
  why: string;
}

export interface TurnCheck {
  /** Index of the turn in the saved transcript. */
  index: number;
  verdict: 'correct' | 'needs_fix';
  issues: TurnIssue[];
  /** Corrected, natural version. Only present when verdict is needs_fix. */
  refreshed?: string;
}

export const TURN_CHECK_SYSTEM_PROMPT =
  'You check sentences spoken by an English learner. The text comes from speech recognition, so punctuation and capitals are not errors. ' +
  'For each numbered sentence, decide: "correct" (natural, correct English) or "needs_fix". ' +
  'For needs_fix, list the real problems. Each problem has: kind ("grammar", "vocabulary" or "unclear"), "said" (the exact words copied from the sentence, never changed) and "why" (under 14 words, plain English). ' +
  'Use "unclear" for a word that looks misheard or misspelled (for example a name). ' +
  'Add "refreshed": the sentence in correct, natural spoken English that keeps the learner\'s meaning and does not add new facts. ' +
  'Never invent errors. If unsure, answer "correct". ' +
  'Answer with a JSON array only: [{"i":1,"verdict":"correct"},{"i":2,"verdict":"needs_fix","problems":[{"kind":"grammar","said":"...","why":"..."}],"refreshed":"..."}]';

const KINDS: TurnIssueKind[] = ['grammar', 'vocabulary', 'unclear'];

/** Numbered prompt body for the learner's turns (1-based numbers). */
export function buildTurnCheckPrompt(texts: string[]): string {
  return texts.map((t, k) => `${k + 1}. ${t}`).join('\n');
}

/**
 * Parse the model answer. Drops anything that cannot be trusted:
 * issues whose quote is not in the sentence, a needs_fix with no issue
 * and no refreshed text, and refreshed text equal to the original.
 * `indexes[k]` maps prompt number k+1 to the transcript index.
 */
export function parseTurnChecks(raw: string, texts: string[], indexes: number[]): TurnCheck[] {
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start < 0 || end <= start) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const out: TurnCheck[] = [];
  for (const item of data) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const k = Number(row.i) - 1;
    if (!Number.isInteger(k) || k < 0 || k >= texts.length) continue;
    const text = texts[k];
    const index = indexes[k];
    if (row.verdict !== 'needs_fix') {
      out.push({ index, verdict: 'correct', issues: [] });
      continue;
    }
    const issues: TurnIssue[] = [];
    for (const p of Array.isArray(row.problems) ? row.problems : []) {
      const q = p as Record<string, unknown>;
      const said = typeof q.said === 'string' ? q.said.trim() : '';
      const why = typeof q.why === 'string' ? q.why.trim().slice(0, 140) : '';
      const kind = KINDS.includes(q.kind as TurnIssueKind) ? (q.kind as TurnIssueKind) : 'grammar';
      if (said && why && text.toLowerCase().includes(said.toLowerCase())) issues.push({ kind, said, why });
    }
    let refreshed = typeof row.refreshed === 'string' ? row.refreshed.trim().replace(/^["'`]+|["'`]+$/g, '') : '';
    if (refreshed.length > 400 || refreshed.toLowerCase() === text.trim().toLowerCase()) refreshed = '';
    if (!issues.length && !refreshed) {
      out.push({ index, verdict: 'correct', issues: [] });
      continue;
    }
    out.push({ index, verdict: 'needs_fix', issues, ...(refreshed ? { refreshed } : {}) });
  }
  return out;
}
