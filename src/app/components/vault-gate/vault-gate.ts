import { Component, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ConfirmService } from '../confirm/confirm';
import { Vault } from '../../features/crypto/vault';
import { generateRecoveryCode, normalizeRecoveryCode } from '../../features/crypto/e2ee';

// Shown while a page waits for the keys: set up encryption once, or unlock a new device
// with the recovery code
@Component({
  selector: 'app-vault-gate',
  imports: [FormsModule],
  template: `
    @if (open()) {
      <div class="dialog-backdrop fixed inset-0 flex items-center justify-center bg-black/40 p-3"
           animate.enter="anim-fade-in" animate.leave="anim-fade-out">
        <section class="w-full max-w-lg rounded-2xl bg-gray-100 text-indigo-950 shadow-2xl p-5 flex flex-col gap-3"
                 role="dialog" aria-modal="true" aria-labelledby="vault-title" animate.enter="anim-dialog-in" animate.leave="anim-dialog-out">
          @if (newCode(); as code) {
            <h2 id="vault-title" class="font-semibold text-xl">Dein Wiederherstellungscode</h2>
            <p class="text-sm">
              Mit diesem Code entsperrst du deine Daten auf einem neuen Gerät. Bewahre ihn sicher auf, zum Beispiel im
              Passwort-Manager oder ausgedruckt. <b>Ohne den Code kann niemand deine privaten Daten wiederherstellen, auch der Betreiber nicht.</b>
            </p>
            <p class="p-3 rounded-lg bg-white font-mono text-base sm:text-lg text-center whitespace-nowrap overflow-x-auto select-all">{{ code }}</p>
            <div class="flex flex-wrap gap-2">
              <button class="px-4 py-2 rounded-lg shadow bg-white hover:bg-gray-200" (click)="copy(code)">{{ copied() ? 'Kopiert' : 'Kopieren' }}</button>
              <button class="px-4 py-2 rounded-lg shadow bg-white hover:bg-gray-200" (click)="download(code)">Als Datei speichern</button>
            </div>
            <label class="flex items-start gap-2 text-sm">
              <input type="checkbox" class="mt-1" [checked]="saved()" (change)="saved.set($any($event.target).checked)" />
              Ich habe den Code sicher aufbewahrt.
            </label>
            <div class="flex flex-wrap justify-end gap-2">
              <button class="px-4 py-2 rounded-lg hover:bg-gray-300" [disabled]="busy()" (click)="newCode.set(null)">Zurück</button>
              <button class="px-4 py-2 rounded-lg shadow bg-indigo-600 hover:bg-fuchsia-500 text-white disabled:opacity-60"
                      [disabled]="!saved() || busy()" (click)="finish(code)">{{ busy() ? 'Wird eingerichtet …' : 'Fertig' }}</button>
            </div>
          } @else if (vault.state() === 'setup') {
            <h2 id="vault-title" class="font-semibold text-xl">Daten verschlüsseln</h2>
            <p class="text-sm">
              ForTwo verschlüsselt deine Termine jetzt auf deinem Gerät, bevor sie gespeichert werden. In der Datenbank liegt
              nur noch unlesbarer Text, niemand sonst kann ihn lesen, auch der Betreiber nicht. Mitglieder deiner Haushalte
              sehen gemeinsame Einträge wie bisher.
            </p>
            <p class="text-sm">Dafür bekommst du einmalig einen Wiederherstellungscode.</p>
            <div class="flex flex-wrap justify-end gap-2">
              <button class="px-4 py-2 rounded-lg hover:bg-gray-300" (click)="vault.cancel()">Später</button>
              <button class="px-4 py-2 rounded-lg shadow bg-indigo-600 hover:bg-fuchsia-500 text-white" (click)="start('setup')">Einrichten</button>
            </div>
          } @else {
            <h2 id="vault-title" class="font-semibold text-xl">Gerät entsperren</h2>
            <p class="text-sm">Deine Daten sind verschlüsselt. Gib auf diesem Gerät einmal deinen Wiederherstellungscode ein.</p>
            <form class="flex flex-col gap-2" (ngSubmit)="unlock()">
              <input class="p-2 rounded bg-white font-mono tracking-wider uppercase" name="code" autocomplete="off" autocapitalize="characters"
                     spellcheck="false" [(ngModel)]="code" placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX" aria-label="Wiederherstellungscode" />
              <div class="flex flex-wrap items-center justify-end gap-2">
                <button class="mr-auto text-sm underline" type="button" [disabled]="busy()" (click)="startOver()">Code verloren?</button>
                <button class="px-4 py-2 rounded-lg hover:bg-gray-300" type="button" (click)="vault.cancel()">Später</button>
                <button class="px-4 py-2 rounded-lg shadow bg-indigo-600 hover:bg-fuchsia-500 text-white disabled:opacity-60" type="submit"
                        [disabled]="busy()">{{ busy() ? 'Prüft …' : 'Entsperren' }}</button>
              </div>
            </form>
          }
          @if (errorText()) {
            <p class="p-2 rounded bg-red-200 text-red-900 text-sm" role="alert">{{ errorText() }}</p>
          }
        </section>
      </div>
    }
  `,
})
export class VaultGate {
  readonly open = computed(() => this.vault.state() === 'setup' || this.vault.state() === 'locked');
  readonly newCode = signal<string | null>(null);
  readonly saved = signal(false);
  readonly copied = signal(false);
  readonly busy = signal(false);
  readonly errorText = signal('');
  code = '';
  private mode: 'setup' | 'reset' = 'setup';

  constructor(readonly vault: Vault, private confirm: ConfirmService) {}

  start(mode: 'setup' | 'reset') {
    this.mode = mode;
    this.errorText.set('');
    this.saved.set(false);
    this.copied.set(false);
    this.newCode.set(generateRecoveryCode());
  }

  async startOver() {
    const ok = await this.confirm.ask(
      'Neu anfangen? Deine privaten verschlüsselten Einträge können danach nicht mehr gelesen werden. Gemeinsame Einträge eines Haushalts werden wieder lesbar, sobald ein anderes Mitglied ForTwo öffnet.',
      'Neu anfangen'
    );
    if (ok) this.start('reset');
  }

  async unlock() {
    const code = normalizeRecoveryCode(this.code);
    if (!code) {
      this.errorText.set('Der Code hat 24 Zeichen, z. B. ABCD-EFGH-JKLM-NPQR-STUV-WXYZ.');
      return;
    }
    await this.run(() => this.vault.unlock(code));
    if (!this.errorText()) this.code = '';
  }

  async finish(code: string) {
    await this.run(() => (this.mode === 'reset' ? this.vault.reset(code) : this.vault.setup(code)));
    if (!this.errorText()) this.newCode.set(null);
  }

  async copy(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      this.copied.set(true);
    } catch {
      this.errorText.set('Kopieren ging nicht. Markiere den Code und kopiere ihn von Hand.');
    }
  }

  download(code: string) {
    const text = `ForTwo Wiederherstellungscode\n\n${code}\n\nMit diesem Code entsperrst du deine verschlüsselten ForTwo-Daten auf einem neuen Gerät.\n`;
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    link.download = 'ForTwo-Wiederherstellungscode.txt';
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  private async run(action: () => Promise<void>) {
    this.busy.set(true);
    this.errorText.set('');
    try {
      await action();
    } catch (error) {
      this.errorText.set(error instanceof Error ? error.message : String((error as { message?: string })?.message ?? error));
    } finally {
      this.busy.set(false);
    }
  }
}
