/**
 * JustSpeak AI Partner - feedback and scoring rubric (v2).
 * Used by the post-session report generator (Claude Sonnet) and the
 * placement-level check (Claude Opus). Input is the full transcript plus
 * the metrics JSON computed from the Deepgram stream.
 *
 * v2 adds the Yoodli-parity fields: coaching cards with quoted evidence,
 * per-sentence corrections with clear Modern Standard Arabic explanations, recasts,
 * follow-up questions and practice drills.
 */

export const FEEDBACK_RUBRIC_PROMPT = `You are the JustSpeak speaking assessor: an expert in second-language acquisition who understands how English grammar, usage and CEFR levels actually work, and how Arabic-speaking learners in particular progress. You receive the full transcript of an English practice session and a metrics JSON computed from the audio stream. Score honestly, coach warmly, and prove every claim with the student's own words. Your judgments must reflect real language pedagogy: distinguish errors that block meaning from slips, credit risk-taking with new language, and never treat a beginner like an advanced speaker.

DIMENSIONS (each scored 0 to 100, with evidence)

1. Grammar accuracy
   90-100: errors are rare and minor for the level.
   70-89: errors present but meaning is never lost.
   50-69: frequent errors, sometimes blocking meaning.
   Below 50: errors dominate.

2. Vocabulary range
   90-100: precise, varied, level-appropriate idioms used correctly.
   70-89: comfortable range, occasional repetition or wrong word.
   50-69: narrow range, heavy repetition, visible searching for words.
   Below 50: basic words missing for everyday topics.

3. Fluency and pace (use the metrics, not impressions)
   Compare words per minute and fillers per minute to level bands:
   A2 band: 60-90 wpm; B1: 90-110; B2: 110-130; C1+: 130-160.
   90-100: within band with fewer than 3 fillers per minute.
   70-89: slightly under band or 3-6 fillers per minute.
   50-69: well under band or more than 6 fillers per minute.

4. Pronunciation and clarity
   If METRICS contains a "pronunciation" block (engine: azure-pronunciation-assessment),
   it is real phoneme-level scoring: use its accuracy/fluency/prosody numbers as the
   ground truth for this dimension and name its worstWords in the evidence.
   Otherwise fall back to the STT word-confidence average and low-confidence clusters.
   90-100: nearly all words recognised confidently (or Azure accuracy >= 90).
   70-89: occasional unclear words, meaning always recoverable.
   50-69: frequent low-confidence stretches.

5. Interaction
   90-100: full answers, asks back, natural turn-taking.
   70-89: answers fully but rarely asks back.
   50-69: minimal answers, needs constant prompting.

6. Coherence (extra criterion, same 0-100 scale)
   Ideas are connected and follow in a sensible order, answers stay on the question, linking words are used.
   90-100: clear, well-organised answers that stay on topic. 70-89: mostly connected, some jumps. 50-69: disconnected or often off the question. Below 50: hard to follow.
   Use null if there is too little connected speech to judge.

DIMENSION NOTES
   For every dimension you scored, write one short plain-English line "why" (under 20 words) that names the evidence (for example the measured words per minute for fluency). Add "quote" only when you can copy exact words the student said that show it; otherwise leave quote empty. Never invent a quote.

LEVEL-RELATIVE SCORING
   Every session belongs to a level (A1 to C2, half-levels included). Score the student AGAINST that level's expectations, not against native speech: a B1 student using correct past simple and some linking words is a strong B1, even if the language is simple. In each dimension, expect the grammar, vocabulary and structures that the level's syllabus teaches. A session run as a lesson must also be assessed against that lesson's goal and target language (the prompt names them); a session run as a level check (placement) must estimate which level the performance matches.

CEFR ESTIMATE
   Map the overall score to a level estimate relative to the student's declared level:
   85+ suggest testing one level up; 60-84 on track; 40-59 consolidate current level; below 40 suggest one level down.
   State this as an estimate, never a certification.

OFF-TOPIC AND GOAL RULE (lesson and roleplay sessions)
   - lesson_result.goal_met is "yes" only when the student spoke to the lesson goal and covered most of its rubric points.
   - Use "partly" when some points were covered. Use "no" when the student mostly did not do the lesson: off-topic talk, only repeating the partner, reading unrelated text, or refusing the task.
   - Being fluent about something else is not progress on this lesson. Do not raise grammar, vocabulary or interaction scores to reward fluent but off-topic speech. The code lowers the overall score when goal_met is "no".

HONESTY RULES (non-negotiable)
   - Never inflate a score to please the student.
   - Every correction, coaching card quote and recast must quote the student's exact words from the transcript. If you cannot quote it, do not report it.
   - For a dimension you cannot judge from this transcript, write null instead of a number. 0 means the student really scored zero, never "unknown".
   - If student speech totals under 1 minute, do not score. Return status INSUFFICIENT_DATA with a friendly note in next_focus.

CORRECTIONS (this is what makes JustSpeak different)
   - Find the student's real grammar mistakes. For each: quote the exact sentence (said), give the corrected version (better), name the rule in one short English line (rule), and explain the rule in clear Modern Standard Arabic (explanation_ar): simple, correct فصحى مبسطة that any Arabic speaker understands, the way a skilled teacher explains it, two short sentences at most. Never Egyptian dialect, never transliteration.
   - Common Egyptian-learner patterns to watch for: "I am agree", "she don't", "afraid from", "since/for confusion" ("living here since 3 years"), present perfect with past simple, "informations/advices", "explain me", "discuss about", missing third-person -s, "I am study" for "I am studying".
   - Up to 8 corrections, most important first. Spread them across the WHOLE session (beginning, middle and end), not only the opening turns. Only real quotes.

RECASTS
   - Pick up to 3 sentences the student said that were understandable but unnatural, and rewrite each the way a native speaker would say the same idea (natural). Quote the original exactly (said).

COACHING CARDS
   - strength_card: the single best thing the student did, with an exact quote proving it.
   - growth_area: the one pattern that limits them most, with an exact quote showing it, and concrete advice (detail).
   - tone: 1 to 3 short chips such as Friendly, Nervous, Confident, Hesitant, Enthusiastic.
   - conciseness_note: one line on whether answers were the right length, with one tighter rewrite of something they said if useful.

FOLLOW-UP QUESTIONS
   - 3 questions that naturally continue this conversation and would stretch the student's English. They will be offered as practice starters.

DRILLS
   - 3 short spoken drills targeting the corrections above. Each has a title, a one-line instruction, and one example answer. Make them doable in under a minute each.

Respond ONLY with valid JSON (no markdown fences) matching exactly:
{
  "status": "OK" or "INSUFFICIENT_DATA",
  "overall_score": 0,
  "cefr_estimate": "B1",
  "summary": "2-3 sentences: how the session went, in plain warm English",
  "dimensions": {
    "grammar": 0,
    "vocabulary": 0,
    "fluency": 0,
    "pronunciation": 0,
    "interaction": 0,
    "coherence": 0
  },
  "dimension_notes": {
    "grammar": { "why": "...", "quote": "exact words or empty" },
    "vocabulary": { "why": "...", "quote": "" },
    "fluency": { "why": "...", "quote": "" },
    "pronunciation": { "why": "...", "quote": "" },
    "interaction": { "why": "...", "quote": "" },
    "coherence": { "why": "...", "quote": "" }
  },
  "metrics_echo": {
    "student_speech_sec": 0,
    "words_per_minute": 0,
    "fillers_per_minute": 0,
    "student_talk_ratio": 0.0
  },
  "corrections": [
    { "said": "exact quote", "better": "corrected version", "rule": "one-line English rule", "explanation_ar": "شرح قصير بالعربية الفصحى المبسطة" }
  ],
  "recasts": [
    { "said": "exact quote", "natural": "how a native would say it" }
  ],
  "strengths": ["one line each"],
  "coaching": {
    "strength_card": { "title": "short label", "quote": "exact quote", "detail": "why it works" },
    "growth_area": { "title": "short label", "quote": "exact quote", "detail": "what to do instead" },
    "tone": ["Friendly"],
    "conciseness_note": "one line"
  },
  "follow_up_questions": ["question 1", "question 2", "question 3"],
  "lesson_result": { "goal_met": "yes | partly | no", "note": "one line: how the student did against this lesson's goal and target phrases (lesson and roleplay sessions only; omit for free talk)" },
  "drills": [
    { "title": "short label", "instruction": "one line", "example": "one example answer" }
  ],
  "next_focus": "the single most useful thing to practise next",
  "suggested_lessons": ["lesson ids from the course map, or empty array"]
}`;

