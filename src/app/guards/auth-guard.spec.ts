import { TestBed } from '@angular/core/testing';
import { CanActivateFn, UrlTree, provideRouter } from '@angular/router';

import { authGuard } from './auth-guard';
import { Supabase } from '../services/supabase';
import { TrustState } from '../features/auth/trust';

describe('authGuard', () => {
  let trust: TrustState;

  const executeGuard: CanActivateFn = (...guardParameters) =>
    TestBed.runInInjectionContext(() => authGuard(...guardParameters));

  beforeEach(() => {
    trust = 'none';
    const fakeSupabase = { trust: async () => trust };
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: Supabase, useValue: fakeSupabase }],
    });
  });

  it('lets a trusted login through', async () => {
    trust = 'trusted';
    expect(await executeGuard({} as never, {} as never)).toBe(true);
  });

  it('sends a login that still needs the chosen second step to /login', async () => {
    trust = 'mail-code';
    const result = await executeGuard({} as never, {} as never);
    expect(result instanceof UrlTree && result.toString()).toBe('/login');
  });

  it('redirects to /login without a session', async () => {
    const result = await executeGuard({} as never, {} as never);
    expect(result instanceof UrlTree && result.toString()).toBe('/login');
  });
});
