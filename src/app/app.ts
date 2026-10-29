import { Component, inject, signal } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { ConfirmDialog } from './components/confirm/confirm';
import { UpdateBanner } from './components/update/update';
import { VaultGate } from './components/vault-gate/vault-gate';
import { Supabase } from './services/supabase';
import { ThemeService } from './services/theme';
import { NavSideService } from './services/nav-side';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, ConfirmDialog, UpdateBanner, VaultGate],
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
  private readonly navSide = inject(NavSideService);

  // When the PWA comes back to the front, check that the login still exists (e.g. after logging out elsewhere)
  async checkLogin() {
    if (document.visibilityState !== 'visible') return;
    if (/^\/(login|signup)/.test(this.router.url)) return;
    if (await this.supabase.trust() !== 'trusted') this.router.navigate(['/login']);
  }
}
