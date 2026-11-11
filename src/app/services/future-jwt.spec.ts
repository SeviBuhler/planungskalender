import { retryFutureJwt, sharedRenewal } from './future-jwt';

const future = () => new Response('{"code":"PGRST303","message":"JWT issued at future"}', { status: 401 });
const ok = () => new Response('[]', { status: 200 });

function fakeFetch(answer: (auth: string | null, call: number) => Response) {
  const auths: (string | null)[] = [];
  const fn = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const auth = new Headers(init?.headers).get('Authorization');
    auths.push(auth);
    return answer(auth, auths.length);
  }) as typeof fetch;
  return { fn, auths };
}

const noWait = async () => {};
const init = { headers: { Authorization: 'Bearer old', apikey: 'key' } };

describe('retryFutureJwt', () => {
  it('retries until the database clock has caught up', async () => {
    const base = fakeFetch((_, call) => (call < 4 ? future() : ok()));
    const response = await retryFutureJwt(null, base.fn, [1, 1, 1, 1, 1], noWait)('https://x', init);
    expect(response.status).toBe(200);
    expect(base.auths.length).toBe(4);
  });

  it('swaps a token from the future for a fresh one', async () => {
    const base = fakeFetch((auth) => (auth === 'Bearer new' ? ok() : future()));
    const response = await retryFutureJwt(async () => 'new', base.fn, [1, 1, 1], noWait)('https://x', init);
    expect(response.status).toBe(200);
    expect(base.auths).toEqual(['Bearer old', 'Bearer old', 'Bearer new']);
  });

  it('gives up after the last wait and returns the 401', async () => {
    const base = fakeFetch(() => future());
    const response = await retryFutureJwt(async () => null, base.fn, [1, 1], noWait)('https://x', init);
    expect(response.status).toBe(401);
    expect(base.auths.length).toBe(3);
  });

  it('does not retry other errors', async () => {
    const base = fakeFetch(() => new Response('{"message":"JWT expired"}', { status: 401 }));
    const response = await retryFutureJwt(null, base.fn, [1, 1], noWait)('https://x', init);
    expect(response.status).toBe(401);
    expect(base.auths.length).toBe(1);
  });
});

describe('sharedRenewal', () => {
  it('renews once for requests failing together', async () => {
    let calls = 0;
    const renew = sharedRenewal(async () => `t${++calls}`);
    expect(await Promise.all([renew(), renew()])).toEqual(['t1', 't1']);
    expect(calls).toBe(1);
  });
});
