import {
  PronunciationService,
  pcmToWav,
  summarizePronunciation,
  UtteranceAssessment,
} from './pronunciation.service';

const SAMPLE_PCM = Buffer.alloc(16000 * 2 * 2); // 2 seconds of silence

function azureResponse(overrides: Record<string, unknown> = {}) {
  return {
    RecognitionStatus: 'Success',
    NBest: [
      {
        AccuracyScore: 78,
        FluencyScore: 85,
        CompletenessScore: 99,
        ProsodyScore: 70,
        PronScore: 80.6,
        Words: [
          {
            Word: 'comfortable',
            PronunciationAssessment: { AccuracyScore: 52, ErrorType: 'Mispronunciation' },
            Phonemes: [
              { Phoneme: 'k', PronunciationAssessment: { AccuracyScore: 40 } },
              { Phoneme: 'ah', PronunciationAssessment: { AccuracyScore: 91 } },
            ],
          },
          {
            Word: 'fine',
            PronunciationAssessment: { AccuracyScore: 96, ErrorType: 'None' },
            Phonemes: [],
          },
        ],
        ...overrides,
      },
    ],
  };
}

describe('pcmToWav', () => {
  it('writes a valid 44-byte RIFF header for 16kHz mono PCM', () => {
    const wav = pcmToWav(SAMPLE_PCM);
    expect(wav.length).toBe(44 + SAMPLE_PCM.length);
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
    expect(wav.readUInt32LE(24)).toBe(16000); // sample rate
    expect(wav.readUInt16LE(22)).toBe(1); // mono
    expect(wav.readUInt16LE(34)).toBe(16); // bits
    expect(wav.readUInt32LE(40)).toBe(SAMPLE_PCM.length);
  });
});

describe('summarizePronunciation', () => {
  it('returns null with no results', () => {
    expect(summarizePronunciation([])).toBeNull();
  });

  it('weights averages by duration and keeps worst words with weak phonemes', () => {
    const results: UtteranceAssessment[] = [
      {
        referenceText: 'a', accuracy: 80, fluency: 90, completeness: 100,
        prosody: 70, pronScore: 84, durationSec: 2,
        words: [
          { word: 'Comfortable', accuracy: 50, errorType: 'Mispronunciation',
            phonemes: [{ phoneme: 'k', accuracy: 40 }] },
          { word: 'good', accuracy: 99, errorType: null, phonemes: [] },
        ],
      },
      {
        referenceText: 'b', accuracy: 90, fluency: 80, completeness: 90,
        prosody: null, pronScore: 88, durationSec: 1,
        words: [
          { word: 'comfortable', accuracy: 60, errorType: null,
            phonemes: [{ phoneme: 'ah', accuracy: 55 }] },
        ],
      },
    ];
    const s = summarizePronunciation(results);
    expect(s).not.toBeNull();
    expect(s!.utterances).toBe(2);
    expect(s!.wordsAssessed).toBe(3);
    expect(s!.accuracy).toBeCloseTo((80 * 2 + 90 * 1) / 3, 1);
    // prosody only over the utterance that has it
    expect(s!.prosody).toBe(70);
    // worst word deduped, lowest accuracy kept, weak phonemes merged
    expect(s!.worstWords).toHaveLength(1);
    expect(s!.worstWords[0].word).toBe('Comfortable');
    expect(s!.worstWords[0].accuracy).toBe(50);
    expect(s!.worstWords[0].weakPhonemes).toEqual(expect.arrayContaining(['k', 'ah']));
  });
});

describe('PronunciationService.assessUtterance', () => {
  const originalFetch = global.fetch;
  const env = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = {
      ...env,
      AZURE_SPEECH_PRONUNCIATION_ENABLED: 'true',
      AZURE_SPEECH_KEY: 'test-key',
      AZURE_SPEECH_REGION: 'eastus',
    };
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env = env;
  });

  it('returns null without an Azure key and never calls fetch', async () => {
    delete process.env.AZURE_SPEECH_KEY;
    global.fetch = jest.fn() as any;
    const service = new PronunciationService();
    expect(await service.assessUtterance(SAMPLE_PCM, 'hello there')).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('skips utterances shorter than 0.4s of audio', async () => {
    global.fetch = jest.fn() as any;
    const service = new PronunciationService();
    expect(await service.assessUtterance(Buffer.alloc(100), 'hi')).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('parses phoneme-level results from a successful Azure response', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => azureResponse(),
    }) as any;
    const service = new PronunciationService();
    const result = await service.assessUtterance(SAMPLE_PCM, 'I am comfortable and fine');
    expect(result).not.toBeNull();
    expect(result!.accuracy).toBe(78);
    expect(result!.prosody).toBe(70);
    expect(result!.words).toHaveLength(2);
    expect(result!.words[0].errorType).toBe('Mispronunciation');
    expect(result!.words[0].phonemes[0].phoneme).toBe('k');
    expect(result!.words[1].errorType).toBeNull();

    const [, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(init.headers['Ocp-Apim-Subscription-Key']).toBe('test-key');
    const pa = JSON.parse(
      Buffer.from(init.headers['Pronunciation-Assessment'], 'base64').toString(),
    );
    expect(pa.ReferenceText).toBe('I am comfortable and fine');
    expect(pa.Granularity).toBe('Phoneme');
  });

  it('returns null on HTTP 400 without retrying', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => 'bad request',
    }) as any;
    const service = new PronunciationService();
    expect(await service.assessUtterance(SAMPLE_PCM, 'hello there')).toBeNull();
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('retries once on 429 then gives up with null', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => 'rate limited',
    }) as any;
    const service = new PronunciationService();
    expect(await service.assessUtterance(SAMPLE_PCM, 'hello there')).toBeNull();
    expect(global.fetch).toHaveBeenCalledTimes(2);
  }, 15000);

  it('recovers when the retry succeeds', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 503, text: async () => 'down' })
      .mockResolvedValueOnce({ ok: true, json: async () => azureResponse() }) as any;
    const service = new PronunciationService();
    const result = await service.assessUtterance(SAMPLE_PCM, 'hello there');
    expect(result).not.toBeNull();
    expect(global.fetch).toHaveBeenCalledTimes(2);
  }, 15000);

  it('returns null when recognition status is not Success', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ RecognitionStatus: 'NoMatch' }),
    }) as any;
    const service = new PronunciationService();
    expect(await service.assessUtterance(SAMPLE_PCM, 'hello there')).toBeNull();
  });

  it('caps concurrency at AZURE_SPEECH_MAX_CONCURRENT', async () => {
    process.env.AZURE_SPEECH_MAX_CONCURRENT = '2';
    let resolveGate: (() => void) | null = null;
    const gate = new Promise<void>((r) => (resolveGate = r));
    let calls = 0;
    global.fetch = jest.fn().mockImplementation(async () => {
      calls += 1;
      await gate;
      return { ok: true, json: async () => azureResponse() };
    }) as any;
    const service = new PronunciationService();
    const pending = Array.from({ length: 4 }, () =>
      service.assessUtterance(SAMPLE_PCM, 'hello there'),
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(calls).toBe(2); // only 2 running, the rest queued
    resolveGate!();
    await Promise.all(pending);
    expect(calls).toBe(4);
  });
});