export interface ReportCorrection {
  said: string;
  better: string;
  rule: string;
  explanation_ar: string;
}

export interface ReportRecast {
  said: string;
  natural: string;
}

export interface CoachingCard {
  title: string;
  quote: string;
  detail: string;
}

import { WordChoiceStats } from '../word-choice';

export interface ReportDrill {
  title: string;
  instruction: string;
  example: string;
}

export type DimensionKey = 'grammar' | 'vocabulary' | 'fluency' | 'pronunciation' | 'interaction' | 'coherence';

export interface DimensionNote {
  why: string;
  /** Exact words the learner said, or empty. */
  quote: string;
}

const DIMENSION_KEYS: DimensionKey[] = ['grammar', 'vocabulary', 'fluency', 'pronunciation', 'interaction', 'coherence'];

/** Parse the model's per-dimension notes. Only keys we know, short strings only. */
export function parseDimensionNotes(raw: unknown): Partial<Record<DimensionKey, DimensionNote>> {
  const out: Partial<Record<DimensionKey, DimensionNote>> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const k of DIMENSION_KEYS) {
    const n = (raw as Record<string, any>)[k];
    if (!n || typeof n !== 'object') continue;
    const why = typeof n.why === 'string' ? n.why.trim().slice(0, 200) : '';
    const quote = typeof n.quote === 'string' ? n.quote.trim().slice(0, 240) : '';
    if (why) out[k] = { why, quote };
  }
  return out;
}

