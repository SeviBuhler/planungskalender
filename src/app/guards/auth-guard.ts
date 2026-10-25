import { CanActivateFn } from '@angular/router';
import { inject } from '@angular/core';
import { Supabase } from '../services/supabase'
import { Router } from '@angular/router'

export const authGuard: CanActivateFn = async (route, state) => {
  const supabase = inject(Supabase);
  const router = inject(Router);

  // Wait for the stored session, otherwise a reload on /calendar always lands on /login
  const session = await supabase.sessionReady;

  if (session != null) {
    return true;
  }
  return router.createUrlTree(['/login']);
};
