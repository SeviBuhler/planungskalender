import { Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Household, HouseholdModule, HouseholdStore, MODULES } from '../../features/households/household-store';
import { ConfirmService } from '../../components/confirm/confirm';

function errorMessage(error: unknown): string {
  return typeof error === 'object' && error !== null && 'message' in error
    ? String((error as { message: string }).message)
    : 'Unbekannter Fehler';
}

@Component({
  selector: 'app-households',
  imports: [FormsModule, RouterLink],
  templateUrl: './households.html',
  styleUrl: './households.css',
})
export class Households {
  readonly modules = MODULES;
  readonly households = signal<Household[]>([]);
  readonly loading = signal(true);
  readonly errorText = signal('');

  newName = '';
  newModules = new Set<HouseholdModule>(['finance', 'calendar', 'shopping']);
  inviteCode = '';

  constructor(private store: HouseholdStore, private confirm: ConfirmService) {
    this.reload();
  }

  private async run(action: () => Promise<unknown>) {
    this.errorText.set('');
    try {
      await action();
      await this.reload();
    } catch (error) {
      this.errorText.set(errorMessage(error));
    }
  }

  async reload() {
    try {
      this.households.set(await this.store.list());
    } catch (error) {
      this.errorText.set(errorMessage(error));
    } finally {
      this.loading.set(false);
    }
  }

  toggleNewModule(module: HouseholdModule) {
    if (!this.newModules.delete(module)) this.newModules.add(module);
  }

  async create() {
    if (!this.newName.trim()) {
      this.errorText.set('Bitte einen Namen eingeben');
      return;
    }
    await this.run(() => this.store.create(this.newName.trim(), [...this.newModules]));
    if (!this.errorText()) this.newName = '';
  }

  async join() {
    if (!this.inviteCode.trim()) return;
    await this.run(() => this.store.join(this.inviteCode));
    if (!this.errorText()) this.inviteCode = '';
  }

  async toggleModule(household: Household, module: HouseholdModule) {
    const modules = household.modules.includes(module)
      ? household.modules.filter((m) => m !== module)
      : [...household.modules, module];
    await this.run(() => this.store.update(household.id, { modules }));
  }

  async rename(household: Household, name: string) {
    if (!name.trim() || name.trim() === household.name) return;
    await this.run(() => this.store.update(household.id, { name: name.trim() }));
  }

  async leave(household: Household) {
    const last = household.memberCount === 1 ? ' Du bist das letzte Mitglied, der Haushalt wird gelöscht.' : '';
    if (!(await this.confirm.ask(`Haushalt „${household.name}“ verlassen? Deine geteilten Finanzpläne, Termine und Einkaufslisten darin werden wieder privat.${last}`, 'Verlassen'))) return;
    await this.run(() => this.store.leave(household.id));
  }
}