/**
 * Honesty pass, run in code after the model answers: a quote stays only if it
 * appears word for word in something the learner said (ignoring case and
 * extra spaces). Otherwise it is dropped and only the reason stays.
 */
export function verifyDimensionQuotes(
  notes: Partial<Record<DimensionKey, DimensionNote>> | undefined,
  learnerTurns: string[],
): Partial<Record<DimensionKey, DimensionNote>> {
  const norm = (t: string) => t.toLowerCase().replace(/\s+/g, ' ').trim();
  const said = learnerTurns.map(norm);
  const out: Partial<Record<DimensionKey, DimensionNote>> = {};
  for (const k of DIMENSION_KEYS) {
    const n = notes?.[k];
    if (!n) continue;
    const q = norm(n.quote);
    out[k] = { why: n.why, quote: q && said.some((t) => t.includes(q)) ? n.quote : '' };
  }
  return out;
}

export interface SessionReport {
  status: 'OK' | 'INSUFFICIENT_DATA';
  /** True when the model answered but no skill could be measured: the attempt counts as "did not reach the target", never as a score. */
  incomplete?: boolean;
  overall_score: number;
  cefr_estimate: string;
  summary: string;
  dimensions: {
    /** 0-100, or null when the dimension could not be measured (never 0 as a stand-in). */
    grammar: number | null;
    vocabulary: number | null;
    fluency: number | null;
    pronunciation: number | null;
    interaction: number | null;
    /** Extra criterion (IELTS fluency and coherence, CEFR coherence, Cambridge discourse management). Absent on older reports. */
    coherence?: number | null;
  };
  /** One-line reason and an exact learner quote per dimension. Quotes are verified against the transcript in code. */
  dimension_notes?: Partial<Record<DimensionKey, DimensionNote>>;
  /** Set in code only (never read from the model): the overall was lowered because the lesson goal was not met. */
  score_cap?: ScoreCap;
  /** Which lesson checklist points the conversation covered. Absent on older reports and when the model did not return it. */
  checklist?: { label: string; covered: boolean }[];
  /** How each score was produced, set in code: measured from the audio or metrics, or judged by the model (an estimate). */
  dimension_basis?: Partial<Record<DimensionKey, 'measured' | 'estimated'>>;
  /** Dimensions the learner knowingly skipped; shown as "Not attempted". Absent when none. */
  skipped_dimensions?: string[];
  metrics_echo: {
    student_speech_sec: number;
    words_per_minute: number;
    fillers_per_minute: number;
    student_talk_ratio: number;
    /** Deterministic word-choice analytics, computed in code after the
     *  model call (never trusted to generated math). Optional so older
     *  cached reports without it still parse. */
    word_choice?: WordChoiceStats;
  };
  corrections: ReportCorrection[];
  recasts: ReportRecast[];
  strengths: string[];
  coaching: {
    strength_card: CoachingCard;
    growth_area: CoachingCard;
    tone: string[];
    conciseness_note: string;
  };
  follow_up_questions: string[];
  lesson_result?: { goal_met: string; note: string };
  drills: ReportDrill[];
  next_focus: string;
  suggested_lessons: string[];
}

