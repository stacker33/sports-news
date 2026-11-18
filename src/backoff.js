// How long to leave a failing source alone.
//
// Before: any failure meant a flat 15-minute cooldown, forever. A source that answers 403 ("no") was asked 96 times a day for as long as it
// failed (ghanasoccernet: 980 times in a row, about 10 days). Now the wait depends on what the server said:
//
//   transient  5xx, timeout, network error, an invalid feed        unchanged: 15 minutes (a flat cooldown, as before)
//   rate       429                                                 15 min, doubling per consecutive 429, at most 3 h; a Retry-After header
//                                                                  is respected (at most 12 h) and is never shorter than the doubling
//   access     401, 403, 404, 410 (the server says no / not here)  15 min for the first two failures and for the first hour of failing;
//                                                                  then 30 min doubling per consecutive failure, at most 24 h
//
// Never disabled: the longest wait is 24 hours, so a parked source is asked again every day, and one success resets everything (the caller
// replaces the record). A new source, or one that fails for a short while, keeps the old 15 minutes: the wait grows only after three failures
// of the same kind spread over at least an hour.
const MIN = 60e3;
export const BASE_MS = 15 * MIN; // the cooldown src/collect.js always used
export const RATE_CAP_MS = 3 * 60 * MIN;
export const RETRY_AFTER_CAP_MS = 12 * 60 * MIN;
export const ACCESS_CAP_MS = 24 * 60 * MIN;
export const ACCESS_AFTER_FAILURES = 3;
export const ACCESS_AFTER_MS = 60 * MIN;

// Retry-After: seconds, or an HTTP date. -> ms to wait from now, or null
export function parseRetryAfter(value, now = Date.now()) {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) return Math.min(Number(s) * 1000, 30 * 864e5);
  const t = Date.parse(s);
  return Number.isFinite(t) ? Math.max(0, Math.min(t - now, 30 * 864e5)) : null;
}

// error: what fetchFeed threw (`status`, `retryAfter` when it was an HTTP answer; the message "HTTP 403" otherwise)
export function failureKind(error) {
  const status = Number(error?.status) || Number(/^HTTP (\d{3})/.exec(String(error?.message || error))?.[1]) || 0;
  if (status === 429) return 'rate';
  if ([401, 403, 404, 410].includes(status)) return 'access';
  return 'transient';
}

// the cooldown (ms) after this failure; streak = consecutive failures of this kind including this one, failingForMs = time since the first
export function cooldownMs({ kind, streak, failingForMs, retryAfterMs = null }) {
  if (kind === 'rate') {
    const doubling = Math.min(RATE_CAP_MS, BASE_MS * 2 ** Math.max(0, streak - 1));
    return retryAfterMs != null ? Math.max(doubling, Math.min(retryAfterMs, RETRY_AFTER_CAP_MS)) : doubling;
  }
  if (kind === 'access' && streak >= ACCESS_AFTER_FAILURES && failingForMs >= ACCESS_AFTER_MS) return Math.min(ACCESS_CAP_MS, 2 * BASE_MS * 2 ** (streak - ACCESS_AFTER_FAILURES));
  return BASE_MS;
}

// The saved record of a source after a failed fetch. prev: its record before (or undefined), error: what was thrown.
// Records saved before this change have no failKind / kindStreak / failSince: they are derived from the old failStreak and error text, so an
// old record of a long-dead source goes straight to the long wait, and one that has only just started failing does not.
export function recordFailure(prev = {}, error, now) {
  const kind = failureKind(error);
  const sameKind = prev.ok === false && (prev.failKind ?? failureKind({ message: prev.error })) === kind;
  const prevStreak = sameKind ? (prev.kindStreak ?? prev.failStreak ?? 0) : 0;
  const streak = prevStreak + 1;
  const failSince = sameKind ? (prev.failSince ?? now - (prev.failStreak || 0) * BASE_MS) : now;
  const retryAfterMs = Number.isFinite(error?.retryAfter) ? error.retryAfter : null;
  const wait = cooldownMs({ kind, streak, failingForMs: now - failSince, retryAfterMs });
  return {
    ...prev,
    last: now,
    ok: false,
    error: String(error?.message || error).slice(0, 120),
    cooldownUntil: now + wait,
    failStreak: (prev.failStreak || 0) + 1,
    failKind: kind,
    kindStreak: streak,
    failSince,
  };
}
