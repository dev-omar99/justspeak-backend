import { buildPersonaSystemPrompt, getPersona, PERSONAS } from './content/personas';
import { parseSessionReport, clampScore } from './content/rubric';
import { getInterviewField, INTERVIEW_FIELDS } from './content/interview-bank';
import { getLesson, HALF_LEVELS, SAMPLE_LESSONS } from './content/course';

describe('AI Partner content', () => {
  it('ships 4 personas with voice env vars', () => {
    expect(PERSONAS).toHaveLength(4);
    for (const persona of PERSONAS) {
      expect(persona.voiceEnvVar).toMatch(/^ELEVENLABS_VOICE_/);
      expect(persona.prompt.length).toBeGreaterThan(100);
    }
  });

  it('builds a system prompt with name and level injected', () => {
    const prompt = buildPersonaSystemPrompt(getPersona('sara'), 'Omar', 'B1');
    expect(prompt).toContain('Omar');
    expect(prompt).toContain('B1');
    expect(prompt).not.toContain('{NAME}');
    expect(prompt).not.toContain('{LEVEL}');
  });

  it('falls back to the first persona for unknown ids', () => {
    expect(getPersona('nobody').id).toBe(PERSONAS[0].id);
  });

  it('ships 3 interview fields with 15 questions each', () => {
    expect(INTERVIEW_FIELDS.map((f) => f.id)).toEqual([
      'software',
      'customer-service',
      'sales',
    ]);
    for (const field of INTERVIEW_FIELDS) {
      expect(field.questions).toHaveLength(15);
      for (const q of field.questions) {
        expect(q.probe.length).toBeGreaterThan(5);
      }
    }
    expect(getInterviewField('sales')?.title).toBe('Sales');
  });

  it('ships the 12 half-level course map and 3 sample lessons', () => {
    expect(HALF_LEVELS).toHaveLength(12);
    expect(SAMPLE_LESSONS).toHaveLength(3);
    expect(getLesson('A1.1-01')?.persona).toBe('sara');
    expect(getLesson('missing')).toBeNull();
  });
});

describe('rubric parsing', () => {
  it('clamps scores into 0..100', () => {
    expect(clampScore(120)).toBe(100);
    expect(clampScore(-5)).toBe(0);
    expect(clampScore('55')).toBe(55);
    expect(clampScore('junk')).toBe(0);
  });

  it('parses a valid report and drops unquotable mistakes', () => {
    const raw = JSON.stringify({
      status: 'OK',
      overall_score: 74,
      cefr_estimate: 'B1',
      dimensions: { grammar: 70, vocabulary: 80, fluency: 66, pronunciation: 90, interaction: 60 },
      metrics_echo: { student_speech_sec: 420, words_per_minute: 95, fillers_per_minute: 4, student_talk_ratio: 0.65 },
      corrections: [
        { said: 'I goed to work', better: 'I went to work', rule: 'past simple of go', explanation_ar: 'تصحيح' },
        { said: '', better: 'x', rule: 'no quote' },
      ],
      strengths: ['Clear answers'],
      next_focus: 'Past simple irregulars',
      suggested_lessons: ['B1.2-14'],
    });
    const report = parseSessionReport(raw);
    expect(report).not.toBeNull();
    expect(report!.overall_score).toBe(74);
    expect(report!.corrections).toHaveLength(1);
    expect(report!.status).toBe('OK');
  });

  it('returns null for non-JSON output', () => {
    expect(parseSessionReport('no json here')).toBeNull();
  });

  it('handles INSUFFICIENT_DATA status', () => {
    const report = parseSessionReport(JSON.stringify({ status: 'INSUFFICIENT_DATA' }));
    expect(report?.status).toBe('INSUFFICIENT_DATA');
  });
});