/**
 * Score for one dimension: a real number (including a measured 0) is clamped
 * to 0-100; anything missing or non-numeric is null = "could not be measured".
 * A technical failure must never look like a zero the learner earned.
 */
export function scoreOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) return null;
  return Math.max(0, Math.min(100, Math.round(num)));
}

export function clampScore(value: unknown): number {
  const num = typeof value === 'number' ? value : Number(value);
  if (Number.isNaN(num)) return 0;
  return Math.max(0, Math.min(100, Math.round(num)));
}

function asStringArray(value: unknown, max: number): string[] {
  return Array.isArray(value)
    ? value.filter((s): s is string => typeof s === 'string' && !!s.trim()).slice(0, max)
    : [];
}

function asCard(value: any): CoachingCard {
  return {
    title: typeof value?.title === 'string' ? value.title : '',
    quote: typeof value?.quote === 'string' ? value.quote : '',
    detail: typeof value?.detail === 'string' ? value.detail : '',
  };
}

/** Parse and sanitise the model's JSON reply into a SessionReport. */
export function parseSessionReport(rawText: string): SessionReport | null {
  const match = rawText.match(/\{[\s\S]*\}/);
  if (!match) return null;
  let parsed: any;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const status = parsed.status === 'INSUFFICIENT_DATA' ? 'INSUFFICIENT_DATA' : 'OK';
  const dims = parsed.dimensions ?? {};
  const metrics = parsed.metrics_echo ?? {};
  const coaching = parsed.coaching ?? {};
  return {
    status,
    overall_score: clampScore(parsed.overall_score),
    cefr_estimate: typeof parsed.cefr_estimate === 'string' ? parsed.cefr_estimate : '',
    summary: typeof parsed.summary === 'string' ? parsed.summary : '',
    dimensions: {
      grammar: scoreOrNull(dims.grammar),
      vocabulary: scoreOrNull(dims.vocabulary),
      fluency: scoreOrNull(dims.fluency),
      pronunciation: scoreOrNull(dims.pronunciation),
      interaction: scoreOrNull(dims.interaction),
      ...('coherence' in dims ? { coherence: scoreOrNull(dims.coherence) } : {}),
    },
    dimension_notes: parseDimensionNotes(parsed.dimension_notes),
    ...(Array.isArray(parsed.checklist)
      ? { checklist: parsed.checklist.filter((c: any) => c && typeof c.label === 'string' && typeof c.covered === 'boolean').slice(0, 8).map((c: any) => ({ label: String(c.label), covered: c.covered as boolean })) }
      : {}),
    metrics_echo: {
      student_speech_sec: Number(metrics.student_speech_sec) || 0,
      words_per_minute: Number(metrics.words_per_minute) || 0,
      fillers_per_minute: Number(metrics.fillers_per_minute) || 0,
      student_talk_ratio: Number(metrics.student_talk_ratio) || 0,
    },
    corrections: Array.isArray(parsed.corrections)
      ? parsed.corrections
          .filter((m: any) => m && typeof m.said === 'string' && m.said.trim())
          .slice(0, MAX_CORRECTIONS)
          .map((m: any) => ({
            said: String(m.said),
            better: typeof m.better === 'string' ? m.better : '',
            rule: typeof m.rule === 'string' ? m.rule : '',
            explanation_ar: typeof m.explanation_ar === 'string' ? m.explanation_ar : '',
          }))
      : [],
    recasts: Array.isArray(parsed.recasts)
      ? parsed.recasts
          .filter((r: any) => r && typeof r.said === 'string' && r.said.trim())
          .slice(0, 3)
          .map((r: any) => ({
            said: String(r.said),
            natural: typeof r.natural === 'string' ? r.natural : '',
          }))
      : [],
    strengths: asStringArray(parsed.strengths, 5),
    coaching: {
      strength_card: asCard(coaching.strength_card),
      growth_area: asCard(coaching.growth_area),
      tone: asStringArray(coaching.tone, 3),
      conciseness_note:
        typeof coaching.conciseness_note === 'string' ? coaching.conciseness_note : '',
    },
    follow_up_questions: asStringArray(parsed.follow_up_questions, 3),
    lesson_result:
      parsed.lesson_result && typeof parsed.lesson_result === 'object'
        ? {
            goal_met: typeof parsed.lesson_result.goal_met === 'string' ? parsed.lesson_result.goal_met : '',
            note: typeof parsed.lesson_result.note === 'string' ? parsed.lesson_result.note : '',
          }
        : undefined,
    drills: Array.isArray(parsed.drills)
      ? parsed.drills
          .filter((d: any) => d && typeof d.title === 'string' && d.title.trim())
          .slice(0, 3)
          .map((d: any) => ({
            title: String(d.title),
            instruction: typeof d.instruction === 'string' ? d.instruction : '',
            example: typeof d.example === 'string' ? d.example : '',
          }))
      : [],
    next_focus: typeof parsed.next_focus === 'string' ? parsed.next_focus : '',
    suggested_lessons: asStringArray(parsed.suggested_lessons, 5),
  };
}

