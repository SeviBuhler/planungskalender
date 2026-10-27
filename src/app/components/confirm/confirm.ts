import { Component, Injectable, signal } from '@angular/core';

interface Question {
  message: string;
  confirmLabel: string;
  resolve: (answer: boolean) => void;
}

// Replaces window.confirm with an animated dialog
@Injectable({ providedIn: 'root' })
export class ConfirmService {
  readonly question = signal<Question | null>(null);

  ask(message: string, confirmLabel = 'OK'): Promise<boolean> {
    this.question()?.resolve(false);
    return new Promise((resolve) => this.question.set({ message, confirmLabel, resolve }));
  }

  answer(value: boolean) {
    this.question()?.resolve(value);
    this.question.set(null);
  }
}

@Component({
  selector: 'app-confirm',
  host: { '(document:keydown.escape)': 'confirm.question() && confirm.answer(false)' },
  template: `
    @if (confirm.question(); as q) {
      <div class="dialog-backdrop dialog-top fixed inset-0 flex items-center justify-center bg-black/40 p-3"
           animate.enter="anim-fade-in" animate.leave="anim-fade-out" (click)="confirm.answer(false)">
        <section class="w-full max-w-sm rounded-2xl bg-gray-100 text-indigo-950 shadow-2xl p-5 flex flex-col gap-4"
                 role="alertdialog" aria-modal="true" animate.enter="anim-dialog-in" animate.leave="anim-dialog-out" (click)="$event.stopPropagation()">
          <p>{{ q.message }}</p>
          <div class="flex justify-end gap-2">
            <button class="px-4 py-2 rounded-lg hover:bg-gray-300 transition-colors" (click)="confirm.answer(false)">Abbrechen</button>
            <button class="px-4 py-2 rounded-lg shadow bg-red-600 hover:bg-red-500 text-white transition-colors" (click)="confirm.answer(true)">{{ q.confirmLabel }}</button>
          </div>
        </section>
      </div>
    }
  `,
})
export class ConfirmDialog {
  constructor(public confirm: ConfirmService) {}
}
