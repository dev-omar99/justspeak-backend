/**
 * Offline evaluation checklist for a coach reply. Pure functions, no model
 * call. Run it on replies captured from a real or dry-run session, or on
 * hand-written fixtures, so changes to the coaching prompt are measured
 * against a fixed checklist instead of claimed.
 *
 * Honest limit: these are shape and safety checks (one question, length,
 * no correction, level-appropriate words, on topic). They do not judge
 * whether a reply is truly wise; a teacher read does that.
 */
import type { CoachLevel } from '../content/coaching-rules';

export interface ReplyContext {
  level: CoachLevel;
  /** Words from the scene (title, topic, goal) used for the on-topic check. */
  topicWords: string[];
  /** The learner's last turn. */
  learnerSaid: string;
  /** Earlier coach lines, to catch repetition. */
  previousCoachLines: string[];
  /** True when the lesson time target has passed. */
  closing?: boolean;
}

export interface CheckResult {
  id: string;
  pass: boolean;
  detail: string;
}

const MAX_WORDS_PER_SENTENCE: Record<CoachLevel, number> = { A1: 9, A2: 12, B1: 18, B2: 24, C1: 32 };
const MAX_SENTENCES = 4;

const sentences = (t: string) => t.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
const words = (t: string) => t.toLowerCase().match(/[a-z']+/g) ?? [];

export function checkReply(reply: string, ctx: ReplyContext): CheckResult[] {
  const out: CheckResult[] = [];
  const sents = sentences(reply);
  const questions = (reply.match(/\?/g) ?? []).length;

  out.push({
    id: 'one-question',
    pass: ctx.closing ? questions <= 1 : questions === 1,
    detail: `${questions} question mark(s)`,
  });
  out.push({
    id: 'short-turn',
    pass: sents.length >= 1 && sents.length <= MAX_SENTENCES,
    detail: `${sents.length} sentence(s), max ${MAX_SENTENCES}`,
  });
  const longest = Math.max(0, ...sents.map((s) => words(s).length));
  out.push({
    id: 'level-sentence-length',
    pass: longest <= MAX_WORDS_PER_SENTENCE[ctx.level],
    detail: `longest sentence ${longest} words, max ${MAX_WORDS_PER_SENTENCE[ctx.level]} at ${ctx.level}`,
  });
  out.push({
    id: 'no-correction',
    pass: !/\b(you should say|the correct (word|form|way)|that is wrong|that's wrong|incorrect|you made a mistake|grammar mistake|instead of saying)\b/i.test(reply),
    detail: 'no mid-conversation correction',
  });
  out.push({
    id: 'no-arabic',
    pass: !/[\u0600-\u06FF]/.test(reply),
    detail: 'English only',
  });
  const replyWords = new Set(words(reply));
  const onTopic = ctx.topicWords.some((w) => replyWords.has(w.toLowerCase()));
  const learnerWords = words(ctx.learnerSaid).filter((w) => w.length > 3);
  const reacts = learnerWords.some((w) => replyWords.has(w));
  out.push({
    id: 'on-topic-or-reacts',
    pass: onTopic || reacts || ctx.closing === true,
    detail: onTopic ? 'uses a scene word' : reacts ? 'reacts to the learner' : 'neither scene word nor reaction',
  });
  const norm = (t: string) => words(t).join(' ');
  out.push({
    id: 'no-repeat',
    pass: !ctx.previousCoachLines.some((l) => norm(l) === norm(reply)),
    detail: 'not a copy of an earlier line',
  });
  if (ctx.closing) {
    out.push({
      id: 'closes-politely',
      pass: /\b(good ?bye|bye|see you|take care|talk soon|until next time)\b/i.test(reply),
      detail: 'contains a goodbye',
    });
  }
  return out;
}

/** Share of checks passed across many replies, per check id. */
export function summarise(results: CheckResult[][]): Record<string, { pass: number; total: number }> {
  const acc: Record<string, { pass: number; total: number }> = {};
  for (const r of results.flat()) {
    acc[r.id] ??= { pass: 0, total: 0 };
    acc[r.id].total += 1;
    if (r.pass) acc[r.id].pass += 1;
  }
  return acc;
}
