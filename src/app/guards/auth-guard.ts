import { CanActivateFn } from '@angular/router';
import { inject } from '@angular/core';
import { Supabase } from '../services/supabase'
import { Router } from '@angular/router'

export const authGuard: CanActivateFn = async (route, state) => {
  const supabase = inject(Supabase);
  const router = inject(Router);

  // Only a login with a second factor from the last 7 days gets in; the login page handles the rest
  if (await supabase.trust() === 'trusted') {
    return true;
  }
  return router.createUrlTree(['/login']);
};