/** The no-score answer for sessions with too little student speech. */
/** Corrections kept in a report: enough to cover a whole session, not just the opening. */
const MAX_CORRECTIONS = 8;

export function insufficientReport(
  metrics: Record<string, unknown>,
  requiredSpeechSec?: number,
): SessionReport {
  const heard = Math.round(Number(metrics['student_speech_sec'] ?? 0));
  // Say the real numbers so the learner can see why there is no score.
  const next =
    requiredSpeechSec && requiredSpeechSec > 0
      ? `We heard ${heard}s of your speech. A scored report needs at least ${requiredSpeechSec}s. Try a longer session with fuller answers.`
      : 'Try a longer session (at least a minute of speaking) to get your full report.';
  return {
    status: 'INSUFFICIENT_DATA',
    overall_score: 0,
    cefr_estimate: '',
    summary: '',
    dimensions: { grammar: null, vocabulary: null, fluency: null, pronunciation: null, interaction: null },
    metrics_echo: {
      student_speech_sec: Number(metrics['student_speech_sec'] ?? 0),
      words_per_minute: Number(metrics['words_per_minute'] ?? 0),
      fillers_per_minute: Number(metrics['fillers_per_minute'] ?? 0),
      student_talk_ratio: Number(metrics['student_talk_ratio'] ?? 0),
    },
    corrections: [],
    recasts: [],
    strengths: [],
    coaching: {
      strength_card: { title: '', quote: '', detail: '' },
      growth_area: { title: '', quote: '', detail: '' },
      tone: [],
      conciseness_note: '',
    },
    follow_up_questions: [],
    drills: [],
    next_focus: next,
    suggested_lessons: [],
  };
}

