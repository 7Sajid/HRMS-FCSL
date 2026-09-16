import type { Role } from "@prisma/client";

/**
 * Password policy, and the generator HR reads down a phone.
 *
 * §4 step 2 is specific: the temporary password is "sent to the person
 * manually" — by hand, by phone, or in the joining meeting, never by automatic
 * email. Sending a first password by email means anyone who can read that
 * inbox can become that employee. The cost of the choice is that a human has
 * to say the password out loud, which is why the alphabet below matters.
 */

export const MIN_PASSWORD_LENGTH = 8;

/**
 * HR and above hold the keys to four hundred employee files. Twelve, not eight.
 */
export const MIN_STAFF_PASSWORD_LENGTH = 12;

export const MAX_PASSWORD_LENGTH = 200;

const STAFF_ROLES: readonly Role[] = ["SUPER_ADMIN", "HR_HEAD", "HR_EXECUTIVE"];

export function minPasswordLength(role: Role): number {
  return STAFF_ROLES.includes(role) ? MIN_STAFF_PASSWORD_LENGTH : MIN_PASSWORD_LENGTH;
}

export function passwordHint(role: Role): string {
  return `At least ${minPasswordLength(role)} characters.`;
}

/**
 * Returns a sentence to show the person, or null if the password is fine.
 *
 * Deliberately not a list of composition rules — no "one uppercase, one digit,
 * one symbol". Those push people towards Password1! and towards writing it on
 * the monitor. Length is the requirement that actually helps.
 */
export function validatePassword(password: string, role: Role): string | null {
  const min = minPasswordLength(role);
  if (password.length < min) return `Password must be at least ${min} characters.`;
  if (password.length > MAX_PASSWORD_LENGTH) return "Password is too long.";
  if (/^(.)\1*$/.test(password)) return "Please choose something less predictable.";
  return null;
}

/**
 * The alphabet is dictation-safe: 0 O o 1 l I are all absent.
 *
 * An HR Executive reads this password to a new joiner over the phone. "Is that
 * a one or an ell" is not a security question, but a password that has to be
 * reissued twice is one that ends up written on a sticky note instead.
 */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";

export function generatePassword(length = 16): string {
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < length; i += 1) {
    // Modulo bias across 2^32 over a 54-character alphabet is far below any
    // threshold that matters for a password of this length.
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}

/**
 * Group into fours — "kR7m Xp2q Wd9n Bt4v". Nobody reads a sixteen-character
 * run aloud correctly, and the spaces are not part of the password.
 */
export function forDictation(password: string): string {
  return password.replace(/(.{4})/g, "$1 ").trim();
}
