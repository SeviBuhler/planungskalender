// The access token carries the time it was issued (iat), stamped by Supabase's login server.
// When the database server's clock runs behind that one, it answers 401 "JWT issued at future"
// until its own clock has caught up. This happens mostly right after the token was renewed,
// e.g. when the PWA comes back to the front. Waiting and sending the same request again fixes it.

// Waits between the attempts, about 30 seconds in total
export const FUTURE_JWT_DELAYS_MS = [1000, 2000, 4000, 8000, 15000];

export function isFutureJwt(body: string): boolean {
  return body.includes('issued at future');
}

export function retryFutureJwt(
  baseFetch: typeof fetch = (input, init) => fetch(input, init),
  delays: readonly number[] = FUTURE_JWT_DELAYS_MS,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
): typeof fetch {
  return async (input, init) => {
    let response = await baseFetch(input, init);
    for (const delay of delays) {
      if (response.status !== 401 || !isFutureJwt(await response.clone().text())) return response;
      if (init?.signal?.aborted) return response;
      await wait(delay);
      response = await baseFetch(input, init);
    }
    return response;
  };
}
