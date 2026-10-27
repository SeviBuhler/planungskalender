import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { PasskeyListItem } from '@supabase/supabase-js';
import { PageHeader } from '../../components/page-header/page-header';
import { ConfirmService } from '../../components/confirm/confirm';
import { Passkeys } from '../../features/auth/passkeys';
import { PASSWORD_RULE_TEXT, passwordRuleError } from '../../features/auth/password-rule';
import { SecondFactor } from '../../features/auth/trust';
import { Supabase } from '../../services/supabase';
import { ThemeMode, ThemeService } from '../../services/theme';
import { readCodeFromClipboard } from '../../features/auth/paste-code';

// Setting up the authenticator app: QR code to scan, then the first code from the app
interface TotpSetup {
  factorId: string;
  qrCode: string;
  secret: string;
}

// Options: passkeys, second step (mail code / authenticator app), password, light / dark mode
@Component({
  selector: 'app-settings',
  imports: [PageHeader, FormsModule],
  templateUrl: './settings.html',
})
export class Settings implements OnInit {
  readonly themes: { mode: ThemeMode; label: string }[] = [
    { mode: 'system', label: 'Wie Gerät' },
    { mode: 'light', label: 'Hell' },
    { mode: 'dark', label: 'Dunkel' },
  ];
  readonly passwordRule = PASSWORD_RULE_TEXT;

  email = '';

  // Password
  newPassword = '';
  repeatPassword = '';
  passwordNonce = '';
  readonly passwordNeedsCode = signal(false);
  readonly passwordHint = signal(false);
  readonly passwordMessage = signal('');
  readonly passwordError = signal('');

  // Passkeys
  readonly passkeyList = signal<PasskeyListItem[]>([]);
  readonly passkeySupported = signal(false);
  readonly passkeyMessage = signal('');
  readonly passkeyError = signal('');

  // Second step
  totpCode = '';
  readonly secondFactor = signal<SecondFactor>('none');
  readonly totpSetup = signal<TotpSetup | null>(null);
  readonly totpDisabling = signal(false);
  readonly mfaMessage = signal('');
  readonly mfaError = signal('');

  readonly busy = signal(false);

  constructor(
    private supabase: Supabase,
    private passkeys: Passkeys,
    private confirm: ConfirmService,
    readonly theme: ThemeService,
    route: ActivatedRoute,
  ) {
    // Coming from "forgot password" on the login page
    this.passwordHint.set(route.snapshot.queryParamMap.has('password'));
  }

  async ngOnInit() {
    const { data } = await this.supabase.client.auth.getSession();
    this.email = data.session?.user.email ?? '';
    this.passkeySupported.set(await this.passkeys.supported());
    this.secondFactor.set(await this.supabase.secondFactor());
    await this.loadPasskeys();
  }

  // --- Passkeys ---

  async addPasskey() {
    await this.run(this.passkeyError, async () => {
      this.passkeyMessage.set('');
      try {
        await this.passkeys.register();
      } catch (error) {
        throw new Error(`Der Passkey konnte nicht eingerichtet werden (${messageOf(error)}).`);
      }
      this.passkeyMessage.set('Der Passkey ist eingerichtet. Ab jetzt kannst du dich damit anmelden.');
      await this.loadPasskeys();
    });
  }

  async removePasskey(passkey: PasskeyListItem) {
    if (!(await this.confirm.ask(`Passkey „${passkey.friendly_name ?? 'Gerät'}“ entfernen?`, 'Entfernen'))) return;
    await this.run(this.passkeyError, async () => {
      await this.passkeys.remove(passkey.id);
      this.passkeyMessage.set('');
      await this.loadPasskeys();
    });
  }

  private async loadPasskeys() {
    try {
      this.passkeyList.set(await this.passkeys.list());
    } catch (error) {
      this.passkeyError.set(`Die Passkeys konnten nicht geladen werden (${messageOf(error)}).`);
    }
  }

  // --- Second step ---

  async setMailCode(on: boolean) {
    await this.run(this.mfaError, async () => {
      const { error } = await this.supabase.client.auth.updateUser({ data: { mfa_mail: on } });
      if (error) throw new Error(error.message);
      this.secondFactor.set(on ? 'mail' : 'none');
      this.mfaMessage.set(on
        ? 'Ab jetzt bekommst du nach dem Passwort einen Code per E-Mail. Mit einem Passkey brauchst du keinen Code.'
        : 'Der Code per E-Mail ist ausgeschaltet.');
    });
  }

