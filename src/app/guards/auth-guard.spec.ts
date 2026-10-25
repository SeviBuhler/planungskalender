import { TestBed } from '@angular/core/testing';
import { CanActivateFn, UrlTree, provideRouter } from '@angular/router';

import { authGuard } from './auth-guard';
import { Supabase } from '../services/supabase';

describe('authGuard', () => {
  let session: object | null;

  const executeGuard: CanActivateFn = (...guardParameters) =>
    TestBed.runInInjectionContext(() => authGuard(...guardParameters));

  beforeEach(() => {
    session = null;
    const fakeSupabase = {
      // like the real service: the session at app start was empty
      sessionReady: Promise.resolve(null),
      client: { auth: { getSession: async () => ({ data: { session } }) } },
    };
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: Supabase, useValue: fakeSupabase }],
    });
  });

  it('lets a user through right after logging in', async () => {
    session = { access_token: 'token' };
    expect(await executeGuard({} as never, {} as never)).toBe(true);
  });

  it('redirects to /login without a session', async () => {
    const result = await executeGuard({} as never, {} as never);
    expect(result instanceof UrlTree && result.toString()).toBe('/login');
  });
});
