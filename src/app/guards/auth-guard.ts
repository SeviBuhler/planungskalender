import { CanActivateFn } from '@angular/router';
import { inject } from '@angular/core';
import { Supabase } from '../services/supabase'
import { Router } from '@angular/router'

export const authGuard: CanActivateFn = async (route, state) => {
  const supabase = inject(Supabase);
  const router = inject(Router);

  // getSession() waits for the stored session after a reload and also sees a login that just happened
  const { data } = await supabase.client.auth.getSession();

  if (data.session != null) {
    return true;
  }
  return router.createUrlTree(['/login']);
};
