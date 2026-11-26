/**
 * Normalize the app's profile level labels to the CEFR bands the persona
 * prompts are written against. The profile stores labels like "Advanced";
 * the prompt bands are A1..C2, and an unrecognized label silently weakened
 * level matching in the live conversation.
 */
const LABEL_TO_CEFR: Record<string, string> = {
  beginner: 'A2',
  elementary: 'A2',
  intermediate: 'B1',
  'upper-intermediate': 'B2',
  advanced: 'C1',
  fluent: 'C2',
};

export function normalizeCefrLevel(raw: string | null | undefined): string {
  const value = (raw ?? '').trim();
  if (!value) return 'B1';
  const cefr = value.toUpperCase();
  if (/^[ABC][12]$/.test(cefr)) return cefr;
  const mapped = LABEL_TO_CEFR[value.toLowerCase()];
  return mapped ?? 'B1';
}
