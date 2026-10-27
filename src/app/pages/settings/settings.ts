import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { PageHeader } from '../../components/page-header/page-header';
import { ConfirmService } from '../../components/confirm/confirm';
import { DeviceInfo, DeviceUnlock, deviceName } from '../../features/auth/device-unlock';
import { Supabase } from '../../services/supabase';
import { ThemeMode, ThemeService } from '../../services/theme';
import { readCodeFromClipboard } from '../../features/auth/paste-code';

const MIN_PASSWORD_LENGTH = 8;

// Options: password, device unlock (Face ID, fingerprint, device PIN), light / dark mode
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

  email = '';

  // Password
  newPassword = '';
  repeatPassword = '';
  passwordNonce = '';
  readonly passwordNeedsCode = signal(false);
  readonly passwordHint = signal(false);
  readonly passwordMessage = signal('');
  readonly passwordError = signal('');

  // Device unlock
  setupCode = '';
  readonly devices = signal<DeviceInfo[]>([]);
  readonly unlockSupported = signal(false);
  readonly registeredHere = signal(false);
  readonly setupStep = signal<'idle' | 'code'>('idle');
  readonly unlockMessage = signal('');
  readonly unlockError = signal('');

  readonly busy = signal(false);

  constructor(
    private supabase: Supabase,
    private deviceUnlock: DeviceUnlock,
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
    this.unlockSupported.set(await this.deviceUnlock.available());
    this.registeredHere.set(this.deviceUnlock.registeredHere);
    await this.loadDevices();
  }

  async changePassword() {
    this.passwordMessage.set('');
    this.passwordError.set('');
    if (this.newPassword.length < MIN_PASSWORD_LENGTH) {
      this.passwordError.set(`Das Passwort braucht mindestens ${MIN_PASSWORD_LENGTH} Zeichen.`);
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

  // Setting up needs a mail code from the last 15 minutes (checked by the Edge Function)
  async sendSetupCode() {
    await this.run(this.unlockError, async () => {
      const { error } = await this.supabase.client.auth.signInWithOtp({ email: this.email, options: { shouldCreateUser: false } });
      if (error) throw new Error(`Der Code konnte nicht gesendet werden (${error.message}).`);
      this.setupCode = '';
      this.setupStep.set('code');
      this.unlockMessage.set(`Wir haben dir einen Code an ${this.email} geschickt.`);
    });
  }

  async pasteSetupCode() {
    const code = await readCodeFromClipboard();
    if (!code) {
      this.unlockError.set('In der Zwischenablage ist kein Code. Kopiere ihn in der E-Mail oder tippe ihn ein.');
      return;
    }
    this.setupCode = code;
    await this.confirmSetup();
  }

  async confirmSetup() {
    await this.run(this.unlockError, async () => {
      const { error } = await this.supabase.client.auth.verifyOtp({ email: this.email, token: this.setupCode.replace(/\s/g, ''), type: 'email' });
      if (error) throw new Error('Der Code stimmt nicht oder ist abgelaufen.');
      try {
        await this.deviceUnlock.register(deviceName());
      } catch (e) {
        throw new Error(`Die Gerätesperre konnte nicht eingerichtet werden (${e instanceof Error ? e.message : String(e)}).`);
      }
      this.setupStep.set('idle');
      this.registeredHere.set(true);
      this.unlockMessage.set('Die Gerätesperre ist eingerichtet. Ab der nächsten Anmeldung kannst du damit bestätigen.');
      await this.loadDevices();
    });
  }

  cancelSetup() {
    this.setupStep.set('idle');
    this.unlockMessage.set('');
    this.unlockError.set('');
  }

  async removeDevice(device: DeviceInfo) {
    if (!(await this.confirm.ask(`Gerätesperre „${device.name}“ entfernen?`, 'Entfernen'))) return;
    await this.run(this.unlockError, async () => {
      await this.deviceUnlock.remove(device);
      this.registeredHere.set(this.deviceUnlock.registeredHere);
      this.unlockMessage.set('');
      await this.loadDevices();
    });
  }

  formatDate(value: string | null): string {
    return value ? new Date(value).toLocaleDateString('de-CH') : '–';
  }

  private async loadDevices() {
    try {
      this.devices.set(await this.deviceUnlock.devices());
    } catch (error) {
      this.unlockError.set(`Die Geräte konnten nicht geladen werden (${error instanceof Error ? error.message : String(error)}).`);
    }
  }

  private async run(errorTarget: ReturnType<typeof signal<string>>, action: () => Promise<void>) {
    if (this.busy()) return;
    this.busy.set(true);
    errorTarget.set('');
    try {
      await action();
    } catch (error) {
      errorTarget.set(error instanceof Error ? error.message : String(error));
    } finally {
      this.busy.set(false);
    }
  }
}

function passwordError(code: string | undefined, message: string): string {
  if (code === 'same_password') return 'Das neue Passwort ist gleich wie das alte.';
  if (code === 'weak_password') return 'Das Passwort ist zu schwach. Nimm ein längeres oder eines mit Zahlen und Sonderzeichen.';
  return `Das Passwort konnte nicht geändert werden (${message}).`;
}
