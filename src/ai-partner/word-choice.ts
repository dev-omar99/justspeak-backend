/**
 * Deterministic word-choice analytics for the learner's own speech.
 * Yoodli-style delivery numbers computed in code, never by the model:
 * counts and percentages must be exact, so the report merges these into
 * metrics_echo after the model call instead of trusting generated math.
 *
 * Pure functions over the learner's turns: trivially testable, and the
 * same module can feed the live rail, the report and dashboard trends.
 */

/** One counted item with its share of the relevant whole, 0-100. */
export interface WordStat {
  word: string;
  count: number;
  pct: number;
}

export interface WordChoiceStats {
  /** Total words the learner said. Denominator for the percentages. */
  totalWords: number;
  /** Filler usage: total count, share of words, and the top offenders. */
  fillers: { count: number; pct: number; top: WordStat[] };
  /** Vague/hedging words that weaken a sentence ("just", "stuff"...). */
  weakWords: WordStat[];
  /** Content words repeated 3+ times: how many distinct ones, and which. */
  repetition: { count: number; words: WordStat[] };
  /** Answer length discipline: average words per learner turn and how far
   *  above the spoken-answer ceiling that average runs (0 = inside it). */
  conciseness: { avgWordsPerTurn: number; excessPct: number };
  /** Words the learner starts sentences with, most frequent first. */
  sentenceStarters: WordStat[];
}

/** Fillers as regexes over the raw text, so variants count too
 *  ("umm" -> um, "uhh" -> uh, "you know" as a phrase). Word boundaries
 *  keep "actually" from matching "actuality". */
const FILLER_PATTERNS: { label: string; pattern: RegExp }[] = [
  { label: 'um', pattern: /\bum+\b/gi },
  { label: 'uh', pattern: /\buh+\b/gi },
  { label: 'er', pattern: /\ber+m\b|\ber+\b/gi },
  { label: 'like', pattern: /\blike\b/gi },
  { label: 'you know', pattern: /\byou know\b/gi },
  { label: 'basically', pattern: /\bbasically\b/gi },
  { label: 'actually', pattern: /\bactually\b/gi },
  { label: 'literally', pattern: /\bliterally\b/gi },
];

/** Words that usually weaken a statement without adding meaning. */
const WEAK_WORDS = new Set([
  'just', 'really', 'very', 'stuff', 'things', 'thing', 'maybe',
  'perhaps', 'basically', 'actually', 'literally', 'quite', 'simply',
]);

/** Common function words: ignored when measuring content repetition. */
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'so', 'to', 'of', 'in', 'on', 'at',
  'for', 'with', 'is', 'are', 'was', 'were', 'be', 'been', 'it', 'its',
  'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'we', 'they',
  'my', 'your', 'his', 'her', 'our', 'their', 'me', 'him', 'us', 'them',
  'do', 'does', 'did', 'have', 'has', 'had', 'not', 'no', 'yes', 'if',
  'then', 'than', 'when', 'what', 'how', 'why', 'who', 'there', 'here',
  'from', 'about', 'because', 'as', 'by', 'can', 'could', 'will', 'would',
  'should', 'am', 'im', 'ive', 'dont', 'didnt', 'its', 'thats',
]);

/** Spoken answers past this length tend to ramble (Yoodli flags ~40 words). */
const ANSWER_WORD_CEILING = 40;

const MIN_REPEAT_COUNT = 3;
const MIN_CONTENT_WORD_LEN = 4;
const MAX_LISTED = 5;

/** Lowercase word tokens, apostrophes kept ("i'm" -> "i'm"). */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[""]/g, "'")
    .match(/[a-z']+/g) ?? [];
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function pct(part: number, whole: number): number {
  return whole > 0 ? round1((part / whole) * 100) : 0;
}

/** Sorted, capped frequency list out of a token-count map. */
function topStats(counts: Map<string, number>, whole: number, cap = MAX_LISTED): WordStat[] {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, cap)
    .map(([word, count]) => ({ word, count, pct: pct(count, whole) }));
}

/**
 * Analyze the learner's side of a conversation.
 * @param learnerTurns the learner's final turn texts, in order.
 */
export function analyzeWordChoice(learnerTurns: string[]): WordChoiceStats {
  const fullText = learnerTurns.join(' ');
  const tokens = tokenize(fullText);
  const totalWords = tokens.length;

  // Fillers: count each pattern's matches over the raw text.
  const fillerCounts = new Map<string, number>();
  let fillerTotal = 0;
  for (const { label, pattern } of FILLER_PATTERNS) {
    const hits = fullText.match(pattern)?.length ?? 0;
    if (hits > 0) {
      fillerCounts.set(label, hits);
      fillerTotal += hits;
    }
  }

  // Weak words: plain token frequency over the watchlist.
  const weakCounts = new Map<string, number>();
  for (const token of tokens) {
    if (WEAK_WORDS.has(token)) weakCounts.set(token, (weakCounts.get(token) ?? 0) + 1);
  }

  // Repetition: content words said 3+ times signal a narrow active vocabulary.
  const contentCounts = new Map<string, number>();
  for (const token of tokens) {
    if (token.length >= MIN_CONTENT_WORD_LEN && !STOP_WORDS.has(token) && !WEAK_WORDS.has(token)) {
      contentCounts.set(token, (contentCounts.get(token) ?? 0) + 1);
    }
  }
  const repeated = new Map<string, number>(
    [...contentCounts.entries()].filter(([, count]) => count >= MIN_REPEAT_COUNT),
  );

  // Conciseness: average answer length vs the spoken-answer ceiling.
  const turnLengths = learnerTurns.map((turn) => tokenize(turn).length).filter((n) => n > 0);
  const avgWordsPerTurn = turnLengths.length
    ? round1(turnLengths.reduce((a, b) => a + b, 0) / turnLengths.length)
    : 0;
  const excessPct = avgWordsPerTurn > ANSWER_WORD_CEILING
    ? Math.round(((avgWordsPerTurn - ANSWER_WORD_CEILING) / ANSWER_WORD_CEILING) * 100)
    : 0;

  // Sentence starters: first token of each sentence-like segment.
  const starterCounts = new Map<string, number>();
  let sentenceCount = 0;
  for (const segment of fullText.split(/[.!?\n]+/)) {
    const first = tokenize(segment)[0];
    if (first) {
      starterCounts.set(first, (starterCounts.get(first) ?? 0) + 1);
      sentenceCount += 1;
    }
  }

  return {
    totalWords,
    fillers: {
      count: fillerTotal,
      pct: pct(fillerTotal, totalWords),
      top: topStats(fillerCounts, totalWords),
    },
    weakWords: topStats(weakCounts, totalWords),
    repetition: { count: repeated.size, words: topStats(repeated, totalWords) },
    conciseness: { avgWordsPerTurn, excessPct },
    sentenceStarters: topStats(starterCounts, sentenceCount),
  };
}