  async startTotp() {
    await this.run(this.mfaError, async () => {
      this.mfaMessage.set('');
      // An earlier setup that was not finished would block a new one
      const { data: factors } = await this.supabase.client.auth.mfa.listFactors();
      for (const factor of factors?.all ?? []) {
        if (factor.factor_type === 'totp' && factor.status === 'unverified') {
          await this.supabase.client.auth.mfa.unenroll({ factorId: factor.id });
        }
      }
      const { data, error } = await this.supabase.client.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'ForTwo' });
      if (error) throw new Error(`Die Authenticator-App konnte nicht eingerichtet werden (${error.message}).`);
      this.totpCode = '';
      this.totpSetup.set({ factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret });
    });
  }

  async confirmTotp() {
    const setup = this.totpSetup();
    if (!setup) return;
    await this.run(this.mfaError, async () => {
      const { error } = await this.supabase.client.auth.mfa.challengeAndVerify({ factorId: setup.factorId, code: this.totpCode.replace(/\s/g, '') });
      if (error) throw new Error('Der Code stimmt nicht. Nimm den aktuellen Code aus der App.');
      // The app replaces the mail code
      await this.supabase.client.auth.updateUser({ data: { mfa_mail: false } });
      this.totpSetup.set(null);
      this.secondFactor.set('totp');
      this.mfaMessage.set('Die Authenticator-App ist eingerichtet. Ab jetzt fragt die Anmeldung mit Passwort nach dem Code aus der App.');
    });
  }

  async cancelTotp() {
    const setup = this.totpSetup();
    this.totpSetup.set(null);
    this.totpDisabling.set(false);
    this.mfaError.set('');
    if (setup) await this.supabase.client.auth.mfa.unenroll({ factorId: setup.factorId });
  }

  // Switching the app off needs a current code from it (Supabase only allows it after the app code)
  async disableTotp() {
    await this.run(this.mfaError, async () => {
      const { data: factors } = await this.supabase.client.auth.mfa.listFactors();
      const factor = factors?.totp[0];
      if (!factor) {
        this.secondFactor.set('none');
        return;
      }
      const verify = await this.supabase.client.auth.mfa.challengeAndVerify({ factorId: factor.id, code: this.totpCode.replace(/\s/g, '') });
      if (verify.error) throw new Error('Der Code stimmt nicht. Nimm den aktuellen Code aus der App.');
      const { error } = await this.supabase.client.auth.mfa.unenroll({ factorId: factor.id });
      if (error) throw new Error(error.message);
      this.totpDisabling.set(false);
      this.secondFactor.set('none');
      this.mfaMessage.set('Die Authenticator-App ist ausgeschaltet.');
    });
  }

  async pasteTotp() {
    const code = await readCodeFromClipboard();
    if (!code) {
      this.mfaError.set('In der Zwischenablage ist kein Code.');
      return;
    }
    this.totpCode = code;
    await (this.totpSetup() ? this.confirmTotp() : this.disableTotp());
  }

  // --- Password ---

  async changePassword() {
    this.passwordMessage.set('');
    this.passwordError.set('');
    const ruleError = passwordRuleError(this.newPassword);
    if (ruleError) {
      this.passwordError.set(ruleError);
      return;
    }
    if (this.newPassword !== this.repeatPassword) {
      this.passwordError.set('Die beiden Passwörter sind nicht gleich.');
      return;
    }
    await this.run(this.passwordError, async () => {
      const nonce = this.passwordNeedsCode() ? this.passwordNonce.trim() : undefined;
      const { error } = await this.supabase.client.auth.updateUser({ password: this.newPassword, nonce });
      if (error?.code === 'reauthentication_needed') {
        // Supabase wants a fresh confirmation by mail before the password changes
        const result = await this.supabase.client.auth.reauthenticate();
        if (result.error) throw new Error(result.error.message);
        this.passwordNeedsCode.set(true);
        this.passwordMessage.set(`Zur Sicherheit haben wir dir einen Code an ${this.email} geschickt. Gib ihn unten ein und speichere nochmals.`);
        return;
      }
      if (error) throw new Error(passwordError(error.code, error.message));
      this.newPassword = this.repeatPassword = this.passwordNonce = '';
      this.passwordNeedsCode.set(false);
      this.passwordHint.set(false);
      this.passwordMessage.set('Dein Passwort ist geändert.');
    });
  }

  formatDate(value: string | null | undefined): string {
    return value ? new Date(value).toLocaleDateString('de-CH') : '–';
  }

  private async run(errorTarget: ReturnType<typeof signal<string>>, action: () => Promise<void>) {
    if (this.busy()) return;
    this.busy.set(true);
    errorTarget.set('');
    try {
      await action();
    } catch (error) {
      errorTarget.set(messageOf(error));
    } finally {
      this.busy.set(false);
    }
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function passwordError(code: string | undefined, message: string): string {
  if (code === 'same_password') return 'Das neue Passwort ist gleich wie das alte.';
  if (code === 'weak_password') return `Das Passwort ist zu schwach. ${PASSWORD_RULE_TEXT}`;
  return `Das Passwort konnte nicht geändert werden (${message}).`;
}
