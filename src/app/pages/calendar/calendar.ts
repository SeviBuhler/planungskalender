import { Component } from '@angular/core';
import { Supabase } from '../../services/supabase';
import { Router } from '@angular/router';

@Component({
  selector: 'app-calendar',
  imports: [],
  templateUrl: './calendar.html',
  styleUrl: './calendar.css',
})
export class Calendar {

  constructor(public supabase: Supabase, private router: Router) {}

  async handleLogout() {
    const result = await this.supabase.client.auth.signOut()

    if (!result.error) {
      this.router.navigate(['/login'])
    }
  }
}
