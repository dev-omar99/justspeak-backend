/**
 * Central configuration for the AI Partner feature.
 * Everything is opt-in: with JUSTSPEAK_AI_ENABLED unset the module boots
 * but every endpoint answers 503 and the gateway rejects sessions.
 */

export function aiPartnerEnabled(): boolean {
  return process.env.JUSTSPEAK_AI_ENABLED?.trim().toLowerCase() === 'true';
}

export function anthropicApiKey(): string | null {
  return process.env.ANTHROPIC_API_KEY?.trim() || null;
}

export function deepgramApiKey(): string | null {
  return process.env.DEEPGRAM_API_KEY?.trim() || null;
}

export function elevenLabsApiKey(): string | null {
  return process.env.ELEVENLABS_API_KEY?.trim() || null;
}

/** Live conversation model. Default matches the plan: Claude Haiku. */
export function liveModel(): string {
  return process.env.AI_PARTNER_LIVE_MODEL?.trim() || 'claude-haiku-4-5';
}

/** Post-session report model. Default matches the plan: Claude Sonnet. */
export function feedbackModel(): string {
  return process.env.AI_PARTNER_FEEDBACK_MODEL?.trim() || 'claude-sonnet-4-5';
}

/** Placement / level-check model. Default: Claude Opus. */
export function placementModel(): string {
  return process.env.AI_PARTNER_PLACEMENT_MODEL?.trim() || 'claude-opus-4-5';
}

export function elevenLabsModelId(): string {
  return process.env.ELEVENLABS_MODEL_ID?.trim() || 'eleven_turbo_v2_5';
}

export function elevenLabsVoiceId(envVar: string): string | null {
  return process.env[envVar]?.trim() || null;
}

/** Free plan: 5 lifetime AI sessions (Omar's decision, matching Yoodli's free tier). */
export function freeSessionQuota(): number {
  const parsed = parseInt(process.env.AI_PARTNER_FREE_SESSIONS ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5;
}

/** Paid plans: sessions per day. Defaults documented in .env.example. */
export function paidDailySessionQuota(planTier: string): number {
  const plus = parseInt(process.env.AI_PARTNER_PLUS_DAILY_SESSIONS ?? '', 10);
  const elite = parseInt(process.env.AI_PARTNER_ELITE_DAILY_SESSIONS ?? '', 10);
  if (planTier === 'ELITE') {
    return Number.isFinite(elite) && elite > 0 ? elite : 30;
  }
  if (planTier === 'PLUS') {
    return Number.isFinite(plus) && plus > 0 ? plus : 10;
  }
  return 0;
}

/** Hard cap on one live session, whatever the plan. */
export function maxSessionMinutes(): number {
  const parsed = parseInt(process.env.AI_PARTNER_MAX_SESSION_MINUTES ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 20;
}