/** Per-word filler counts, computed from the transcript (never the model). */
export function countFillersByWord(text: string): { word: string; count: number }[] {
  const counts = new Map<string, number>();
  const pattern = /\b(um+|uh+|er+|erm|like|you know|actually|basically|literally)\b/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const word = match[1].toLowerCase();
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count);
}


/** The five skills whose mean is the overall score everywhere (report page, My Learning, tree, dashboard). Coherence is shown but not counted. */
export const OVERALL_DIMENSION_KEYS = ['pronunciation', 'fluency', 'vocabulary', 'grammar', 'interaction'] as const;

/** Highest overall (0-100) a session can get when the lesson goal was not met (5.5/10, below the 6/10 pass mark). */
export const OFF_GOAL_CAP = 55;

export interface ScoreCap {
  from: number;
  to: number;
  reason: string;
}

/** Mean of the measured skills, 0-100, unrounded. Unmeasured (null) skills are left out, never counted as 0. Null when none were measured. */
export function dimensionMean(dimensions: unknown): number | null {
  if (!dimensions || typeof dimensions !== 'object') return null;
  const values = OVERALL_DIMENSION_KEYS.map((k) => (dimensions as Record<string, unknown>)[k]).filter(
    (n): n is number => typeof n === 'number' && Number.isFinite(n),
  );
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + Math.max(0, Math.min(100, b)), 0) / values.length;
}

/**
 * The one overall score (0-100, whole number) for a stored report, or null when it has no real score.
 * It is the mean of the measured skills, lowered to the stored score cap when the lesson goal was not met.
 * Never the model's own overall_score, so every screen agrees. Rounding to a whole number matches the
 * report page, which shows one decimal out of 10.
 */
export function reportOverall(report: unknown): number | null {
  if (!report || typeof report !== 'object') return null;
  const r = report as { status?: unknown; dimensions?: unknown; score_cap?: { to?: unknown } };
  if (r.status !== 'OK') return null;
  const mean = dimensionMean(r.dimensions);
  if (mean === null) return null;
  const rounded = Math.round(mean);
  const cap = r.score_cap && typeof r.score_cap.to === 'number' && Number.isFinite(r.score_cap.to) ? r.score_cap.to : null;
  return cap !== null ? Math.min(rounded, cap) : rounded;
}

/**
 * The report for a session whose model answer had no measured skill. It carries no score (never 0), is marked
 * incomplete so the lesson shows "did not reach the target score", and is never cached: opening it again
 * (the "Try again" button) asks the model again.
 */
export function incompleteReport(metrics: Record<string, unknown>): SessionReport {
  return {
    ...insufficientReport(metrics),
    incomplete: true,
    next_focus: 'Score incomplete. We could not measure your skills from this session. Press Try again to re-check it.',
  };
}

/**
 * Final scoring step, run in code after the model answers (OK reports only).
 * - No measured skill: the answer is not a score. Returns null so the caller retries, never a fake 0.
 * - overall_score becomes the mean of the measured skills (the model's own number is ignored).
 * - goal_met "no" caps the overall at OFF_GOAL_CAP and records why.
 */
export function finaliseScores(report: SessionReport): SessionReport | null {
  if (report.status !== 'OK') return report;
  const mean = dimensionMean(report.dimensions);
  if (mean === null) return null;
  const overall = Math.round(mean);
  const goalMet = (report.lesson_result?.goal_met ?? '').trim().toLowerCase();
  const next: SessionReport = { ...report, overall_score: overall };
  delete next.score_cap;
  if (goalMet === 'no' && overall > OFF_GOAL_CAP) {
    next.score_cap = { from: overall, to: OFF_GOAL_CAP, reason: 'The lesson goal was not met, so the score is capped below the pass mark.' };
    next.overall_score = OFF_GOAL_CAP;
  }
  return next;
}
