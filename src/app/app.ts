import { Component, inject, signal } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { ConfirmDialog } from './components/confirm/confirm';
import { UpdateBanner } from './components/update/update';
import { Supabase } from './services/supabase';
import { ThemeService } from './services/theme';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, ConfirmDialog, UpdateBanner],
  templateUrl: './app.html',
  styleUrl: './app.css',
  host: { '(document:visibilitychange)': 'checkLogin()' }
})
export class App {
  protected readonly title = signal('ForTwo');
  private readonly supabase = inject(Supabase);
  private readonly router = inject(Router);
  // Created at start so the chosen theme follows device changes on every page
  private readonly theme = inject(ThemeService);

  // The PWA often stays open for days: when it comes back to the front, end a login older than 7 days
  async checkLogin() {
    if (document.visibilityState !== 'visible') return;
    if (/^\/(login|signup)/.test(this.router.url)) return;
    if (await this.supabase.trust() !== 'trusted') this.router.navigate(['/login']);
  }
}
