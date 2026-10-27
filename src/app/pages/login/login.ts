import { Component, OnInit, signal } from '@angular/core';
import { Supabase } from '../../services/supabase';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { RouterLink } from '@angular/router'
import { Passkeys } from '../../features/auth/passkeys';
import { readCodeFromClipboard } from '../../features/auth/paste-code';

type Step = 'credentials' | 'code' | 'totp' | 'offer-passkey';

// Why a mail code is being entered
type CodePurpose = 'second-factor' | 'forgot-password' | 'confirm-email';

// When the user said "later" to a passkey on this device; asked again after 30 days
const PASSKEY_DECLINED_KEY = 'fortwo.passkeyDeclinedAt';
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
  codePurpose = signal<CodePurpose>('second-factor');
  busy = signal(false);
  errorText = signal('');
  passkeySupported = signal(false);
  // "Forgot password": after the login go to the password change
  private forgotPassword = false;

  constructor(public supabase: Supabase, private router: Router, private passkeys: Passkeys) {}

  async ngOnInit() {
    this.passkeySupported.set(await this.passkeys.supported());
    const { data } = await this.supabase.client.auth.getSession();
    if (data.session) {
      this.email = data.session.user.email ?? '';
      await this.run(() => this.continueLogin());
    }
  }

  async handlePasskey() {
    await this.run(async () => {
      await this.passkeys.signIn();
      this.router.navigate(['/calendar']);
    });
  }

  async handleLogin() {
    await this.run(async () => {
      const result = await this.supabase.client.auth.signInWithPassword({
        email: this.email,
        password: this.password
      });
      if (result.error?.code === 'email_not_confirmed') {
        // First login: the mail address is confirmed with a code first
        const resend = await this.supabase.client.auth.resend({ type: 'signup', email: this.email });
        if (resend.error) throw new Error(codeError(resend.error));
        this.showCode('confirm-email');
        return;
      }
      if (result.error) throw new Error('E-Mail oder Passwort ist falsch.');
      await this.continueLogin();
    });
  }

  // Asks for the second step the user switched on, otherwise the login is done
  private async continueLogin() {
    const state = await this.supabase.trust();
    if (state === 'trusted') {
      this.finish();
    } else if (state === 'totp') {
      this.code = '';
      this.step.set('totp');
    } else if (state === 'mail-code') {
      await this.sendCode('second-factor');
    }
  }

  async sendCode(purpose: CodePurpose = this.codePurpose()) {
    if (purpose === 'confirm-email') {
      const { error } = await this.supabase.client.auth.resend({ type: 'signup', email: this.email });
      if (error) throw new Error(codeError(error));
    } else {
      const { error } = await this.supabase.client.auth.signInWithOtp({
        email: this.email,
        options: { shouldCreateUser: false }
      });
      if (error) throw new Error(codeError(error));
    }
    this.showCode(purpose);
  }

  async resendCode() {
    await this.run(() => this.sendCode());
  }

  private showCode(purpose: CodePurpose) {
    this.codePurpose.set(purpose);
    this.code = '';
    this.step.set('code');
  }

  async handleForgotPassword() {
    if (!this.email.trim()) {
      this.errorText.set('Gib zuerst deine E-Mail-Adresse ein.');
      return;
    }
    this.forgotPassword = true;
    await this.run(() => this.sendCode('forgot-password'));
  }

  // Fills in the code copied from the mail and confirms it right away
  async pasteCode() {
    const code = await readCodeFromClipboard();
    if (!code) {
      this.errorText.set('In der Zwischenablage ist kein Code. Kopiere ihn in der E-Mail oder tippe ihn ein.');
      return;
    }
    this.code = code;
    await (this.step() === 'totp' ? this.verifyTotp() : this.verifyCode());
  }

  async verifyCode() {
    await this.run(async () => {
      const result = await this.supabase.client.auth.verifyOtp({
        email: this.email,
        token: this.code.replace(/\s/g, ''),
        type: this.codePurpose() === 'confirm-email' ? 'signup' : 'email'
      });
      if (result.error) throw new Error('Der Code stimmt nicht oder ist abgelaufen.');
      await this.continueLogin();
    });
  }

  async verifyTotp() {
    await this.run(async () => {
      const { data: factors, error } = await this.supabase.client.auth.mfa.listFactors();
      const factor = factors?.totp[0];
      if (error || !factor) throw new Error('Die Authenticator-App ist für dieses Konto nicht eingerichtet.');
      const result = await this.supabase.client.auth.mfa.challengeAndVerify({ factorId: factor.id, code: this.code.replace(/\s/g, '') });
      if (result.error) throw new Error('Der Code stimmt nicht. Nimm den aktuellen Code aus der App.');
      this.finish();
    });
  }

  // After the login: offer a passkey once per device, unless one is already there
  private finish() {
    if (this.forgotPassword) {
      this.router.navigate(['/settings'], { queryParams: { password: 1 } });
    } else if (this.passkeySupported() && !this.passkeys.registeredHere && !passkeyDeclined()) {
      this.step.set('offer-passkey');
    } else {
      this.router.navigate(['/calendar']);
    }
  }

  async setupPasskey() {
    await this.run(async () => {
      try {
        await this.passkeys.register();
      } catch (error) {
        throw new Error(`Der Passkey konnte nicht eingerichtet werden (${messageOf(error)}). Du kannst es später in den Optionen nochmals versuchen.`);
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
