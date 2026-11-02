import { Component, inject, signal } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { ConfirmDialog } from './components/confirm/confirm';
import { UpdateBanner } from './components/update/update';
import { VaultGate } from './components/vault-gate/vault-gate';
import { Supabase } from './services/supabase';
import { ThemeService } from './services/theme';
import { NavSideService } from './services/nav-side';
import { Vault } from './features/crypto/vault';

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
  private readonly vault = inject(Vault);

  constructor() {
    // Unlocks with the key stored on this device, whatever page opens first, so household keys
    // are shared without visiting the calendar
    this.supabase.sessionReady.then((session) => session && this.vault.restore());
  }

  // When the PWA comes back to the front, check that the login still exists (e.g. after logging out elsewhere)
  // and exchange encryption keys
  async checkLogin() {
    if (document.visibilityState !== 'visible') return;
    if (/^\/(login|signup)/.test(this.router.url)) return;
    if (await this.supabase.trust() !== 'trusted') {
      this.router.navigate(['/login']);
      return;
    }
    // Hands household keys to members who set up encryption while the app was in the background,
    // and picks up keys others shared with us meanwhile
    void this.vault.refresh();
  }
}
