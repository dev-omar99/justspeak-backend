import { buildStreamParams } from './deepgram.service';

describe('buildStreamParams', () => {
  const envBackup = { ...process.env };
  afterEach(() => {
    process.env = { ...envBackup };
  });

  it('uses learner-friendly defaults (long endpointing, fillers on)', () => {
    delete process.env.DEEPGRAM_ENDPOINTING_MS;
    delete process.env.DEEPGRAM_UTTERANCE_END_MS;
    const params = buildStreamParams();
    expect(params.get('model')).toBe('nova-3');
    expect(params.get('language')).toBe('en');
    expect(params.get('endpointing')).toBe('1000');
    expect(params.get('utterance_end_ms')).toBe('2000');
    expect(params.get('filler_words')).toBe('true');
    expect(params.get('interim_results')).toBe('true');
  });

  it('honors env overrides and ignores invalid values', () => {
    process.env.DEEPGRAM_ENDPOINTING_MS = '1200';
    process.env.DEEPGRAM_UTTERANCE_END_MS = '50'; // below Deepgram minimum
    const params = buildStreamParams();
    expect(params.get('endpointing')).toBe('1200');
    expect(params.get('utterance_end_ms')).toBe('2000');
  });
});
