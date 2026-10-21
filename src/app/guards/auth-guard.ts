import { CanActivateFn } from '@angular/router';
import { inject } from '@angular/core';
import { Supabase } from '../services/supabase'
import { Router } from '@angular/router'

export const authGuard: CanActivateFn = (route, state) => {
  const supabase = inject(Supabase);
  const router = inject(Router);

  if (supabase.currentSession() != null) {
    return true;
  }
  router.navigate(['/login']);
  return false;
};
