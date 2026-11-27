/**
 * Single-admin policy.
 *
 * JustSpeak has exactly one administrator: the account whose email matches
 * the ADMIN_EMAIL environment variable. This module is the single source of
 * truth for that rule. It is a plain function module (no NestJS imports) so
 * both the auth flows (login/signup sync) and the AdminGuard can use it
 * without creating module cycles.
 *
 * When ADMIN_EMAIL is unset the policy fails closed: nobody is an admin.
 */

/** The configured admin email, normalized for comparison. */
export function getAdminEmail(): string | null {
  const value = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  return value || null;
}

/** True when the given email belongs to the one configured administrator. */
export function isAdminEmail(email: string | null | undefined): boolean {
  const adminEmail = getAdminEmail();
  if (!adminEmail || !email) {
    return false;
  }
  return email.trim().toLowerCase() === adminEmail;
}
