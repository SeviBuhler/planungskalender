import { Injectable, signal } from '@angular/core';
import { Supabase } from '../../services/supabase';
import { clearDeviceKeys, loadDeviceKey, saveDeviceKey } from './device-key';
import {
  CryptoModule,
  decryptText,
  encryptText,
  exportModuleKey,
  exportPublicKey,
  generateUserKeys,
  importPublicKey,
  isEncrypted,
  moduleKey,
  newScopeKey,
  openScopeKey,
  scopeOf,
  sealScopeKey,
  unwrapPrivateKey,
  wrapPrivateKey,
} from './e2ee';

// idle: not asked yet · setup: no keys yet · locked: keys exist, this device needs the recovery code
export type VaultState = 'idle' | 'loading' | 'setup' | 'locked' | 'ready' | 'error';

interface UserKeysRow {
  public_key: string;
  wrapped_private_key: string;
  personal_scope: string;
  feed_titles: boolean;
}

// Holds the keys of the logged-in user and encrypts / decrypts content for the stores.
// A page that needs content awaits ready(); while keys are missing the global
// VaultGate dialog asks to set them up or for the recovery code.
@Injectable({ providedIn: 'root' })
export class Vault {
  readonly state = signal<VaultState>('idle');
  readonly errorText = signal('');
  readonly feedTitles = signal(false);

  private userId: string | null = null;
  private privateKey: CryptoKey | null = null;
  private publicKey = '';
  private personal = '';
  private scopeKeys = new Map<string, Uint8Array<ArrayBuffer>>();
  private moduleKeys = new Map<string, Promise<CryptoKey>>();
  private waiting: { resolve: () => void; reject: (error: Error) => void }[] = [];
  private loading: Promise<void> | null = null;

