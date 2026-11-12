// Password complexity rule, checked in the browser for a friendly message
// before anything is sent. The server enforces the same rule on its own
// (pb_migrations/1790300000_user_surname_password_policy.js), so a password
// set any other way — the PocketBase dashboard, the API, the "forgot
// password" link — can't bypass it either. Keep the two in step.

export const PASSWORD_MIN_LENGTH = 8;

const RULES = [
  { label: `at least ${PASSWORD_MIN_LENGTH} characters`, test: (p) => p.length >= PASSWORD_MIN_LENGTH },
  { label: 'an uppercase letter', test: (p) => /[A-Z]/.test(p) },
  { label: 'a lowercase letter', test: (p) => /[a-z]/.test(p) },
  { label: 'a number', test: (p) => /[0-9]/.test(p) },
  // Anything that isn't an unaccented letter or digit counts as a symbol.
  { label: 'a symbol (e.g. ! @ # -)', test: (p) => /[^A-Za-z0-9]/.test(p) },
];

export const PASSWORD_HINT =
  `At least ${PASSWORD_MIN_LENGTH} characters, with an uppercase letter, a lowercase letter, a number and a symbol.`;

// null when the password is acceptable, otherwise a sentence naming
// everything it's missing.
export function passwordProblem(password) {
  const missing = RULES.filter((r) => !r.test(password || '')).map((r) => r.label);
  if (!missing.length) return null;
  const list = missing.length === 1 ? missing[0] : `${missing.slice(0, -1).join(', ')} and ${missing.at(-1)}`;
  return `Password needs ${list}.`;
}

// A random password that always passes the rule — for temporary
// passwords handed out by tools (e.g. the Supabase import).
export function generatePassword(length = 14) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%*-_+=?';
  for (;;) {
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(length));
    const candidate = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
    if (!passwordProblem(candidate)) return candidate;
  }
}
