import { Component, signal } from '@angular/core';
import { Supabase } from '../../services/supabase'
import { Router, RouterLink } from '@angular/router'
import { FormsModule } from '@angular/forms';
import { PASSWORD_RULE_TEXT, passwordRuleError } from '../../features/auth/password-rule';
import { readCodeFromClipboard } from '../../features/auth/paste-code';

// Sign-up: the account becomes active with the code from the confirmation mail,
// which proves the mail address is real. The login page then offers a passkey.
@Component({
  selector: 'app-signup',
  imports: [FormsModule, RouterLink],
  templateUrl: './signup.html',
  styleUrl: './signup.css',
})
export class Signup {
  email: string = '';
  password: string = '';
  displayName: string = '';
  code: string = '';

  readonly passwordRule = PASSWORD_RULE_TEXT;
  readonly step = signal<'form' | 'code'>('form');
  readonly busy = signal(false);
  readonly errorText = signal('');

  constructor(public supabase: Supabase, private router: Router) {}

  async handleSignup() {
    const ruleError = passwordRuleError(this.password);
    if (ruleError) {
      this.errorText.set(ruleError);
      return;
    }
    await this.run(async () => {
      const result = await this.supabase.client.auth.signUp({
        email: this.email,
        password: this.password,
        options: { data: { display_name: this.displayName } }
      });
      if (result.error) throw new Error(`Die Registrierung hat nicht geklappt (${result.error.message}).`);
      if (result.data.session) {
        // Mail confirmation is switched off in Supabase: logged in right away
        await this.done();
      } else {
        this.code = '';
        this.step.set('code');
      }
    });
  }

  async pasteCode() {
    const code = await readCodeFromClipboard();
    if (!code) {
      this.errorText.set('In der Zwischenablage ist kein Code. Kopiere ihn in der E-Mail oder tippe ihn ein.');
      return;
    }
    this.code = code;
    await this.verifyCode();
  }

  async verifyCode() {
    await this.run(async () => {
      const { error } = await this.supabase.client.auth.verifyOtp({ email: this.email, token: this.code.replace(/\s/g, ''), type: 'signup' });
      if (error) throw new Error('Der Code stimmt nicht oder ist abgelaufen.');
      await this.done();
    });
  }

  async resendCode() {
    await this.run(async () => {
      const { error } = await this.supabase.client.auth.resend({ type: 'signup', email: this.email });
      if (error) throw new Error(`Der Code konnte nicht gesendet werden (${error.message}).`);
    });
  }

  // The profile row needs a login, so the name is saved only now
  private async done() {
    const { data } = await this.supabase.client.auth.getSession();
    const userId = data.session?.user.id;
    if (userId && this.displayName.trim()) {
      await this.supabase.client.from('profiles').update({ display_name: this.displayName.trim() }).eq('id', userId);
    }
    // The login page offers the passkey and then opens the app
    this.router.navigate(['/login']);
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
