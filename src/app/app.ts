import { Component, inject, signal } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { ConfirmDialog } from './components/confirm/confirm';
import { Supabase } from './services/supabase';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, ConfirmDialog],
  templateUrl: './app.html',
  styleUrl: './app.css',
  host: { '(document:visibilitychange)': 'checkLogin()' }
})
export class App {
  protected readonly title = signal('ForTwo');
  private readonly supabase = inject(Supabase);
  private readonly router = inject(Router);

  // The PWA often stays open for days: when it comes back to the front, end a login older than 7 days
  async checkLogin() {
    if (document.visibilityState !== 'visible') return;
    if (/^\/(login|signup)/.test(this.router.url)) return;
    if (await this.supabase.trust() !== 'trusted') this.router.navigate(['/login']);
  }
}
