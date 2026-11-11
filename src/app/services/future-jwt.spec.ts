import { retryFutureJwt } from './future-jwt';

const future = () => new Response('{"code":"PGRST303","message":"JWT issued at future"}', { status: 401 });
const ok = () => new Response('[]', { status: 200 });

function fakeFetch(responses: (() => Response)[]) {
  let calls = 0;
  const fn = (async () => responses[Math.min(calls++, responses.length - 1)]()) as typeof fetch;
  return { fn, calls: () => calls };
}

describe('retryFutureJwt', () => {
  const noWait = async () => {};

  it('retries until the database clock has caught up', async () => {
    const base = fakeFetch([future, future, future, ok]);
    const response = await retryFutureJwt(base.fn, [1, 1, 1, 1, 1], noWait)('https://x');
    expect(response.status).toBe(200);
    expect(base.calls()).toBe(4);
  });

  it('gives up after the last wait and returns the 401', async () => {
    const base = fakeFetch([future]);
    const response = await retryFutureJwt(base.fn, [1, 1], noWait)('https://x');
    expect(response.status).toBe(401);
    expect(base.calls()).toBe(3);
  });

  it('does not retry other errors', async () => {
    const base = fakeFetch([() => new Response('{"message":"JWT expired"}', { status: 401 }), ok]);
    const response = await retryFutureJwt(base.fn, [1, 1], noWait)('https://x');
    expect(response.status).toBe(401);
    expect(base.calls()).toBe(1);
  });
});
