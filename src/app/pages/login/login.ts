import { Component, OnInit, signal } from '@angular/core';
import { Supabase } from '../../services/supabase';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { RouterLink } from '@angular/router'

type Step = 'credentials' | 'second-factor' | 'code' | 'offer-passkey';

// Supabase's hosted projects don't support WebAuthn as MFA factor yet ("Enabling of MFA with WebAuthn
// not currently supported"). Switch this on once they do; until then the mail code is the second step.
const DEVICE_UNLOCK_ENABLED = false;

// When the user said "later" to the device unlock on this device; asked again after 30 days
const PASSKEY_DECLINED_KEY = 'fortwo.passkeyDeclinedAt';
const PASSKEY_ASK_AGAIN_MS = 30 * 86400 * 1000;

// Supabase defaults to USB security keys; ask for the device's own unlock instead
// (Face ID / Touch ID, fingerprint, Windows Hello, device PIN or pattern)
const DEVICE_UNLOCK_CREATION = {
  hints: ['client-device'],
  authenticatorSelection: {
    authenticatorAttachment: 'platform',
    userVerification: 'required',
    residentKey: 'preferred',
    requireResidentKey: false,
  },
} as const;
const DEVICE_UNLOCK_REQUEST = { hints: ['client-device'], userVerification: 'required' } as const;

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
  // Verified Face ID / passkey factor of this user, if any
  passkeyFactorId = signal<string | null>(null);
  passkeySupported = signal(false);

  constructor(public supabase: Supabase, private router: Router) {}

  async ngOnInit() {
    this.passkeySupported.set(DEVICE_UNLOCK_ENABLED && await platformAuthenticatorAvailable());
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
    const factors = await this.supabase.client.auth.mfa.listFactors();
    const passkey = factors.data?.all.find((f) => f.factor_type === 'webauthn' && f.status === 'verified');
    this.passkeyFactorId.set(passkey?.id ?? null);
    this.step.set('second-factor');
  }

  async handlePasskey() {
    const factorId = this.passkeyFactorId();
    if (!factorId) return;
    await this.run(async () => {
      const result = await this.supabase.client.auth.mfa.webauthn.authenticate({ factorId }, DEVICE_UNLOCK_REQUEST as never);
      if (result.error) throw new Error(`Die Gerätesperre hat nicht geklappt (${result.error.message}). Versuch es nochmals oder nimm den Code per E-Mail.`);
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

  async verifyCode() {
    await this.run(async () => {
      const result = await this.supabase.client.auth.verifyOtp({
        email: this.email,
        token: this.code.replace(/\s/g, ''),
        type: 'email'
      });
      if (result.error) throw new Error('Der Code stimmt nicht oder ist abgelaufen.');
      if (this.passkeySupported() && !this.passkeyFactorId() && !passkeyDeclined()) {
        this.step.set('offer-passkey');
      } else {
        this.router.navigate(['/calendar']);
      }
    });
  }

  async setupPasskey() {
    await this.run(async () => {
      const result = await this.supabase.client.auth.mfa.webauthn.register(
        { friendlyName: `${deviceName()} ${new Date().toLocaleString('de-CH')}` },
        DEVICE_UNLOCK_CREATION as never
      );
      if (result.error) throw new Error(`Die Gerätesperre konnte nicht eingerichtet werden (${result.error.message}). Du kannst dich weiterhin mit dem E-Mail-Code anmelden.`);
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

async function platformAuthenticatorAvailable(): Promise<boolean> {
  try {
    return typeof PublicKeyCredential !== 'undefined' && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

function passkeyDeclined(): boolean {
  try { return Date.now() - Number(localStorage.getItem(PASSKEY_DECLINED_KEY) ?? 0) < PASSKEY_ASK_AGAIN_MS; } catch { return false; }
}

function codeError(error: { message: string; status?: number; name: string }): string {
  return /rate|seconds|security purposes/i.test(error.message)
    ? 'Zu viele Codes angefordert. Warte kurz und versuch es nochmals.'
    : `Der Code konnte nicht gesendet werden (${error.status ?? ''} ${error.name}: ${error.message}).`;
}

function deviceName(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Mac/.test(ua)) return 'Mac';
  if (/Android/.test(ua)) return 'Android';
  if (/Windows/.test(ua)) return 'Windows';
  return 'Gerät';
}
