// The access token carries the time it was issued (iat), stamped by Supabase's login server.
// The database answers 401 "JWT issued at future" while that time lies ahead of its own clock.
// Two cases:
// - the clocks differ by a few seconds right after the token was renewed: waiting helps;
// - the login server handed out a token with a time too far ahead (seen 2026-11-11):
//   the stored token stays unusable until it expires, so the app has to get a new one.
// So: retry once after a short wait, then fetch a fresh token and send the request with it,
// then keep retrying with longer waits.

// Waits between the attempts, about 30 seconds in total
export const FUTURE_JWT_DELAYS_MS = [1000, 2000, 4000, 8000, 15000];
// After this many failed attempts a fresh token is fetched
const RENEW_AFTER = 2;

export function isFutureJwt(body: string): boolean {
  return body.includes('issued at future');
}

// Returns a new access token, or null when none could be had
export type RenewToken = () => Promise<string | null>;

export function retryFutureJwt(
  renew: RenewToken | null = null,
  baseFetch: typeof fetch = (input, init) => fetch(input, init),
  delays: readonly number[] = FUTURE_JWT_DELAYS_MS,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
): typeof fetch {
  return async (input, init) => {
    let response = await baseFetch(input, init);
    let attempts = 1;
    for (const delay of delays) {
      if (response.status !== 401 || !isFutureJwt(await response.clone().text())) return response;
      if (init?.signal?.aborted) return response;
      if (attempts === RENEW_AFTER && renew) {
        const token = await renew().catch(() => null);
        const headers = new Headers(init?.headers);
        if (token && headers.has('Authorization')) {
          headers.set('Authorization', `Bearer ${token}`);
          init = { ...init, headers };
        }
      } else {
        await wait(delay);
      }
      response = await baseFetch(input, init);
      attempts++;
    }
    return response;
  };
}

// Several requests failing at once share one renewal
export function sharedRenewal(renew: RenewToken, reuseMs = 10_000): RenewToken {
  let current: Promise<string | null> | null = null;
  return () => {
    if (!current) {
      current = renew().catch(() => null);
      setTimeout(() => (current = null), reuseMs);
    }
    return current;
  };
}