  constructor(private supabase: Supabase) {
    supabase.client.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') void this.forget(true);
    });
  }

  // Resolves once content can be encrypted and decrypted
  ready(): Promise<void> {
    if (this.state() === 'ready') return Promise.resolve();
    const promise = new Promise<void>((resolve, reject) => this.waiting.push({ resolve, reject }));
    if (this.state() === 'idle' || this.state() === 'error') void this.load();
    return promise;
  }

  // Uses the key stored on this device, without asking for anything (e.g. on the options page)
  async restore(): Promise<void> {
    if (this.state() !== 'idle') return;
    try {
      const userId = await this.currentUser();
      const stored = await loadDeviceKey(userId);
      if (!stored) return;
      const row = await this.loadRow(userId);
      if (row?.public_key === stored.publicKey && this.state() === 'idle') {
        await this.useKeys(userId, stored.privateKey, row.public_key, row.personal_scope, row.feed_titles);
      }
    } catch (error) {
      console.error('Schlüssel laden fehlgeschlagen', error);
    }
  }

  // Shares household keys with new members and creates keys for new households
  async refresh(): Promise<void> {
    if (this.state() !== 'ready') return;
    try {
      await this.syncScopes();
    } catch (error) {
      console.error('Schlüssel abgleichen fehlgeschlagen', error);
    }
  }

  // Lets the user step away from the dialog; waiting pages show an error
  cancel() {
    this.settle(new Error('Die Verschlüsselung ist auf diesem Gerät noch nicht entsperrt.'));
    this.state.set('idle');
  }

  // ---- Setup, unlock, reset ----

  async setup(code: string): Promise<void> {
    const userId = await this.currentUser();
    const keys = await generateUserKeys();
    const personal = crypto.randomUUID();
    const publicKey = await exportPublicKey(keys.publicKey);
    const { error } = await this.supabase.client.from('user_keys').insert({
      user_id: userId,
      public_key: publicKey,
      wrapped_private_key: await wrapPrivateKey(keys.privateKey, code),
      personal_scope: personal,
    });
    if (error) {
      // Set up on another device in the meantime
      if (error.code === '23505') {
        this.state.set('locked');
        throw new Error('Die Verschlüsselung wurde schon auf einem anderen Gerät eingerichtet. Gib den Wiederherstellungscode von dort ein.');
      }
      throw error;
    }
    await this.useKeys(userId, keys.privateKey, publicKey, personal, false);
  }

  async unlock(code: string): Promise<void> {
    const userId = await this.currentUser();
    const row = await this.loadRow(userId);
    if (!row) {
      this.state.set('setup');
      return;
    }
    let privateKey: CryptoKey;
    try {
      privateKey = await unwrapPrivateKey(row.wrapped_private_key, code);
    } catch {
      throw new Error('Der Wiederherstellungscode stimmt nicht.');
    }
    await this.useKeys(userId, privateKey, row.public_key, row.personal_scope, row.feed_titles);
  }

  // Lost code: new keys, private content encrypted with the old ones can no longer be read.
  // Household keys come back as soon as another member opens ForTwo.
  async reset(code: string): Promise<void> {
    const userId = await this.currentUser();
    const keys = await generateUserKeys();
    const personal = crypto.randomUUID();
    const publicKey = await exportPublicKey(keys.publicKey);
    const db = this.supabase.client;
    await check(db.from('scope_keys').delete().eq('user_id', userId));
    await check(db.from('feed_keys').delete().eq('user_id', userId));
    await check(
      db
        .from('user_keys')
        .update({
          public_key: publicKey,
          wrapped_private_key: await wrapPrivateKey(keys.privateKey, code),
          personal_scope: personal,
          feed_titles: false,
        })
        .eq('user_id', userId)
    );
    await this.useKeys(userId, keys.privateKey, publicKey, personal, false);
  }

  // Replaces the recovery code; the keys stay the same
  async changeRecoveryCode(code: string): Promise<void> {
    if (!this.privateKey || !this.userId) throw new Error('Die Verschlüsselung ist nicht entsperrt.');
    await check(
      this.supabase.client
        .from('user_keys')
        .update({ wrapped_private_key: await wrapPrivateKey(this.privateKey, code) })
        .eq('user_id', this.userId)
    );
  }

  // ---- Subscription feed / push titles ----

  // On: the calendar keys go to the server so the feed and reminders can show titles
  async setFeedTitles(on: boolean): Promise<void> {
    if (!this.userId) throw new Error('Die Verschlüsselung ist nicht entsperrt.');
    const db = this.supabase.client;
    await check(db.from('user_keys').update({ feed_titles: on }).eq('user_id', this.userId));
    if (!on) await check(db.from('feed_keys').delete().eq('user_id', this.userId));
    this.feedTitles.set(on);
    if (on) await this.syncFeedKeys();
  }

  // ---- Content ----

  personalScope(): string {
    return this.personal;
  }

  hasScope(scopeId: string): boolean {
    return this.scopeKeys.has(scopeId);
  }

  async encrypt(module: CryptoModule, scopeId: string, text: string): Promise<string> {
    const key = await this.moduleKey(scopeId, module);
    if (!key) throw new Error('Der Schlüssel für diesen Haushalt fehlt auf diesem Konto noch. Er wird freigegeben, sobald ein anderes Mitglied ForTwo öffnet.');
    return encryptText(key, scopeId, text);
  }

  // Plain text (not yet encrypted) is returned as it is; null when the key is missing
  async decrypt(module: CryptoModule, value: string): Promise<string | null> {
    if (!isEncrypted(value)) return value;
    const key = await this.moduleKey(scopeOf(value)!, module);
    if (!key) return null;
    try {
      return await decryptText(key, value);
    } catch {
      return null;
    }
  }

  // ---- Internals ----

  private moduleKey(scopeId: string, module: CryptoModule): Promise<CryptoKey | null> {
    const scopeKey = this.scopeKeys.get(scopeId);
    if (!scopeKey) return Promise.resolve(null);
    const id = `${scopeId}|${module}`;
    if (!this.moduleKeys.has(id)) this.moduleKeys.set(id, moduleKey(scopeKey, module));
    return this.moduleKeys.get(id)!;
  }

  private load(): Promise<void> {
    this.loading ??= (async () => {
      this.state.set('loading');
      this.errorText.set('');
      try {
        const userId = await this.currentUser();
        const row = await this.loadRow(userId);
        if (!row) {
          this.state.set('setup');
          return;
        }
        const stored = await loadDeviceKey(userId);
        if (!stored || stored.publicKey !== row.public_key) {
          // Never unlocked here, or reset on another device
          if (stored) await clearDeviceKeys();
          this.state.set('locked');
          return;
        }
        await this.useKeys(userId, stored.privateKey, row.public_key, row.personal_scope, row.feed_titles);
      } catch (error) {
        this.state.set('error');
        this.errorText.set(messageOf(error));
        this.settle(new Error(`Die Schlüssel konnten nicht geladen werden (${messageOf(error)}).`));
      } finally {
        this.loading = null;
      }
    })();
    return this.loading;
  }

  private async useKeys(userId: string, privateKey: CryptoKey, publicKey: string, personal: string, feedTitles: boolean) {
    this.userId = userId;
    this.privateKey = privateKey;
    this.publicKey = publicKey;
    this.personal = personal;
    this.feedTitles.set(feedTitles);
    this.scopeKeys.clear();
    this.moduleKeys.clear();
    await saveDeviceKey({ userId, publicKey, privateKey });
    await this.syncScopes();
    this.state.set('ready');
    this.settle(null);
  }

  private async syncScopes() {
    const db = this.supabase.client;
    const userId = this.userId!;

    const { data: sealed, error } = await db.from('scope_keys').select('scope_id, sealed_key').eq('user_id', userId);
    if (error) throw error;
    for (const row of sealed ?? []) {
      if (this.scopeKeys.has(row.scope_id)) continue;
      try {
        this.scopeKeys.set(row.scope_id, await openScopeKey(row.sealed_key, this.privateKey!));
      } catch {
        console.error('Bereichsschlüssel lässt sich nicht öffnen', row.scope_id);
      }
    }

    const own = await importPublicKey(this.publicKey);

    // Personal key: created right after setup; a new one only if an earlier attempt stopped half-way
    if (!this.scopeKeys.has(this.personal)) await this.createScope(this.personal, null, newScopeKey(), own);
    if (!this.scopeKeys.has(this.personal)) {
      const personal = crypto.randomUUID();
      await this.createScope(personal, null, newScopeKey(), own);
      await check(db.from('user_keys').update({ personal_scope: personal }).eq('user_id', userId));
      this.personal = personal;
    }

    // Households without a key yet: the first member to get here creates it
    const { data: memberships, error: memberError } = await db.from('household_members').select('household_id').eq('user_id', userId);
    if (memberError) throw memberError;
    const missing = (memberships ?? []).map((m) => m.household_id as string).filter((id) => !this.scopeKeys.has(id));
    if (missing.length) {
      const { data: existing, error: scopeError } = await db.from('encryption_scopes').select('id').in('id', missing);
      if (scopeError) throw scopeError;
      const taken = new Set((existing ?? []).map((s) => s.id as string));
      for (const household of missing.filter((id) => !taken.has(id))) {
        await this.createScope(household, household, newScopeKey(), own);
      }
    }

    // Members who joined (or started over) since: seal the household key for them
    const { data: pending, error: pendingError } = await db.rpc('missing_scope_keys');
    if (pendingError) throw pendingError;
    for (const row of (pending ?? []) as { scope_id: string; user_id: string; public_key: string }[]) {
      const key = this.scopeKeys.get(row.scope_id);
      if (!key) continue;
      const { error: shareError } = await db.from('scope_keys').insert({
        scope_id: row.scope_id,
        user_id: row.user_id,
        sealed_key: await sealScopeKey(key, await importPublicKey(row.public_key)),
      });
      if (shareError && shareError.code !== '23505') throw shareError;
    }

    if (this.feedTitles()) await this.syncFeedKeys();
  }

  private async createScope(id: string, household: string | null, key: Uint8Array<ArrayBuffer>, own: CryptoKey) {
    const { data, error } = await this.supabase.client.rpc('create_encryption_scope', {
      scope: id,
      household,
      sealed: await sealScopeKey(key, own),
    });
    if (error) throw error;
    if (data === true) this.scopeKeys.set(id, key);
  }

  private async syncFeedKeys() {
    const db = this.supabase.client;
    const { data, error } = await db.from('feed_keys').select('scope_id').eq('user_id', this.userId!);
    if (error) throw error;
    const done = new Set((data ?? []).map((r) => r.scope_id as string));
    const rows = [];
    for (const [scopeId, scopeKey] of this.scopeKeys) {
      if (done.has(scopeId)) continue;
      rows.push({ user_id: this.userId, scope_id: scopeId, calendar_key: await exportModuleKey(await moduleKey(scopeKey, 'calendar', true)) });
    }
    if (rows.length) await check(db.from('feed_keys').upsert(rows));
  }

  private async currentUser(): Promise<string> {
    const { data } = await this.supabase.client.auth.getSession();
    const userId = data.session?.user.id;
    if (!userId) throw new Error('Nicht angemeldet');
    if (this.userId && this.userId !== userId) await this.forget(false);
    return userId;
  }

  private async loadRow(userId: string): Promise<UserKeysRow | null> {
    const { data, error } = await this.supabase.client
      .from('user_keys')
      .select('public_key, wrapped_private_key, personal_scope, feed_titles')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    return data as UserKeysRow | null;
  }

  private settle(error: Error | null) {
    const waiting = this.waiting;
    this.waiting = [];
    for (const w of waiting) error ? w.reject(error) : w.resolve();
  }

  private async forget(clearDevice: boolean) {
    this.userId = this.privateKey = null;
    this.publicKey = this.personal = '';
    this.scopeKeys.clear();
    this.moduleKeys.clear();
    this.feedTitles.set(false);
    this.settle(new Error('Abgemeldet'));
    this.state.set('idle');
    if (clearDevice) await clearDeviceKeys();
  }
}

async function check(request: PromiseLike<{ error: { message: string } | null }>): Promise<void> {
  const { error } = await request;
  if (error) throw error;
}

function messageOf(error: unknown): string {
  return typeof error === 'object' && error !== null && 'message' in error ? String((error as { message: string }).message) : String(error);
}
