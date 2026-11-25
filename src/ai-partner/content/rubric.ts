/**
 * JustSpeak AI Partner - feedback and scoring rubric (v1).
 * Used by the post-session report generator (Claude Sonnet) and the
 * placement-level check (Claude Opus). Input is the full transcript plus
 * the metrics JSON computed from the Deepgram stream.
 */

export const FEEDBACK_RUBRIC_PROMPT = `You are the JustSpeak speaking assessor. You receive the full transcript of a live English practice session and a metrics JSON computed from the audio stream. Score honestly.

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

4. Pronunciation and clarity (proxy from speech recognition)
   Use the STT word-confidence average and low-confidence word clusters.
   90-100: nearly all words recognised confidently on first pass.
   70-89: occasional unclear words, meaning always recoverable.
   50-69: frequent low-confidence stretches.

5. Interaction
   90-100: full answers, asks back, natural turn-taking.
   70-89: answers fully but rarely asks back.
   50-69: minimal answers, needs constant prompting.

CEFR ESTIMATE
   Map the overall score to a level estimate relative to the student's declared level:
   85+ suggest testing one level up; 60-84 on track; 40-59 consolidate current level; below 40 suggest one level down.
   State this as an estimate, never a certification.

HONESTY RULES (non-negotiable)
   - Never inflate a score to please the student.
   - Every reported mistake must quote the student's exact words from the transcript. If you cannot quote it, do not report it.
   - If student speech totals under 3 minutes, do not score. Return status INSUFFICIENT_DATA with a friendly note to try a longer session.

Respond ONLY with valid JSON (no markdown fences) matching exactly:
{
  "status": "OK" or "INSUFFICIENT_DATA",
  "overall_score": 0,
  "cefr_estimate": "B1",
  "dimensions": {
    "grammar": 0,
    "vocabulary": 0,
    "fluency": 0,
    "pronunciation": 0,
    "interaction": 0
  },
  "metrics_echo": {
    "student_speech_sec": 0,
    "words_per_minute": 0,
    "fillers_per_minute": 0,
    "student_talk_ratio": 0.0
  },
  "top_mistakes": [
    { "said": "exact quote", "better": "corrected version", "rule": "one-line explanation" }
  ],
  "strengths": ["one line each"],
  "next_focus": "the single most useful thing to practise next",
  "suggested_lessons": ["lesson ids from the course map, or empty array"]
}`;

export interface SessionReport {
  status: 'OK' | 'INSUFFICIENT_DATA';
  overall_score: number;
  cefr_estimate: string;
  dimensions: {
    grammar: number;
    vocabulary: number;
    fluency: number;
    pronunciation: number;
    interaction: number;
  };
  metrics_echo: {
    student_speech_sec: number;
    words_per_minute: number;
    fillers_per_minute: number;
    student_talk_ratio: number;
  };
  top_mistakes: { said: string; better: string; rule: string }[];
  strengths: string[];
  next_focus: string;
  suggested_lessons: string[];
}

export function clampScore(value: unknown): number {
  const num = typeof value === 'number' ? value : Number(value);
  if (Number.isNaN(num)) return 0;
  return Math.max(0, Math.min(100, Math.round(num)));
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
  return {
    status,
    overall_score: clampScore(parsed.overall_score),
    cefr_estimate: typeof parsed.cefr_estimate === 'string' ? parsed.cefr_estimate : '',
    dimensions: {
      grammar: clampScore(dims.grammar),
      vocabulary: clampScore(dims.vocabulary),
      fluency: clampScore(dims.fluency),
      pronunciation: clampScore(dims.pronunciation),
      interaction: clampScore(dims.interaction),
    },
    metrics_echo: {
      student_speech_sec: Number(metrics.student_speech_sec) || 0,
      words_per_minute: Number(metrics.words_per_minute) || 0,
      fillers_per_minute: Number(metrics.fillers_per_minute) || 0,
      student_talk_ratio: Number(metrics.student_talk_ratio) || 0,
    },
    top_mistakes: Array.isArray(parsed.top_mistakes)
      ? parsed.top_mistakes
          .filter((m: any) => m && typeof m.said === 'string' && m.said.trim())
          .slice(0, 5)
          .map((m: any) => ({
            said: String(m.said),
            better: typeof m.better === 'string' ? m.better : '',
            rule: typeof m.rule === 'string' ? m.rule : '',
          }))
      : [],
    strengths: Array.isArray(parsed.strengths)
      ? parsed.strengths.filter((s: any) => typeof s === 'string').slice(0, 5)
      : [],
    next_focus: typeof parsed.next_focus === 'string' ? parsed.next_focus : '',
    suggested_lessons: Array.isArray(parsed.suggested_lessons)
      ? parsed.suggested_lessons.filter((s: any) => typeof s === 'string')
      : [],
  };
}
