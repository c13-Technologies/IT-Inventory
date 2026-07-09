// views/lib/loginGuard.js
//
// In-memory per-IP login guard.
//   - soft throttle: token bucket — 5/min (capacity 5, refill 1 per 12s)
//   - hard lockout: 10 cumulative failed attempts in a row -> 15-min block
// State is keyed by `req.ip`. The bucket + counter reset on a successful
// login. Stale entries (untouched > 30 min) are swept opportunistically to
// keep memory bounded.
//
// Design notes:
//   - No clock skew tolerance beyond the small refill rounding.
//   - Lockout duration does NOT grow on repeated lockouts (per spec). If
//     attacker patterns warrant it later, add a `lockCount` field and
//     exponential backoff (e.g. 15m, 1h, 24h, 7d).
//   - Implicit trust-proxy caveat: `req.ip` defaults to the TCP peer. If
//     deployed behind a reverse proxy, set `app.set('trust proxy', ...)`
//     before invoking loginGuard. Otherwise every request looks like it
//     came from the proxy IP and bypasses per-IP throttling.
//
// Stages for an IP across attempts:
//   fresh           -> tokens=5, counter=0
//   failed #1-4     -> tokens=4..1, counter=1..4 (bucket drains fast)
//   failed #5       -> tokens=0 (bucket empty, throttle shows on next hit)
//   failed #6-9     -> counter climbs to 9 (still throttled via bucket)
//   failed #10      -> PROMOTED to lockout for 15 min (counter resets to 0)
//   any success     -> full reset
//   expiry          -> after 15 min, counter back to 0, bucket refilled

'use strict';

const BUCKET_CAPACITY     = 5;
const REFILL_INTERVAL_MS  = 12_000;   // 5 tokens/min refilled 1 per 12s
const FAIL_LOCK_THRESHOLD = 10;
const LOCK_DURATION_MS    = 15 * 60_000;
const ENTRY_TTL_MS        = 30 * 60_000; // purge entries idle > 30 min
const SWEEP_EVERY_N       = 50;       // opportunistic sweep cadence

const _buckets = new Map(); // ip -> entry
let _accessesSinceSweep = 0;

function newEntry(now) {
  return {
    tokens:           BUCKET_CAPACITY,
    lastRefillAt:      now,
    failedSinceReset:  0,
    lockedUntil:       null,
    lastTouchAt:       now,
  };
}

// Step 1: refill tokens based on elapsed wall-clock time. Doesn't decrement.
function refill(entry, now) {
  const elapsed = now - entry.lastRefillAt;
  if (elapsed <= 0) return;
  const tokens = Math.floor(elapsed / REFILL_INTERVAL_MS);
  if (tokens > 0) {
    entry.tokens = Math.min(BUCKET_CAPACITY, entry.tokens + tokens);
    entry.lastRefillAt += tokens * REFILL_INTERVAL_MS;
  }
}

function maybeSweep(now) {
  if (++_accessesSinceSweep < SWEEP_EVERY_N) return;
  _accessesSinceSweep = 0;
  const cutoff = now - ENTRY_TTL_MS;
  for (const [ip, entry] of _buckets) {
    if (entry.lastTouchAt < cutoff) _buckets.delete(ip);
  }
}

// Decide whether the next attempt is allowed. NEVER decrements — call
// recordFail() after a real failed attempt.
//
// Returns:
//   { allowed: true }
//   { allowed: false, endsAt: Date, reason: 'locked' | 'throttled' }
function check(ip) {
  const now = Date.now();
  const key = ip || 'unknown';
  const entry = _buckets.get(key) || newEntry(now);
  _buckets.set(key, entry);
  entry.lastTouchAt = now;
  maybeSweep(now);

  // Hard lockout takes precedence.
  if (entry.lockedUntil && entry.lockedUntil > now) {
    return { allowed: false, endsAt: new Date(entry.lockedUntil), reason: 'locked' };
  }
  if (entry.lockedUntil && entry.lockedUntil <= now) {
    // Expired — full reset on access.
    entry.lockedUntil      = null;
    entry.failedSinceReset = 0;
    entry.tokens          = BUCKET_CAPACITY;
    entry.lastRefillAt     = now;
  }
  refill(entry, now);
  if (entry.tokens <= 0) {
    return { allowed: false, endsAt: new Date(now + REFILL_INTERVAL_MS), reason: 'throttled' };
  }
  return { allowed: true };
}

// Called on failed credential (bcrypt mismatch OR user not found). Consumes
// one token, increments the cumulative counter, and promotes to lockout once
// the threshold is reached.
//
// Returns the resulting { tokensLeft, failedSinceReset, lockedUntil }. The
// caller doesn't need these values today — they're returned so future hooks
// (e.g. exponential backoff, audit-log escalation) can consume them.
function recordFail(ip) {
  const now = Date.now();
  const key = ip || 'unknown';
  const entry = _buckets.get(key) || newEntry(now);
  _buckets.set(key, entry);
  entry.lastTouchAt = now;
  refill(entry, now);
  entry.tokens          = Math.max(0, entry.tokens - 1);
  entry.failedSinceReset = entry.failedSinceReset + 1;
  if (entry.failedSinceReset >= FAIL_LOCK_THRESHOLD) {
    entry.lockedUntil       = now + LOCK_DURATION_MS;
    entry.failedSinceReset  = 0; // counter resets; the lockout itself is the new state
    entry.tokens            = 0; // No frees: the next refresh starts at the lockout end
    entry.lastRefillAt      = now + LOCK_DURATION_MS;
    console.warn(`[loginGuard] IP ${key} locked out for 15 min after ${FAIL_LOCK_THRESHOLD} failed attempts`);
  }
  return {
    tokensLeft:       entry.tokens,
    failedSinceReset: entry.failedSinceReset,
    lockedUntil:      entry.lockedUntil ? new Date(entry.lockedUntil) : null,
  };
}

// Success path — full reset.
function clearOnSuccess(ip) {
  _buckets.delete(ip || 'unknown');
}

// Diagnostic only. Returned for a test-helper route, not used in production.
function _getEntry(ip) {
  return _buckets.get(ip || 'unknown');
}

module.exports = {
  check,
  recordFail,
  clearOnSuccess,
  config: {
    BUCKET_CAPACITY, REFILL_INTERVAL_MS,
    FAIL_LOCK_THRESHOLD, LOCK_DURATION_MS,
  },
  _getEntry,
};
