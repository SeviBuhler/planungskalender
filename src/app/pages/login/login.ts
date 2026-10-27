import { Component, OnInit, signal } from '@angular/core';
import { Supabase } from '../../services/supabase';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { RouterLink } from '@angular/router'
import { DeviceUnlock, deviceName } from '../../features/auth/device-unlock';

type Step = 'credentials' | 'second-factor' | 'code' | 'offer-passkey';

// When the user said "later" to the device unlock on this device; asked again after 30 days
// (new key: "later" from the time the device unlock could not work yet no longer counts)
const PASSKEY_DECLINED_KEY = 'fortwo.deviceUnlockDeclinedAt';
const PASSKEY_ASK_AGAIN_MS = 30 * 86400 * 1000;

@Component({
  selector: 'app-login',
  imports: [FormsModule, RouterLink],
  templateUrl: './login.html',
  styleUrl: './login.css',
})
export class Login implements OnInit {
  email: string = '';
  password: string = '';
  code: string = '';

  step = signal<Step>('credentials');
  busy = signal(false);
  errorText = signal('');
  // This device has a passkey for the device unlock
  passkeyHere = signal(false);
  passkeySupported = signal(false);
  // The user asked to set up the device unlock, so offer it after the code even after "later"
  private wantsSetup = false;
  // "Forgot password": log in with a mail code only, then set a new password in the settings
  private forgotPassword = false;

  constructor(public supabase: Supabase, private router: Router, private deviceUnlock: DeviceUnlock) {}

  async ngOnInit() {
    this.passkeySupported.set(await this.deviceUnlock.available());
    const state = await this.supabase.trust();
    if (state === 'trusted') {
      this.router.navigate(['/calendar']);
    } else if (state === 'second-factor') {
      await this.startSecondFactor();
    }
  }

  async handleLogin() {
    await this.run(async () => {
      const result = await this.supabase.client.auth.signInWithPassword({
        email: this.email,
        password: this.password
      });
      if (result.error) throw new Error('E-Mail oder Passwort ist falsch.');
      await this.startSecondFactor();
    });
  }

  private async startSecondFactor() {
    const { data } = await this.supabase.client.auth.getSession();
    this.email = data.session?.user.email ?? this.email;
    this.passkeyHere.set(this.deviceUnlock.registeredHere);
    this.step.set('second-factor');
  }

  async handlePasskey() {
    await this.run(async () => {
      try {
        await this.deviceUnlock.authenticate();
      } catch (error) {
        throw new Error(`Die Gerätesperre hat nicht geklappt (${messageOf(error)}). Versuch es nochmals oder nimm den Code per E-Mail.`);
      }
      this.router.navigate(['/calendar']);
    });
  }

  async sendCode() {
    await this.run(async () => {
      const result = await this.supabase.client.auth.signInWithOtp({
        email: this.email,
        options: { shouldCreateUser: false }
      });
      if (result.error) throw new Error(codeError(result.error));
      // The code creates a fresh session, so the password-only session is no longer needed
      if (this.step() === 'second-factor') await this.supabase.client.auth.signOut({ scope: 'local' });
      this.code = '';
      this.step.set('code');
    });
  }

  // Setting up needs a fresh mail code, so this sends one and offers the device unlock afterwards
  async setupWithCode() {
    this.wantsSetup = true;
    await this.sendCode();
  }

  async handleForgotPassword() {
    if (!this.email.trim()) {
      this.errorText.set('Gib zuerst deine E-Mail-Adresse ein.');
      return;
    }
    this.forgotPassword = true;
    await this.sendCode();
  }

  async verifyCode() {
    await this.run(async () => {
      const result = await this.supabase.client.auth.verifyOtp({
        email: this.email,
        token: this.code.replace(/\s/g, ''),
        type: 'email'
      });
      if (result.error) throw new Error('Der Code stimmt nicht oder ist abgelaufen.');
      if (this.forgotPassword) {
        this.router.navigate(['/settings'], { queryParams: { password: 1 } });
        return;
      }
      if (this.passkeySupported() && !this.deviceUnlock.registeredHere && (this.wantsSetup || !passkeyDeclined())) {
        this.step.set('offer-passkey');
      } else {
        this.router.navigate(['/calendar']);
      }
    });
  }

  async setupPasskey() {
    await this.run(async () => {
      try {
        await this.deviceUnlock.register(deviceName());
      } catch (error) {
        throw new Error(`Die Gerätesperre konnte nicht eingerichtet werden (${messageOf(error)}). Du kannst dich weiterhin mit dem E-Mail-Code anmelden.`);
      }
      this.router.navigate(['/calendar']);
    });
  }

  skipPasskey() {
    try { localStorage.setItem(PASSKEY_DECLINED_KEY, String(Date.now())); } catch { /* private mode */ }
    this.router.navigate(['/calendar']);
  }

  async backToStart() {
    await this.supabase.client.auth.signOut({ scope: 'local' });
    this.password = '';
    this.forgotPassword = false;
    this.wantsSetup = false;
    this.errorText.set('');
    this.step.set('credentials');
  }

  private async run(action: () => Promise<void>) {
    if (this.busy()) return;
    this.busy.set(true);
    this.errorText.set('');
    try {
      await action();
    } catch (error) {
      this.errorText.set(error instanceof Error ? error.message : String(error));
    } finally {
      this.busy.set(false);
    }
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function passkeyDeclined(): boolean {
  try { return Date.now() - Number(localStorage.getItem(PASSKEY_DECLINED_KEY) ?? 0) < PASSKEY_ASK_AGAIN_MS; } catch { return false; }
}

function codeError(error: { message: string; status?: number; name: string }): string {
  return /rate|seconds|security purposes/i.test(error.message)
    ? 'Zu viele Codes angefordert. Warte kurz und versuch es nochmals.'
    : `Der Code konnte nicht gesendet werden (${error.status ?? ''} ${error.name}: ${error.message}).`;
}
